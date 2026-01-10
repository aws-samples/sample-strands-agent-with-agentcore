"""Chat router - handles agent execution and SSE streaming
Implements AgentCore Runtime standard endpoints:
- POST /invocations (required)
- GET /ping (required)

Supports Autopilot mode: Application-Level Orchestration with Mission Control.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from typing import Optional, List, AsyncGenerator
import logging
import json
import asyncio

from models.schemas import InvocationRequest, InvocationInput
from models.autopilot_schemas import (
    Directive,
    MissionComplete,
    ProgressReport,
    ToolCall,
    MissionProgressEvent,
    MissionCompleteEvent,
)
from agent.agent import ChatbotAgent
from agent.mission_control import MissionControl, DEFAULT_TOOL_GROUPS

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

# Disconnect check interval (seconds)
DISCONNECT_CHECK_INTERVAL = 0.5


async def disconnect_aware_stream(
    stream: AsyncGenerator,
    http_request: Request,
    session_id: str
) -> AsyncGenerator[str, None]:
    """
    Wrapper generator that checks for client disconnection.

    When BFF aborts the connection, FastAPI's Request.is_disconnected()
    returns True. This wrapper detects that and closes the underlying stream,
    which triggers the finally block in event_processor (partial response save).
    """
    disconnected = False
    try:
        async for chunk in stream:
            # Check if client disconnected before yielding
            if await http_request.is_disconnected():
                logger.info(f"🔌 Client disconnected for session {session_id} - stopping stream")
                disconnected = True
                break

            yield chunk

    except GeneratorExit:
        logger.info(f"🔌 GeneratorExit in disconnect_aware_stream for session {session_id}")
        disconnected = True
        raise
    except Exception as e:
        logger.error(f"Error in disconnect_aware_stream for session {session_id}: {e}")
        raise
    finally:
        # Close the underlying stream to trigger its finally block
        # This ensures event_processor saves partial response
        if disconnected:
            logger.info(f"🔌 Closing underlying stream for session {session_id} due to disconnect")
            try:
                await stream.aclose()
            except Exception as e:
                logger.debug(f"Error closing stream: {e}")
        logger.debug(f"disconnect_aware_stream finished for session {session_id}")

def get_agent(
    session_id: str,
    user_id: Optional[str] = None,
    enabled_tools: Optional[List[str]] = None,
    model_id: Optional[str] = None,
    temperature: Optional[float] = None,
    system_prompt: Optional[str] = None,
    caching_enabled: Optional[bool] = None,
    compaction_enabled: Optional[bool] = None
) -> ChatbotAgent:
    """
    Create agent instance with current configuration for session

    No caching - creates new agent each time to reflect latest configuration.
    Session message history is managed by AgentCore Memory automatically.
    """
    logger.info(f"Creating agent for session {session_id}, user {user_id or 'anonymous'}")
    logger.info(f"  Model: {model_id or 'default'}, Temperature: {temperature or 0.7}")
    logger.info(f"  System prompt: {system_prompt[:50] if system_prompt else 'default'}...")
    logger.info(f"  Caching: {caching_enabled if caching_enabled is not None else True}")
    logger.info(f"  Compaction: {compaction_enabled if compaction_enabled is not None else True}")
    logger.info(f"  Tools: {enabled_tools or 'all'}")

    # Create agent with AgentCore Memory - messages and preferences automatically loaded/saved
    agent = ChatbotAgent(
        session_id=session_id,
        user_id=user_id,
        enabled_tools=enabled_tools,
        model_id=model_id,
        temperature=temperature,
        system_prompt=system_prompt,
        caching_enabled=caching_enabled,
        compaction_enabled=compaction_enabled
    )

    return agent


# ============================================================
# Autopilot Mode: Application-Level Orchestration
# ============================================================

async def autopilot_orchestration_stream(
    input_data: InvocationInput,
    http_request: Request
) -> AsyncGenerator[str, None]:
    """
    Orchestration loop for Autopilot mode.

    Flow:
    1. Call Mission Control → get first Directive (or MissionComplete if no tools needed)
    2. Create agent with directive.tools → execute → stream to frontend
    3. Collect result, send to Mission Control
    4. If next directive → goto 2
    5. If mission_complete → agent generates consolidated response
    """
    session_id = input_data.session_id
    user_id = input_data.user_id
    user_query = input_data.message

    logger.info(f"🚀 [Autopilot] Starting mission for session {session_id}")
    logger.info(f"🚀 [Autopilot] User query: {user_query[:100]}...")

    # Initialize Mission Control (always uses Haiku for fast planning)
    # Uses mc-{session_id} namespace for separate conversation history
    mission_control = MissionControl(session_id=session_id, user_id=user_id)

    # Yield start event
    yield f"data: {json.dumps({'type': 'start'})}\n\n"

    try:
        # Step 1: Get first directive from Mission Control
        first_result = await mission_control.get_first_directive(user_query)

        # Check if Mission Control determined no tools needed
        if isinstance(first_result, MissionComplete):
            # Simple query - delegate directly to agent for streaming response
            logger.info(f"🚀 [Autopilot] No tools needed - delegating to agent")

            # Yield mission complete event with total_steps=0 (direct response)
            complete_event = MissionCompleteEvent(total_steps=0)
            yield f"data: {json.dumps(complete_event.model_dump())}\n\n"

            agent = get_agent(
                session_id=session_id,
                user_id=user_id,
                enabled_tools=input_data.enabled_tools,  # Use original enabled tools
                model_id=input_data.model_id,
                temperature=input_data.temperature,
                system_prompt=input_data.system_prompt,
                caching_enabled=input_data.caching_enabled,
                compaction_enabled=input_data.compaction_enabled
            )

            # Use [AUTOPILOT:direct] marker for consistent indigo badge in UI
            direct_prompt = f"[AUTOPILOT:direct] {user_query}"

            # Stream agent response directly
            async for chunk in agent.stream_async(
                direct_prompt,
                session_id=session_id
            ):
                yield chunk

            # End the stream (finally block will yield 'end' event)
            return

        # Multi-step mission - continue with orchestration loop
        directive = first_result
        logger.info(f"🚀 [Autopilot] First directive: step={directive.step}, tools={directive.tools}")
        logger.info(f"🚀 [Autopilot] Starting mission execution")

        # Yield mission progress event (adaptive: no total_steps)
        progress_event = MissionProgressEvent(
            step=directive.step,
            directive_prompt=directive.prompt,
            active_tools=directive.tools
        )
        yield f"data: {json.dumps(progress_event.model_dump())}\n\n"

        step_count = 0
        max_steps = 10  # Safety limit

        # Token usage accumulator for entire mission
        total_usage = {
            "inputTokens": 0,
            "outputTokens": 0,
            "totalTokens": 0,
            "cacheReadInputTokens": 0,
            "cacheWriteInputTokens": 0
        }

        # Orchestration loop
        while isinstance(directive, Directive) and step_count < max_steps:
            step_count += 1

            # Check for client disconnect
            if await http_request.is_disconnected():
                logger.info(f"🔌 [Autopilot] Client disconnected at step {step_count}")
                break

            logger.info(f"🚀 [Autopilot] Executing step {directive.step}: {directive.prompt[:50]}...")

            # Step 2: Create agent with directive's tools
            agent = get_agent(
                session_id=session_id,
                user_id=user_id,
                enabled_tools=directive.tools,
                model_id=input_data.model_id,
                temperature=input_data.temperature,
                system_prompt=_build_directive_system_prompt(directive, input_data.system_prompt),
                caching_enabled=input_data.caching_enabled,
                compaction_enabled=input_data.compaction_enabled
            )

            # Step 3: Execute agent and stream to frontend
            result_text = ""
            tool_calls: List[ToolCall] = []
            step_usage = None  # Token usage for this step

            # Add directive marker prefix for frontend to identify during session restore
            # Format: [DIRECTIVE:step_number] (User: original_query) prompt_text
            # Include original user query in first directive for context and session restore
            if directive.step == 1:
                directive_prompt_with_marker = f"[DIRECTIVE:{directive.step}] (User: {user_query}) {directive.prompt}"
            else:
                directive_prompt_with_marker = f"[DIRECTIVE:{directive.step}] {directive.prompt}"

            async for chunk in agent.stream_async(
                directive_prompt_with_marker,
                session_id=session_id
            ):
                # Stream chunk to frontend (but intercept 'complete' to collect usage)
                if chunk.startswith("data: "):
                    try:
                        data = json.loads(chunk[6:].strip())
                        if data.get("type") == "text":
                            result_text += data.get("content", "")
                        elif data.get("type") == "tool_use":
                            # Collect tool call with truncated input
                            tool_name = data.get("name", "unknown")
                            tool_input = data.get("input", {})
                            input_str = json.dumps(tool_input, ensure_ascii=False)
                            input_summary = input_str[:200] + "..." if len(input_str) > 200 else input_str
                            tool_calls.append(ToolCall(name=tool_name, input_summary=input_summary))
                        elif data.get("type") == "complete":
                            # Capture usage from complete event, don't yield yet
                            step_usage = data.get("usage")
                            if step_usage:
                                # Accumulate token usage
                                total_usage["inputTokens"] += step_usage.get("inputTokens", 0)
                                total_usage["outputTokens"] += step_usage.get("outputTokens", 0)
                                total_usage["totalTokens"] += step_usage.get("totalTokens", 0)
                                total_usage["cacheReadInputTokens"] += step_usage.get("cacheReadInputTokens", 0)
                                total_usage["cacheWriteInputTokens"] += step_usage.get("cacheWriteInputTokens", 0)
                                logger.info(f"🚀 [Autopilot] Step {directive.step} usage: input={step_usage.get('inputTokens', 0)}, output={step_usage.get('outputTokens', 0)}")
                            # Skip yielding 'complete' for intermediate steps
                            continue
                    except (json.JSONDecodeError, KeyError):
                        pass

                yield chunk

            # Step 4: Report to Mission Control
            report = ProgressReport(
                directive_id=directive.directive_id,
                tool_calls=tool_calls,
                response_text=result_text[:1000] if result_text else ""
            )

            logger.info(f"🚀 [Autopilot] Reporting step {directive.step}: {len(tool_calls)} tool calls, {len(result_text)} chars")

            # Get next directive or mission complete
            result = await mission_control.process_report(report)

            if isinstance(result, MissionComplete):
                # Step 5: Mission complete - agent provides consolidated response
                logger.info(f"🚀 [Autopilot] Mission complete after {result.total_steps} steps, generating summary")

                # Yield mission complete event first
                complete_event = MissionCompleteEvent(
                    total_steps=result.total_steps
                )
                yield f"data: {json.dumps(complete_event.model_dump())}\n\n"

                # Create agent to generate consolidated response
                # Use [AUTOPILOT:summary] marker for consistent indigo badge in UI
                # Include original user query to ensure response is focused on user's request
                consolidation_prompt = f"[AUTOPILOT:summary] The user originally asked: \"{user_query}\"\n\nBased on the work completed above, provide a comprehensive response to the user's request."

                agent = get_agent(
                    session_id=session_id,
                    user_id=user_id,
                    enabled_tools=[],  # No tools needed for summary
                    model_id=input_data.model_id,
                    temperature=input_data.temperature,
                    caching_enabled=input_data.caching_enabled,
                    compaction_enabled=input_data.compaction_enabled
                )

                # Stream consolidation response, capture its usage too
                async for chunk in agent.stream_async(
                    consolidation_prompt,
                    session_id=session_id
                ):
                    if chunk.startswith("data: "):
                        try:
                            data = json.loads(chunk[6:].strip())
                            if data.get("type") == "complete":
                                # Capture consolidation usage
                                consolidation_usage = data.get("usage")
                                if consolidation_usage:
                                    total_usage["inputTokens"] += consolidation_usage.get("inputTokens", 0)
                                    total_usage["outputTokens"] += consolidation_usage.get("outputTokens", 0)
                                    total_usage["totalTokens"] += consolidation_usage.get("totalTokens", 0)
                                    total_usage["cacheReadInputTokens"] += consolidation_usage.get("cacheReadInputTokens", 0)
                                    total_usage["cacheWriteInputTokens"] += consolidation_usage.get("cacheWriteInputTokens", 0)

                                # Yield modified complete event with accumulated usage
                                logger.info(f"🚀 [Autopilot] Total mission usage: input={total_usage['inputTokens']}, output={total_usage['outputTokens']}")

                                # Clean up zero values
                                final_usage = {k: v for k, v in total_usage.items() if v > 0}

                                final_complete = {
                                    "type": "complete",
                                    "message": data.get("message", ""),
                                    "usage": final_usage if final_usage else None
                                }
                                if data.get("images"):
                                    final_complete["images"] = data["images"]
                                if data.get("documents"):
                                    final_complete["documents"] = data["documents"]

                                yield f"data: {json.dumps(final_complete)}\n\n"
                                continue
                        except (json.JSONDecodeError, KeyError):
                            pass

                    yield chunk

                break

            # Continue with next directive
            directive = result

            # Yield mission progress event for next step (adaptive: no total_steps)
            progress_event = MissionProgressEvent(
                step=directive.step,
                directive_prompt=directive.prompt,
                active_tools=directive.tools
            )
            yield f"data: {json.dumps(progress_event.model_dump())}\n\n"

        if step_count >= max_steps:
            logger.warning(f"🚀 [Autopilot] Reached max steps ({max_steps}), stopping")
            yield f"data: {json.dumps({'type': 'warning', 'content': 'Mission reached maximum step limit'})}\n\n"

    except Exception as e:
        logger.error(f"🚀 [Autopilot] Error: {e}")
        import traceback
        traceback.print_exc()
        yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    finally:
        # Yield end event
        yield f"data: {json.dumps({'type': 'end'})}\n\n"


def _build_directive_system_prompt(directive: Directive, base_prompt: Optional[str] = None) -> str:
    """Build system prompt for agent executing a directive

    Returns a directive-specific prompt that ChatbotAgent will detect
    (starts with "You are executing Step") and handle specially.
    """
    return f"""You are executing Step {directive.step} in an automated workflow.

