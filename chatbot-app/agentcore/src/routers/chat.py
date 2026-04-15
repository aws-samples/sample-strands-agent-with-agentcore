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
from fastapi.responses import StreamingResponse
from typing import AsyncGenerator, List, Optional
import asyncio
import logging
import json
import os
import time
import uuid
from opentelemetry import trace

from models.schemas import FileContent
from agent.processor.multimodal_builder import build_prompt
from agents.factory import create_agent
from streaming.agui_event_processor import AGUIStreamEventProcessor
from streaming.execution_registry import ExecutionRegistry, ExecutionStatus
from ag_ui.core import RunAgentInput
from ag_ui.encoder import EventEncoder

logger = logging.getLogger(__name__)

registry = ExecutionRegistry()


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
    Main endpoint for agent invocations (AG-UI protocol only).

    All requests use AG-UI RunAgentInput format (thread_id + run_id).
    Lifecycle actions (warmup, stop, elicitation) are indicated via state.action.
    """
    body = await http_request.json()

    # AG-UI state에서 lifecycle action 확인
    state = body.get("state") or {}
    action = state.get("action")
    thread_id = body.get("thread_id", "")

    # Debug: log incoming action for stop signal troubleshooting
    if action:
        logger.info(f"[Invocation] action={action}, thread_id={thread_id}, state_keys={list(state.keys())}")

    # Warmup — triggers container cold start, Python modules load (TOOL_REGISTRY, etc.)
    if action == "warmup":
        user_id = state.get("user_id", "anonymous")
        logger.info(f"[Warmup] Container warmed - session={thread_id}, user={user_id}")
        return {"status": "warm"}

    # Stop
    if action == "stop":
        user_id = state.get("user_id", "anonymous")
        from agent.stop_signal import get_stop_signal_provider
        provider = get_stop_signal_provider()
        provider.request_stop(user_id, thread_id)
        logger.info(f"[Stop] Stop signal set for session={thread_id}")
        return {"status": "stop_requested", "session_id": thread_id}

    # Elicitation complete — write to shared store (DynamoDB in cloud, in-memory locally)
    if action == "elicitation_complete":
        from agent.mcp.elicitation_bridge import signal_elicitation_complete
        elicitation_id = state.get("elicitation_id")
        signal_elicitation_complete(thread_id, elicitation_id)
        logger.info(f"[Elicitation] Complete for session={thread_id}, elicitation_id={elicitation_id}")
        return {"status": "elicitation_completed"}

    # Normal agent execution — requires thread_id + run_id
    if "thread_id" not in body or "run_id" not in body:
        raise HTTPException(status_code=422, detail="AG-UI format required: thread_id and run_id are required")

    return await _handle_agui_invocation(body, http_request)


@router.get("/ping")
async def ping():
    """Health check endpoint required by AgentCore Runtime."""
    return {"status": "healthy"}


def _parse_message(message: str, request_type: str) -> tuple[str, dict]:
    """
    Parse message for special cases (HITL interrupt response).

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

    # Normal message - no special handling
    return message, special_params


