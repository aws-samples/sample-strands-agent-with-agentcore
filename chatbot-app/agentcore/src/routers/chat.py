"""Chat router - handles agent execution and SSE streaming
Implements AgentCore Runtime standard endpoints:
- POST /invocations (required)
- GET /ping (required)

Agent execution is decoupled from SSE connections via ExecutionRegistry.
Agent runs as a background task appending events to a buffer.
SSE connections tail the buffer so the agent continues running even if the client disconnects.
Resume/reconnection is handled by the BFF-side event buffer (Next.js).
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError
from fastapi.responses import StreamingResponse
from typing import AsyncGenerator, List, Optional
import asyncio
import logging
import json
import os
import time
import uuid
from opentelemetry import trace

from models.schemas import InvocationRequest
from agents.factory import create_agent
from streaming.agui_event_processor import AGUIStreamEventProcessor
from streaming.execution_registry import ExecutionRegistry, ExecutionStatus
from ag_ui.core import RunAgentInput
from ag_ui.encoder import EventEncoder

logger = logging.getLogger(__name__)

registry = ExecutionRegistry()


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


def _inject_event_id(data: str, event_id: int) -> str:
    """Inject eventId into JSON payload of each SSE data line.

    AG-UI HttpAgent doesn't expose SSE ``id:`` fields to the application,
    so we embed the event_id inside the JSON object as ``eventId`` so that
    the frontend can track cursor position for reconnection.
    """
    lines = data.split("\n")
    result = []
    for line in lines:
        if line.startswith("data: "):
            try:
                obj = json.loads(line[6:])
                obj["eventId"] = event_id
                result.append(f"data: {json.dumps(obj, ensure_ascii=False)}")
            except (json.JSONDecodeError, TypeError):
                result.append(line)
        else:
            result.append(line)
    return "\n".join(result)


def _extract_event_type(sse_chunk: str) -> str:
    """Extract event type from an SSE data chunk for logging/tracking."""
    try:
        for line in sse_chunk.strip().split("\n"):
            if line.startswith("data: "):
                data = json.loads(line[6:])
                return data.get("type", "unknown")
    except (json.JSONDecodeError, AttributeError):
        pass
    return "unknown"


async def _create_tail_stream(
    execution,
    cursor: int,
    http_request: Request,
) -> AsyncGenerator[str, None]:
    """
    Tail an execution's event buffer, yielding SSE events with id: prefixes.

    1. Replays buffered events from cursor position
    2. Waits for new events via asyncio.Event (no polling)
    3. Stops when client disconnects (agent keeps running)
    4. Stops when execution completes and all events are delivered
    """
    execution.subscribers += 1
    try:
        # Emit execution metadata so the client knows how to resume
        # Use uppercase "CUSTOM" to comply with AG-UI event schema validation
        meta = json.dumps({
            "type": "CUSTOM",
            "name": "execution_meta",
            "value": {
                "executionId": execution.execution_id,
                "cursor": cursor,
            },
        })
        yield f"id: 0\ndata: {meta}\n\n"

        current_cursor = cursor
        while True:
            # Check for client disconnect — agent continues in background
            if await http_request.is_disconnected():
                logger.info(f"[TailStream] Client disconnected for {execution.execution_id}, agent continues")
                break

            new_events = execution.get_events_from(current_cursor)
            for event in new_events:
                # Inject eventId into JSON payload (needed for AG-UI HttpAgent
                # which doesn't expose SSE id: fields to the application layer)
                enriched_data = _inject_event_id(event.data, event.event_id)
                yield f"id: {event.event_id}\n{enriched_data}"
                current_cursor = event.event_id

            # Execution done + all events delivered → close stream
            if execution.status != ExecutionStatus.RUNNING and not execution.get_events_from(current_cursor):
                break

            # Wait for new events (5s timeout for periodic disconnect check)
            try:
                await asyncio.wait_for(
                    execution._new_event.wait(),
                    timeout=5.0,
                )
                # Clear after waking so next wait() blocks until a new set()
                execution._new_event.clear()
            except asyncio.TimeoutError:
                continue
    finally:
        execution.subscribers -= 1


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

        # Create execution in registry with unique run_id
        run_id = str(uuid.uuid4())
        execution = registry.create_execution(input_data.session_id, input_data.user_id, run_id)

        # Run agent as background task — events buffered in execution
        async def run_agent_to_buffer():
            try:
                stream = agent.stream_async(
                    message_content,
                    files=input_data.files,
                    selected_artifact_id=input_data.selected_artifact_id,
                    api_keys=input_data.api_keys,
                    **special_params
                )
                async for sse_chunk in stream:
                    event_type = _extract_event_type(sse_chunk)
                    execution.append_event(sse_chunk, event_type)
            except Exception as e:
                logger.error(f"[Execution] Agent error for {execution.execution_id}: {e}", exc_info=True)
                error_event = f'data: {json.dumps({"type": "error", "message": str(e)})}\n\n'
                execution.append_event(error_event, "error")
            finally:
                if execution.status == ExecutionStatus.RUNNING:
                    execution.status = ExecutionStatus.COMPLETED
                execution.completed_at = time.time()
                logger.info(f"[Execution] Completed {execution.execution_id}, {len(execution.events)} events buffered")

        execution.task = asyncio.create_task(run_agent_to_buffer())

        # Return tail stream that replays buffer + follows live events
        tail_stream = _create_tail_stream(execution, cursor=0, http_request=http_request)
        final_stream = keepalive_stream(tail_stream, input_data.session_id)

        return StreamingResponse(
            final_stream,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
                "X-Session-ID": input_data.session_id,
                "X-Request-Type": request_type,
                "X-Execution-ID": execution.execution_id,
                "X-Run-ID": run_id,
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

        accept = http_request.headers.get("accept", "")
        media_type = EventEncoder(accept=accept).get_content_type()

        # Create execution in registry
        execution = registry.create_execution(session_id, user_id, run_id)
        execution.media_type = media_type

        # Run agent as background task — events buffered in execution
        async def run_agui_to_buffer():
            try:
                stream = agui_processor.process_stream(
                    agent.agent,
                    message,
                    session_id=session_id,
                    invocation_state=invocation_state,
                )
                async for sse_chunk in stream:
                    event_type = _extract_event_type(sse_chunk)
                    execution.append_event(sse_chunk, event_type)
            except Exception as e:
                logger.error(f"[Execution] AG-UI agent error for {execution.execution_id}: {e}", exc_info=True)
                error_event = f'data: {json.dumps({"type": "error", "message": str(e)})}\n\n'
                execution.append_event(error_event, "error")
            finally:
                if execution.status == ExecutionStatus.RUNNING:
                    execution.status = ExecutionStatus.COMPLETED
                execution.completed_at = time.time()
                logger.info(f"[Execution] AG-UI completed {execution.execution_id}, {len(execution.events)} events buffered")

        execution.task = asyncio.create_task(run_agui_to_buffer())

        # Return tail stream
        tail_stream = _create_tail_stream(execution, cursor=0, http_request=http_request)
        final_stream = keepalive_stream(tail_stream, session_id)

        return StreamingResponse(
            final_stream,
            media_type=media_type,
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
                "X-Thread-ID": thread_id,
                "X-Execution-ID": execution.execution_id,
                "X-Run-ID": run_id,
            }
        )

    except Exception as e:
        logger.error(f"Error in AG-UI invocation: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Agent processing failed. Please check logs for details."
        )


@router.on_event("startup")
async def start_cleanup_task():
    """Periodically clean up expired execution buffers."""
    async def periodic_cleanup():
        while True:
            await asyncio.sleep(60)
            try:
                registry.cleanup_expired()
            except Exception as e:
                logger.error(f"[ExecutionRegistry] Cleanup error: {e}")
    asyncio.create_task(periodic_cleanup())