**Task:** {directive.prompt}
**Expected Output:** {directive.expected_output}

After completing the task, summarize results in 2-3 sentences only. A comprehensive response will be provided later."""


# ============================================================
# AgentCore Runtime Standard Endpoints (REQUIRED)
# ============================================================

@router.get("/ping")
async def ping():
    """Health check endpoint (required by AgentCore Runtime)"""
    return {"status": "healthy"}


@router.post("/invocations")
async def invocations(request: InvocationRequest, http_request: Request):
    """
    AgentCore Runtime standard invocation endpoint (required)

    Supports user-specific tool filtering and SSE streaming.
    When autopilot=true, uses Mission Control orchestration.
    """
    input_data = request.input
    logger.info(f"Invocation request - Session: {input_data.session_id}, User: {input_data.user_id}")
    logger.info(f"Message: {input_data.message[:50]}...")
    logger.info(f"Autopilot: {input_data.autopilot or False}")

    if input_data.enabled_tools:
        logger.info(f"Enabled tools ({len(input_data.enabled_tools)}): {input_data.enabled_tools}")

    if input_data.files:
        logger.info(f"Files attached: {len(input_data.files)} files")
        for file in input_data.files:
            logger.info(f"  - {file.filename} ({file.content_type})")

    try:
        # ============================================================
        # Autopilot Mode: Mission Control Orchestration
        # ============================================================
        if input_data.autopilot:
            logger.info(f"🚀 [Autopilot] Entering autopilot mode for session {input_data.session_id}")

            # Use autopilot orchestration stream
            stream = autopilot_orchestration_stream(input_data, http_request)

            return StreamingResponse(
                stream,
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                    "X-Session-ID": input_data.session_id,
                    "X-Autopilot": "true"
                }
            )

        # ============================================================
        # Normal Mode: Direct Agent Execution
        # ============================================================

        # Check if message contains interrupt response (HITL workflow)
        interrupt_response_data = None
        actual_message = input_data.message

        try:
            # Try to parse as JSON array (frontend sends interruptResponse this way)
            parsed = json.loads(input_data.message)
            if isinstance(parsed, list) and len(parsed) > 0:
                first_item = parsed[0]
                if isinstance(first_item, dict) and "interruptResponse" in first_item:
                    interrupt_response_data = first_item["interruptResponse"]
                    logger.info(f"🔔 Interrupt response detected: {interrupt_response_data}")
        except (json.JSONDecodeError, TypeError, KeyError):
            # Not a JSON interrupt response, treat as normal message
            pass

        # Get agent instance with user-specific configuration
        # AgentCore Memory tracks preferences across sessions per user_id
        agent = get_agent(
            session_id=input_data.session_id,
            user_id=input_data.user_id,
            enabled_tools=input_data.enabled_tools,
            model_id=input_data.model_id,
            temperature=input_data.temperature,
            system_prompt=input_data.system_prompt,
            caching_enabled=input_data.caching_enabled,
            compaction_enabled=input_data.compaction_enabled
        )

        # Prepare stream parameters
        if interrupt_response_data:
            # Resume agent with interrupt response
            interrupt_id = interrupt_response_data.get("interruptId")
            response = interrupt_response_data.get("response")
            logger.info(f"🔄 Resuming agent with interrupt response: {interrupt_id} = {response}")

            # Strands SDK expects a list of content blocks with interruptResponse
            interrupt_prompt = [{
                "interruptResponse": {
                    "interruptId": interrupt_id,
                    "response": response
                }
            }]
            stream = agent.stream_async(
                interrupt_prompt,
                session_id=input_data.session_id
            )
        else:
            # Normal message stream
            stream = agent.stream_async(
                actual_message,
                session_id=input_data.session_id,
                files=input_data.files
            )

        # Wrap stream with disconnect detection
        # This allows us to detect when BFF aborts the connection
        wrapped_stream = disconnect_aware_stream(
            stream,
            http_request,
            input_data.session_id
        )

        # Stream response from agent as SSE
        return StreamingResponse(
            wrapped_stream,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "X-Session-ID": input_data.session_id
            }
        )

    except Exception as e:
        logger.error(f"Error in invocations: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Agent processing failed: {str(e)}"
        )
