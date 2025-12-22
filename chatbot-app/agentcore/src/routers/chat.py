"""Chat router - handles agent execution and SSE streaming
Implements AgentCore Runtime standard endpoints:
- POST /invocations (required)
- GET /ping (required)
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Dict, Any, Optional, List
import logging
import asyncio
import json

from models.schemas import ChatRequest, ChatEvent
from agent.agent import ChatbotAgent

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


# Import FileContent from schemas
from models.schemas import FileContent


# AgentCore Runtime Standard Request/Response Models
class InvocationInput(BaseModel):
    """Input for /invocations endpoint"""
    user_id: str
    session_id: str
    message: str
    model_id: Optional[str] = None
    temperature: Optional[float] = None
    system_prompt: Optional[str] = None
    caching_enabled: Optional[bool] = None
    enabled_tools: Optional[List[str]] = None  # User-specific tool preferences
    files: Optional[List[FileContent]] = None  # Multimodal file attachments


class InvocationRequest(BaseModel):
    """AgentCore Runtime standard request format"""
    input: InvocationInput


class InvocationResponse(BaseModel):
    """AgentCore Runtime standard response format"""
    output: Dict[str, Any]

def get_agent(
    session_id: str,
    user_id: Optional[str] = None,
    enabled_tools: Optional[List[str]] = None,
    model_id: Optional[str] = None,
    temperature: Optional[float] = None,
    system_prompt: Optional[str] = None,
    caching_enabled: Optional[bool] = None
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
    logger.info(f"  Tools: {enabled_tools or 'all'}")

    # Create agent with AgentCore Memory - messages and preferences automatically loaded/saved
    agent = ChatbotAgent(
        session_id=session_id,
        user_id=user_id,
        enabled_tools=enabled_tools,
        model_id=model_id,
        temperature=temperature,
        system_prompt=system_prompt,
        caching_enabled=caching_enabled
    )

    return agent


# ============================================================
# AgentCore Runtime Standard Endpoints (REQUIRED)
# ============================================================

@router.get("/ping")
async def ping():
    """Health check endpoint (required by AgentCore Runtime)"""
    return {"status": "healthy"}


@router.post("/invocations")
async def invocations(request: InvocationRequest):
    """
    AgentCore Runtime standard invocation endpoint (required)

    Supports user-specific tool filtering and SSE streaming.
    Creates/caches agent instance per session + tool configuration.
    """
    input_data = request.input
    logger.info(f"Invocation request - Session: {input_data.session_id}, User: {input_data.user_id}")
    logger.info(f"Message: {input_data.message[:50]}...")

    if input_data.enabled_tools:
        logger.info(f"Enabled tools ({len(input_data.enabled_tools)}): {input_data.enabled_tools}")

    if input_data.files:
        logger.info(f"Files attached: {len(input_data.files)} files")
        for file in input_data.files:
            logger.info(f"  - {file.filename} ({file.content_type})")

    try:
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
            caching_enabled=input_data.caching_enabled
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

        # Stream response from agent as SSE
        return StreamingResponse(
            stream,
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


# ============================================================
# Legacy Endpoints (for backward compatibility)
# ============================================================

@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    Legacy chat stream endpoint (for backward compatibility)
    Uses default tools (all available) if enabled_tools not specified
    """
    logger.info(f"Legacy chat request - Session: {request.session_id}, Message: {request.message[:50]}...")

    try:
        # Check if message contains interrupt response (HITL workflow)
        interrupt_response_data = None
        actual_message = request.message

        try:
            # Try to parse as JSON array (frontend sends interruptResponse this way)
            parsed = json.loads(request.message)
            if isinstance(parsed, list) and len(parsed) > 0:
                first_item = parsed[0]
                if isinstance(first_item, dict) and "interruptResponse" in first_item:
                    interrupt_response_data = first_item["interruptResponse"]
                    logger.info(f"🔔 Interrupt response detected: {interrupt_response_data}")
        except (json.JSONDecodeError, TypeError, KeyError):
            # Not a JSON interrupt response, treat as normal message
            pass

        # Get agent instance (with or without tool filtering)
        agent = get_agent(
            session_id=request.session_id,
            enabled_tools=request.enabled_tools  # May be None (use all tools)
        )

        # Wrap stream to ensure flush on disconnect and prevent further processing
        async def stream_with_cleanup():
            client_disconnected = False

            # If this is an interrupt response, resume agent with it
            if interrupt_response_data:
                interrupt_id = interrupt_response_data.get("interruptId")
                response = interrupt_response_data.get("response")
                logger.info(f"🔄 Resuming agent with interrupt response: {interrupt_id} = {response}")

                # Resume the agent by providing interrupt response as prompt
                # Strands SDK expects a list of content blocks with interruptResponse
                interrupt_prompt = [{
                    "interruptResponse": {
                        "interruptId": interrupt_id,
                        "response": response
                    }
                }]
                stream_iterator = agent.stream_async(interrupt_prompt, session_id=request.session_id)
            else:
                # Normal message
                stream_iterator = agent.stream_async(actual_message, session_id=request.session_id)

            try:
                async for event in stream_iterator:
                    # Check if client disconnected before yielding
                    if await request.is_disconnected():
                        client_disconnected = True
                        logger.info(f"🔌 Client disconnected during streaming for session {request.session_id}")
                        # No flush needed - messages are already saved immediately
                        break

                    yield event
            except asyncio.CancelledError:
                # Client disconnected (e.g., stop button clicked)
                client_disconnected = True
                logger.warning(f"⚠️ Client disconnected during streaming for session {request.session_id}")

                # Mark agent as cancelled to prevent further tool execution
                if hasattr(agent, 'cancelled'):
                    agent.cancelled = True
                    logger.info(f"🚫 Agent marked as cancelled - will stop tool execution")

                # No buffering logic needed - messages are already saved immediately

                raise  # Re-raise to properly close the connection
            except Exception as e:
                logger.error(f"Error during streaming: {e}")
                # No flush needed - messages are already saved immediately
                raise
            finally:
                # Cleanup: close the stream iterator if possible
                if hasattr(stream_iterator, 'aclose'):
                    try:
                        await stream_iterator.aclose()
                    except Exception:
                        pass

        # Stream response from agent
        return StreamingResponse(
            stream_with_cleanup(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "X-Session-ID": request.session_id
            }
        )

    except Exception as e:
        logger.error(f"Error in chat_stream: {e}")

        async def error_generator():
            error_data = {
                "type": "error",
                "message": str(e)
            }
            yield f"data: {json.dumps(error_data)}\n\n"

        return StreamingResponse(
            error_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no"
            }
        )