async def _handle_agui_invocation(body: dict, http_request: Request) -> StreamingResponse:
    """Handle AG-UI protocol RunAgentInput requests."""
    # forwarded_props is required by RunAgentInput but optional in practice; default to None
    body = {**body, "forwarded_props": body.get("forwarded_props")}
    for tool in body.get("tools", []):
        if "parameters" not in tool:
            tool["parameters"] = {}
    input_data = RunAgentInput(**body)
    thread_id = input_data.thread_id
    run_id = input_data.run_id

    session_id = thread_id
    user_id = "agui"
    if input_data.state and isinstance(input_data.state, dict):
        user_id = input_data.state.get("user_id", "agui")

    message = ""
    image_content_parts = []  # Inline base64 images from AG-UI multimodal
    doc_content_parts = []    # Inline base64 documents (PDF, DOCX, etc.)
    if input_data.messages:
        for msg in reversed(input_data.messages):
            if msg.role == "user":
                content = msg.content
                if isinstance(content, str):
                    message = content
                elif isinstance(content, list):
                    for part in content:
                        part_dict = part if isinstance(part, dict) else (part.dict() if hasattr(part, "dict") else {})
                        part_type = part_dict.get("type") or (getattr(part, "type", None))
                        if part_type == "text":
                            message = part_dict.get("text") or getattr(part, "text", "") or ""
                        elif part_type == "binary":
                            mime_type = (part_dict.get("mime_type") or part_dict.get("mimeType")
                                         or getattr(part, "mime_type", "") or "")
                            data = part_dict.get("data") or getattr(part, "data", "") or ""
                            filename = part_dict.get("filename") or getattr(part, "filename", "") or ""
                            if mime_type.startswith("image/"):
                                image_content_parts.append({
                                    "mediaType": mime_type,
                                    "data": data,
                                    "name": filename or "",
                                })
                            else:
                                doc_content_parts.append({
                                    "mediaType": mime_type or "application/octet-stream",
                                    "data": data,
                                    "name": filename or "document",
                                })
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
    compaction_enabled = None
    request_type = "normal"
    auth_token = None
    selected_artifact_id = None
    api_keys = None
    if input_data.state and isinstance(input_data.state, dict):
        model_id = input_data.state.get("model_id")
        temperature = input_data.state.get("temperature")
        system_prompt = input_data.state.get("system_prompt")
        caching_enabled = input_data.state.get("caching_enabled")
        compaction_enabled = input_data.state.get("compaction_enabled")
        request_type = input_data.state.get("request_type", "normal")
        auth_token = input_data.state.get("auth_token")
        selected_artifact_id = input_data.state.get("selected_artifact_id")
        api_keys = input_data.state.get("api_keys")

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
            compaction_enabled=compaction_enabled,
            api_keys=api_keys,
            auth_token=auth_token,
        )

        agui_processor = AGUIStreamEventProcessor(thread_id=thread_id, run_id=run_id)

        os.environ["SESSION_ID"] = session_id
        os.environ["USER_ID"] = user_id

        invocation_state = {
            "session_id": session_id,
            "user_id": user_id,
            "model_id": agent.model_id,
            "session_manager": agent.session_manager,
            "selected_artifact_id": selected_artifact_id,
        }

        accept = http_request.headers.get("accept", "")
        media_type = EventEncoder(accept=accept).get_content_type()

        # Create execution in registry
        execution = await registry.create_execution(session_id, user_id, run_id)
        execution.media_type = media_type

        # Parse message for special cases (HITL interrupt response)
        message_content, special_params = _parse_message(message, request_type)

        # Build multimodal message using build_prompt() (handles size checks, sanitization, workspace storage)
        if isinstance(message_content, list):
            # HITL interrupt response — bypass build_prompt, pass as-is to SDK.
            # SDK restores _interrupt_state from session via initialize_internal_state().
            agui_message = message_content
        else:
            raw_files = []
            for img in image_content_parts:
                raw_files.append(FileContent(
                    filename=img.get("name") or "image",
                    content_type=img.get("mediaType", "image/png"),
                    bytes=img.get("data", ""),
                ))
            for doc in doc_content_parts:
                raw_files.append(FileContent(
                    filename=doc.get("name") or "document",
                    content_type=doc.get("mediaType", "application/octet-stream"),
                    bytes=doc.get("data", ""),
                ))
            agui_message, _ = build_prompt(
                message=message_content,
                files=raw_files or None,
                user_id=user_id,
                session_id=session_id,
                auto_store=True,
            )

        # Run agent as background task — events buffered in execution
        async def run_agui_to_buffer():
            try:
                stream = agui_processor.process_stream(
                    agent.agent,
                    agui_message,
                    session_id=session_id,
                    invocation_state=invocation_state,
                    elicitation_bridge=getattr(agent, 'elicitation_bridge', None),
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
                "X-Session-ID": thread_id,
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


_cleanup_task: Optional[asyncio.Task] = None


@router.on_event("startup")
async def start_cleanup_task():
    """Periodically clean up expired execution buffers."""
    global _cleanup_task

    async def periodic_cleanup():
        while True:
            await asyncio.sleep(60)
            try:
                await registry.cleanup_expired()
            except Exception as e:
                logger.error(f"[ExecutionRegistry] Cleanup error: {e}")

    _cleanup_task = asyncio.create_task(periodic_cleanup())


@router.on_event("shutdown")
async def stop_cleanup_task():
    """Cancel cleanup task on shutdown."""
    global _cleanup_task
    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass
        _cleanup_task = None
