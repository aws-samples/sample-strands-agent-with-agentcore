"""Chat router - handles agent execution and SSE streaming
Implements AgentCore Runtime standard endpoints:
- POST /invocations (required)
- GET /ping (required)

Supports Swarm mode: Multi-Agent Orchestration with SDK Swarm pattern.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from typing import Dict, Optional, List, AsyncGenerator
import logging
import json
import asyncio
import copy
import os
from opentelemetry import trace

from models.schemas import InvocationRequest, InvocationInput
from models.swarm_schemas import (
    SwarmNodeStartEvent,
    SwarmNodeStopEvent,
    SwarmHandoffEvent,
    SwarmCompleteEvent,
)
from agent.agent import ChatbotAgent
from agent.config.swarm_config import AGENT_DESCRIPTIONS

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
    logger.debug(f"Creating agent for session {session_id}, user {user_id or 'anonymous'}")

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
# Swarm Mode: Multi-Agent Orchestration
# ============================================================

async def swarm_orchestration_stream(
    input_data: InvocationInput,
    http_request: Request
) -> AsyncGenerator[str, None]:
    """
    Swarm-based orchestration stream using SDK Swarm pattern.

    Flow:
    1. Create Swarm with specialist agents
    2. Entry point (coordinator) receives user query
    3. Agents handoff to each other autonomously
    4. Last agent (summarizer) generates final response
    """
    from agent.swarm_agents import create_chatbot_swarm
    from agent.stop_signal import get_stop_signal_provider
    from agent.session.swarm_message_store import get_swarm_message_store

    session_id = input_data.session_id
    user_id = input_data.user_id
    user_query = input_data.message

    # Get stop signal provider for graceful termination
    stop_signal_provider = get_stop_signal_provider()

    logger.info(f"[Swarm] Starting for session {session_id}: {user_query[:50]}...")

    # Initialize message store for unified storage (same format as normal agent)
    message_store = get_swarm_message_store(
        session_id=session_id,
        user_id=user_id
    )

    # Create Swarm with specialist agents
    # Note: enabled_tools is not passed - Swarm agents use their predefined tool sets
    swarm = create_chatbot_swarm(
        session_id=session_id,
        user_id=user_id,
        model_id=input_data.model_id,
    )

    # Inject conversation history into coordinator
    # SDK SwarmNode captures _initial_messages at creation time and resets to it before each execution.
    # To inject history, we must update BOTH executor.messages AND _initial_messages.
    history_messages = message_store.get_history_messages()
    coordinator_node = swarm.nodes.get("coordinator")

    if history_messages and coordinator_node:
        # Update executor.messages (current state)
        coordinator_node.executor.messages = history_messages
        # Update _initial_messages (reset state) - this is what gets restored on reset_executor_state()
        coordinator_node._initial_messages = copy.deepcopy(history_messages)
        logger.info(f"[Swarm] Injected {len(history_messages)} history messages into coordinator (executor + _initial_messages)")
    else:
        logger.info(f"[Swarm] No history (new session or first turn)")

    # Prepare invocation_state for tool context access
    # This will be passed to swarm.stream_async and forwarded to each agent's tools
    invocation_state = {
        'user_id': user_id,
        'session_id': session_id,
        'model_id': input_data.model_id,
    }
    logger.info(f"[Swarm] Prepared invocation_state: user_id={user_id}, session_id={session_id}")

    # Yield start event
    yield f"data: {json.dumps({'type': 'start'})}\n\n"

    # Token usage accumulator
    total_usage = {
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
    }

    node_history = []
    current_node_id = None
    responder_tool_ids: set = set()  # Track sent tool_use events for responder (avoid duplicates)
    # Track accumulated text for each node (for fallback when non-responder ends without handoff)
    node_text_accumulator: Dict[str, str] = {}
    # Track swarm state for session storage
    swarm_shared_context = {}
    # Track responder's content blocks in order: [text, toolUse, toolResult, text, ...]
    # This preserves the exact order for session restore
    responder_content_blocks: List[Dict] = []
    responder_current_text: str = ""  # Current text segment (before tool or between tools)
    responder_pending_tools: Dict[str, Dict] = {}  # toolUseId -> toolUse block

    try:
        # Execute Swarm with streaming
        last_event_time = asyncio.get_event_loop().time()
        event_count = 0

        async for event in swarm.stream_async(user_query, invocation_state=invocation_state):
            event_count += 1
            current_time = asyncio.get_event_loop().time()
            time_since_last = current_time - last_event_time
            last_event_time = current_time

            # Check for client disconnect
            if await http_request.is_disconnected():
                logger.info(f"[Swarm] Client disconnected")
                break

            # Check for stop signal (user requested stop)
            if stop_signal_provider.is_stop_requested(user_id, session_id):
                logger.info(f"[Swarm] Stop signal received for {session_id}")
                stop_signal_provider.clear_stop_signal(user_id, session_id)
                # Send stop complete event (don't save incomplete turn)
                yield f"data: {json.dumps({'type': 'complete', 'message': 'Stream stopped by user'})}\n\n"
                break

            event_type = event.get("type")

            # Log event timing only for long gaps (debugging)
            if time_since_last > 10.0:
                logger.warning(f"[Swarm] Long gap: {time_since_last:.1f}s since last event")

            # Node start
            if event_type == "multiagent_node_start":
                node_id = event.get("node_id")
                current_node_id = node_id
                node_history.append(node_id)

                start_event = SwarmNodeStartEvent(
                    node_id=node_id,
                    node_description=AGENT_DESCRIPTIONS.get(node_id, "")
                )
                yield f"data: {json.dumps(start_event.model_dump())}\n\n"
                logger.debug(f"[Swarm] Node started: {node_id}")

            # Node stream (agent output)
            # SDK event types (from strands/types/_events.py):
            # - ReasoningTextStreamEvent: {"reasoningText": str, "reasoning": True, "delta": ...}
            # - TextStreamEvent: {"data": str, "delta": ...}
            # - ToolUseStreamEvent: {"type": "tool_use_stream", ...}
            # - ToolResultEvent: {"type": "tool_result", ...}
            elif event_type == "multiagent_node_stream":
                inner_event = event.get("event", {})
                node_id = event.get("node_id", current_node_id)

                # Debug: Log tool-related responder events
                if node_id == "responder" and "message" in inner_event:
                    msg = inner_event.get("message", {})
                    if msg and isinstance(msg, dict):
                        logger.info(f"[Swarm] Responder message event: role={msg.get('role')}, content_types={[c.get('type') if isinstance(c, dict) else type(c).__name__ for c in msg.get('content', [])]}")

                # Reasoning event - SDK emits {"reasoningText": str, "reasoning": True}
                if "reasoningText" in inner_event:
                    reasoning_text = inner_event["reasoningText"]
                    if reasoning_text:
                        yield f"data: {json.dumps({'type': 'reasoning', 'text': reasoning_text, 'node_id': node_id})}\n\n"

                # Text output - SDK emits {"data": str}
                # Only responder's text becomes the final response; other agents' text is for progress display
                elif "data" in inner_event:
                    text_data = inner_event["data"]
                    # Accumulate text for fallback (when non-responder ends without handoff)
                    if node_id not in node_text_accumulator:
                        node_text_accumulator[node_id] = ""
                    node_text_accumulator[node_id] += text_data

                    if node_id == "responder":
                        # Final response - displayed as chat message
                        responder_current_text += text_data
                        yield f"data: {json.dumps({'type': 'response', 'text': text_data, 'node_id': node_id})}\n\n"
                    else:
                        # Intermediate agent text - for SwarmProgress display only
                        yield f"data: {json.dumps({'type': 'text', 'content': text_data, 'node_id': node_id})}\n\n"

                # Tool events - only responder's tools are sent to frontend for real-time rendering
                # Other agents use shared_context for tool outputs via handoffs
                elif inner_event.get("type") == "tool_use_stream" and node_id == "responder":
                    # Send first tool_use event only (not streaming deltas)
                    current_tool = inner_event.get("current_tool_use", {})
                    tool_id = current_tool.get("toolUseId")
                    if current_tool and tool_id and tool_id not in responder_tool_ids:
                        responder_tool_ids.add(tool_id)
                        tool_event = {
                            "type": "tool_use",
                            "toolUseId": tool_id,
                            "name": current_tool.get("name"),
                            "input": {}
                        }
                        logger.debug(f"[Swarm] Responder tool use: {tool_event.get('name')}")
                        yield f"data: {json.dumps(tool_event)}\n\n"

                        # Save current text segment before tool (if any)
                        if responder_current_text.strip():
                            responder_content_blocks.append({"text": responder_current_text})
                            responder_current_text = ""

                        # Store toolUse block for session storage
                        # Ensure input is a dict (Bedrock API rejects empty string)
                        tool_input = current_tool.get("input")
                        if not isinstance(tool_input, dict):
                            tool_input = {}
                        tool_use_block = {
                            "toolUse": {
                                "toolUseId": tool_id,
                                "name": current_tool.get("name"),
                                "input": tool_input
                            }
                        }
                        responder_pending_tools[tool_id] = tool_use_block

                # Tool result comes via 'message' event with role='user' containing toolResult blocks
                # SDK structure: {"message": {"role": "user", "content": [{"toolResult": {...}}]}}
                elif "message" in inner_event and node_id == "responder":
                    msg = inner_event.get("message", {})
                    if msg.get("role") == "user" and msg.get("content"):
                        for content_block in msg["content"]:
                            if isinstance(content_block, dict) and "toolResult" in content_block:
                                tool_result = content_block["toolResult"]
                                tool_use_id = tool_result.get("toolUseId")
                                # Only send if we haven't already sent this tool result
                                if tool_use_id and tool_use_id in responder_tool_ids:
                                    result_event = {
                                        "type": "tool_result",
                                        "toolUseId": tool_use_id,
                                        "status": tool_result.get("status", "success")
                                    }
                                    # Extract text from content
                                    if tool_result.get("content"):
                                        for result_content in tool_result["content"]:
                                            if isinstance(result_content, dict) and "text" in result_content:
                                                result_event["result"] = result_content["text"]
                                    logger.info(f"[Swarm] Responder tool result: {tool_use_id}")
                                    yield f"data: {json.dumps(result_event)}\n\n"

                                    # Store toolUse + toolResult blocks in content order
                                    if tool_use_id in responder_pending_tools:
                                        responder_content_blocks.append(responder_pending_tools.pop(tool_use_id))
                                        responder_content_blocks.append({"toolResult": tool_result})

                                    # Remove from set to prevent duplicate sends
                                    responder_tool_ids.discard(tool_use_id)

            # Node stop
            elif event_type == "multiagent_node_stop":
                node_id = event.get("node_id")
                node_result = event.get("node_result", {})

                # Accumulate usage
                if hasattr(node_result, "accumulated_usage"):
                    usage = node_result.accumulated_usage
                    total_usage["inputTokens"] += usage.get("inputTokens", 0)
                    total_usage["outputTokens"] += usage.get("outputTokens", 0)
                    total_usage["totalTokens"] += usage.get("totalTokens", 0)
                elif isinstance(node_result, dict) and "accumulated_usage" in node_result:
                    usage = node_result["accumulated_usage"]
                    total_usage["inputTokens"] += usage.get("inputTokens", 0)
                    total_usage["outputTokens"] += usage.get("outputTokens", 0)
                    total_usage["totalTokens"] += usage.get("totalTokens", 0)

                status = "completed"
                if hasattr(node_result, "status"):
                    status = node_result.status.value if hasattr(node_result.status, "value") else str(node_result.status)
                elif isinstance(node_result, dict):
                    status = node_result.get("status", "completed")

                stop_event = SwarmNodeStopEvent(
                    node_id=node_id,
                    status=status
                )
                yield f"data: {json.dumps(stop_event.model_dump())}\n\n"
                logger.debug(f"[Swarm] Node stopped: {node_id}")

            # Handoff
            elif event_type == "multiagent_handoff":
                from_nodes = event.get("from_node_ids", [])
                to_nodes = event.get("to_node_ids", [])
                message = event.get("message")

                # Get context from the handing-off agent's shared_context
                from_node = from_nodes[0] if from_nodes else ""
                agent_context = None
                if from_node and hasattr(swarm, 'shared_context'):
                    # Debug: log shared_context structure
                    logger.debug(f"[Swarm] shared_context type: {type(swarm.shared_context)}")
                    logger.debug(f"[Swarm] shared_context attrs: {dir(swarm.shared_context)}")
                    if hasattr(swarm.shared_context, 'context'):
                        logger.debug(f"[Swarm] shared_context.context: {swarm.shared_context.context}")
                    agent_context = swarm.shared_context.context.get(from_node)
                    # Capture shared context for session storage
                    if agent_context:
                        swarm_shared_context[from_node] = agent_context
                        logger.info(f"[Swarm] Captured context from {from_node}: {agent_context}")

                handoff_event = SwarmHandoffEvent(
                    from_node=from_node,
                    to_node=to_nodes[0] if to_nodes else "",
                    message=message,
                    context=agent_context
                )
                yield f"data: {json.dumps(handoff_event.model_dump())}\n\n"
                # Keep handoff at INFO - important for understanding flow
                logger.info(f"[Swarm] Handoff: {from_node or '?'} → {to_nodes[0] if to_nodes else '?'}")

            # Final result
            elif event_type == "multiagent_result":
                result = event.get("result", {})

                status = "completed"
                if hasattr(result, "status"):
                    status = result.status.value if hasattr(result.status, "value") else str(result.status)
                elif isinstance(result, dict):
                    status = result.get("status", "completed")

                # Check if last node was NOT responder (fallback case)
                # In this case, include the accumulated text as final_response
                final_response = None
                final_node_id = None
                if node_history:
                    last_node = node_history[-1]
                    if last_node != "responder":
                        # Fallback: non-responder ended without handoff
                        accumulated_text = node_text_accumulator.get(last_node, "")
                        if accumulated_text.strip():
                            final_response = accumulated_text
                            final_node_id = last_node
                            logger.info(f"[Swarm] Fallback response from {last_node} ({len(accumulated_text)} chars)")

                # Add any remaining text segment after the last tool
                if responder_current_text.strip():
                    responder_content_blocks.append({"text": responder_current_text})

                # Fallback: if no content blocks but have fallback response
                if not responder_content_blocks and final_response:
                    responder_content_blocks.append({"text": final_response})

                # Save turn to unified storage (same format as normal agent)
                if responder_content_blocks:
                    swarm_state = {
                        "node_history": node_history,
                        "shared_context": swarm_shared_context,
                    }
                    message_store.save_turn(
                        user_message=user_query,
                        content_blocks=responder_content_blocks,
                        swarm_state=swarm_state
                    )

                complete_event = SwarmCompleteEvent(
                    total_nodes=len(node_history),
                    node_history=node_history,
                    status=status,
                    final_response=final_response,
                    final_node_id=final_node_id,
                    shared_context=swarm_shared_context
                )
                yield f"data: {json.dumps(complete_event.model_dump())}\n\n"

                # Final complete event with usage
                final_usage = {k: v for k, v in total_usage.items() if v > 0}
                yield f"data: {json.dumps({'type': 'complete', 'usage': final_usage if final_usage else None})}\n\n"

                # Keep complete at INFO - summary of the entire flow
                logger.info(f"[Swarm] Complete: {len(node_history)} nodes, tokens={total_usage['inputTokens']+total_usage['outputTokens']}")

    except Exception as e:
        logger.error(f"[Swarm] Error: {e}")
        import traceback
        traceback.print_exc()
        # Error occurred - don't save incomplete turn
        yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    finally:
        yield f"data: {json.dumps({'type': 'end'})}\n\n"


@router.post("/invocations")
async def invocations(request: InvocationRequest, http_request: Request):
    input_data = request.input

    if input_data.warmup:
        from datetime import datetime
        logger.info(f"[Warmup] Container warmed - session={input_data.session_id}, user={input_data.user_id}")

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

    span = trace.get_current_span()
    span.set_attribute("user.id", input_data.user_id or "anonymous")
    span.set_attribute("session.id", input_data.session_id)

    logger.debug(f"Invocation: session={input_data.session_id}, swarm={input_data.swarm or False}")

    try:
        # ============================================================
        # Swarm Mode: Multi-Agent Orchestration
        # ============================================================
        if input_data.swarm:

            # Use swarm orchestration stream with disconnect awareness
            stream = swarm_orchestration_stream(input_data, http_request)
            wrapped_stream = disconnect_aware_stream(
                stream,
                http_request,
                input_data.session_id
            )

            return StreamingResponse(
                wrapped_stream,
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                    "Connection": "keep-alive",
                    "X-Session-ID": input_data.session_id,
                    "X-Swarm": "true"
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
