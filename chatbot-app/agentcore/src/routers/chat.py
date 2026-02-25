"""Chat router - handles agent execution and SSE streaming
Implements AgentCore Runtime standard endpoints:
- POST /invocations (required)
- GET /ping (required)

Simplified using agent factory pattern - all agent-specific logic moved to agent classes.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError
from fastapi.responses import StreamingResponse
from typing import AsyncGenerator, List, Optional
import asyncio
import logging
import json
import os
from opentelemetry import trace

from models.schemas import InvocationRequest
from agents.factory import create_agent
from streaming.agui_event_processor import AGUIStreamEventProcessor
from ag_ui.core import RunAgentInput
from ag_ui.encoder import EventEncoder

logger = logging.getLogger(__name__)


def _is_agui_request(body: dict) -> bool:
    """Returns True if body matches AG-UI RunAgentInput (has thread_id/run_id, lacks session_id/user_id)."""
    return (
        "thread_id" in body and "run_id" in body
        and "session_id" not in body and "user_id" not in body
    )

router = APIRouter(tags=["chat"])


async def keepalive_stream(
    stream: AsyncGenerator,
    session_id: str,
    interval: float = 30.0
) -> AsyncGenerator[str, None]:
    """
    Wraps a stream to inject SSE keepalive comments during silent periods.
    Prevents proxy timeout (e.g., idle timeout) during long tool calls like code_agent.
    """
    queue: asyncio.Queue = asyncio.Queue()

    async def producer():
        try:
            async for chunk in stream:
                await queue.put(('data', chunk))
        except Exception as e:
            await queue.put(('error', e))
        finally:
            await queue.put(('end', None))

    task = asyncio.create_task(producer())
    try:
        while True:
            try:
                kind, value = await asyncio.wait_for(queue.get(), timeout=interval)
            except asyncio.TimeoutError:
                logger.debug(f"[Keepalive] Sending keepalive for session {session_id}")
                yield ": keepalive\n\n"
                continue

            if kind == 'end':
                break
            elif kind == 'error':
                raise value
            else:
                yield value
    finally:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass


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


@router.post("/invocations")
async def invocations(http_request: Request):
    """
    Main endpoint for agent invocations.

    Accepts both the existing InvocationRequest format and AG-UI RunAgentInput format,
    routing to the appropriate handler based on request body fields.
    """
    body = await http_request.json()

    if _is_agui_request(body):
        return await _handle_agui_invocation(body, http_request)

    try:
        request = InvocationRequest(**body)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors())
    input_data = request.input

    # Handle warmup requests (Lambda container warmup)
    if input_data.warmup:
        logger.info(f"[Warmup] Container warmed - session={input_data.session_id}, user={input_data.user_id}")

        # Pre-cache memory strategy IDs to speed up first real request
        memory_id = os.environ.get('MEMORY_ID')
        if memory_id:
            try:
                from agent.agent import _cached_strategy_ids
                if _cached_strategy_ids is None:
                    import boto3
                    import agent.agent as agent_module
                    aws_region = os.environ.get('AWS_REGION', 'us-west-2')
                    gmcp = boto3.client('bedrock-agentcore-control', region_name=aws_region)
                    response = gmcp.get_memory(memoryId=memory_id)
                    memory = response['memory']
                    strategies = memory.get('strategies', memory.get('memoryStrategies', []))

                    strategy_map = {
                        s.get('type', s.get('memoryStrategyType', '')): s.get('strategyId', s.get('memoryStrategyId', ''))
                        for s in strategies
                        if s.get('type', s.get('memoryStrategyType', '')) and s.get('strategyId', s.get('memoryStrategyId', ''))
                    }
                    agent_module._cached_strategy_ids = strategy_map
                    logger.info(f"[Warmup] Pre-cached {len(strategy_map)} strategy IDs")
            except Exception as e:
                logger.warning(f"[Warmup] Failed to pre-cache strategy IDs: {e}")

        return {"status": "warm"}

    # Handle stop action - set in-memory flag for immediate stop
    if input_data.action == "stop":
        from agent.stop_signal import get_stop_signal_provider
        provider = get_stop_signal_provider()
        provider.request_stop(input_data.user_id, input_data.session_id)
        logger.info(f"[Stop] Stop signal set via /invocations for session={input_data.session_id}")
        return {"status": "stop_requested", "session_id": input_data.session_id}

    # Handle elicitation_complete action - signal waiting MCP elicitation callback
    if input_data.action == "elicitation_complete":
        from agent.mcp.elicitation_bridge import get_bridge
        bridge = get_bridge(input_data.session_id)
        elicitation_id = getattr(input_data, 'elicitation_id', None)
        if bridge:
            bridge.complete_elicitation(elicitation_id)
            logger.info(f"[Elicitation] Complete signal sent for session={input_data.session_id}")
        else:
            logger.warning(f"[Elicitation] No bridge found for session={input_data.session_id}")
        return {"status": "elicitation_completed"}

    # Add tracing attributes
    span = trace.get_current_span()
    span.set_attribute("user.id", input_data.user_id or "anonymous")
    span.set_attribute("session.id", input_data.session_id)

    request_type = input_data.request_type or "normal"
    logger.info(f"Invocation: session={input_data.session_id}, user={input_data.user_id}, type={request_type}")

    try:
        # Parse message for special cases (HITL interrupt response, compose confirmation)
        message_content, special_params = _parse_message(input_data.message, request_type)

        # Create agent using factory
        agent = create_agent(
            request_type=request_type,
            session_id=input_data.session_id,
            user_id=input_data.user_id,
            enabled_tools=input_data.enabled_tools,
            model_id=input_data.model_id,
            temperature=input_data.temperature,
            system_prompt=input_data.system_prompt,
            caching_enabled=input_data.caching_enabled,
            compaction_enabled=input_data.compaction_enabled,
            api_keys=input_data.api_keys,
            auth_token=input_data.auth_token,
        )

        # Stream response from agent
        stream = agent.stream_async(
            message_content,
            files=input_data.files,
            selected_artifact_id=input_data.selected_artifact_id,
            api_keys=input_data.api_keys,
            **special_params
        )

        # Wrap stream with disconnect detection
        wrapped_stream = disconnect_aware_stream(
            stream,
            http_request,
            input_data.session_id
        )

        # Wrap with keepalive to prevent proxy timeout during long silent tool calls
        final_stream = keepalive_stream(wrapped_stream, input_data.session_id)

        # Return streaming response with appropriate headers
        return StreamingResponse(
            final_stream,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
                "X-Session-ID": input_data.session_id,
                "X-Request-Type": request_type
            }
        )

    except Exception as e:
        logger.error(f"Error in invocations: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Agent processing failed. Please check logs for details."
        )


@router.get("/ping")
async def ping():
    """Health check endpoint required by AgentCore Runtime."""
    return {"status": "healthy"}


def _parse_message(message: str, request_type: str) -> tuple[str, dict]:
    """
    Parse message for special cases (HITL interrupt response, compose confirmation).

    Returns:
        (message_content, special_params) tuple
        - message_content: The actual message to send to agent
        - special_params: Dict of additional kwargs for stream_async()
    """
    special_params = {}

    # Handle HITL interrupt response (normal mode only)
    if request_type == "normal":
        try:
            parsed = json.loads(message)
            if isinstance(parsed, list) and len(parsed) > 0:
                first_item = parsed[0]
                if isinstance(first_item, dict) and "interruptResponse" in first_item:
                    interrupt_data = first_item["interruptResponse"]
                    logger.debug(f"Interrupt response received: {interrupt_data.get('interruptId', 'unknown')[:50]}")
                    # Return interrupt prompt as-is (agent expects this format)
                    return [first_item], {}
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

    # Handle compose confirmation (compose mode only)
    if request_type == "compose":
        try:
            from models.composer_schemas import OutlineConfirmation
            parsed = json.loads(message)
            if isinstance(parsed, dict) and "approved" in parsed:
                confirmation = OutlineConfirmation(**parsed)
                logger.info(f"[Compose] Outline confirmation: approved={confirmation.approved}")
                special_params["confirmation_response"] = confirmation
                return "", special_params  # Empty message, pass confirmation separately
        except (json.JSONDecodeError, TypeError, ValueError):
            pass

    # Normal message - no special handling
    return message, special_params


async def _handle_agui_invocation(body: dict, http_request: Request) -> StreamingResponse:
    """Handle AG-UI protocol RunAgentInput requests."""
    # forwarded_props is required by RunAgentInput but optional in practice; default to None
    body = {**body, "forwarded_props": body.get("forwarded_props")}
    input_data = RunAgentInput(**body)
    thread_id = input_data.thread_id
    run_id = input_data.run_id

    session_id = thread_id
    user_id = "agui"
    if input_data.state and isinstance(input_data.state, dict):
        user_id = input_data.state.get("user_id", "agui")

    message = ""
    if input_data.messages:
        for msg in reversed(input_data.messages):
            if msg.role == "user":
                content = msg.content
                if isinstance(content, str):
                    message = content
                elif isinstance(content, list):
                    for part in content:
                        if hasattr(part, "text"):
                            message = part.text
                            break
                        elif isinstance(part, dict) and part.get("type") == "text":
                            message = part.get("text", "")
                            break
                break

    # Extract enabled tools from the AG-UI tools list
    enabled_tools: Optional[List[str]] = None
    if input_data.tools:
        tool_names = [t.name for t in input_data.tools if t.name]
        if tool_names:
            enabled_tools = tool_names

    # Extract additional config from state
    model_id = None
    temperature = None
    system_prompt = None
    caching_enabled = None
    request_type = "normal"
    if input_data.state and isinstance(input_data.state, dict):
        model_id = input_data.state.get("model_id")
        temperature = input_data.state.get("temperature")
        system_prompt = input_data.state.get("system_prompt")
        caching_enabled = input_data.state.get("caching_enabled")
        request_type = input_data.state.get("request_type", "normal")

    logger.info(f"AG-UI invocation: thread_id={thread_id}, run_id={run_id}, user_id={user_id}, tools={len(enabled_tools) if enabled_tools else 0}")

    try:
        agent = create_agent(
            request_type=request_type,
            session_id=session_id,
            user_id=user_id,
            enabled_tools=enabled_tools,
            model_id=model_id,
            temperature=temperature,
            system_prompt=system_prompt,
            caching_enabled=caching_enabled,
        )

        agui_processor = AGUIStreamEventProcessor(thread_id=thread_id, run_id=run_id)

        os.environ["SESSION_ID"] = session_id
        os.environ["USER_ID"] = user_id

        invocation_state = {
            "session_id": session_id,
            "user_id": user_id,
            "model_id": agent.model_id,
            "session_manager": agent.session_manager,
        }

        stream = agui_processor.process_stream(
            agent.agent,
            message,
            session_id=session_id,
            invocation_state=invocation_state,
        )

        wrapped_stream = disconnect_aware_stream(stream, http_request, session_id)
        final_stream = keepalive_stream(wrapped_stream, session_id)

        accept = http_request.headers.get("accept", "")
        media_type = EventEncoder(accept=accept).get_content_type()

        return StreamingResponse(
            final_stream,
            media_type=media_type,
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
                "X-Thread-ID": thread_id,
            }
        )

    except Exception as e:
        logger.error(f"Error in AG-UI invocation: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Agent processing failed. Please check logs for details."
        )