@router.post("/chat/multimodal")
async def chat_multimodal(request: ChatRequest):
    """
    Stream chat response with multimodal input (files)

    For now, just echoes the message and mentions files.
    Will be replaced with actual Strands Agent execution.
    """
    logger.info(f"Multimodal chat request - Session: {request.session_id}")
    logger.info(f"Message: {request.message[:50]}...")
    if request.files:
        logger.info(f"Files: {len(request.files)} uploaded")
        for file in request.files:
            logger.info(f"  - {file.filename} ({file.content_type})")

    async def event_generator():
        try:
            # Send init event
            event = ChatEvent(
                type="init",
                content="Processing multimodal input",
                metadata={"session_id": request.session_id, "file_count": len(request.files or [])}
            )
            yield f"data: {event.to_json()}\n\n"
            await asyncio.sleep(0.2)

            # Echo message
            response_text = f"Received message: '{request.message}'"
            if request.files:
                response_text += f" and {len(request.files)} file(s): "
                response_text += ", ".join([f.filename for f in request.files])

            for word in response_text.split():
                event = ChatEvent(
                    type="text",
                    content=word + " "
                )
                yield f"data: {event.to_json()}\n\n"
                await asyncio.sleep(0.05)

            # Complete
            event = ChatEvent(
                type="complete",
                content="Multimodal processing complete"
            )
            yield f"data: {event.to_json()}\n\n"

        except Exception as e:
            logger.error(f"Error in multimodal event_generator: {e}")
            error_event = ChatEvent(
                type="error",
                content=str(e)
            )
            yield f"data: {error_event.to_json()}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )
