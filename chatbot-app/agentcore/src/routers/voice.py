"""
Voice Chat WebSocket Router

Handles real-time bidirectional audio streaming for voice chat
using Nova Sonic speech-to-speech model via BidiAgent.

Architecture:
- Local mode: Direct WebSocket to /voice/stream
- Cloud mode: AgentCore Runtime routes WebSocket to /ws on container
  - URL format: wss://bedrock-agentcore.<region>.amazonaws.com/runtimes/<arn>/ws
  - BFF generates SigV4 pre-signed URL for browser authentication
"""

import asyncio
import json
import logging
import uuid
from typing import Optional, List, TYPE_CHECKING
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

logger = logging.getLogger(__name__)

# Lazy import to avoid pyaudio dependency at module load time
VoiceChatbotAgent = None

def _get_voice_agent_class():
    global VoiceChatbotAgent
    if VoiceChatbotAgent is None:
        from agent.voice_agent import VoiceChatbotAgent as _VoiceChatbotAgent
        VoiceChatbotAgent = _VoiceChatbotAgent
    return VoiceChatbotAgent

router = APIRouter()

# Active voice sessions (session_id -> VoiceChatbotAgent)
_active_sessions: dict = {}


@router.websocket("/voice/stream")
async def voice_stream(
    websocket: WebSocket,
    session_id: Optional[str] = Query(None, description="Session ID (from BFF)"),
    user_id: Optional[str] = Query(None, description="User ID (from BFF)"),
    enabled_tools: Optional[str] = Query(None, description="JSON array of enabled tool IDs"),
):
    """
    WebSocket endpoint for real-time voice chat

    Protocol:
    - Client sends: {"type": "bidi_audio_input", "audio": "<base64>", ...}
    - Server sends: {"type": "bidi_audio_stream", "audio": "<base64>", ...}
                    {"type": "bidi_transcript_stream", "role": "user|assistant", "text": "...", ...}
                    {"type": "bidi_interruption", ...}
                    {"type": "tool_use", ...}
                    {"type": "tool_result", ...}
    """
    await websocket.accept()

    # Auto-generate session ID if not provided
    if not session_id:
        session_id = str(uuid.uuid4())
        logger.info(f"[Voice] Generated new session ID: {session_id}")

    logger.info(f"[Voice] WebSocket connected: session={session_id}, user={user_id}")

    # Parse enabled tools
    tools_list: List[str] = []
    if enabled_tools:
        try:
            tools_list = json.loads(enabled_tools)
        except json.JSONDecodeError:
            logger.warning(f"[Voice] Failed to parse enabled_tools: {enabled_tools}")

    voice_agent = None

    try:
        # Create voice agent (but don't start yet)
        VoiceAgentClass = _get_voice_agent_class()
        voice_agent = VoiceAgentClass(
            session_id=session_id,
            user_id=user_id,
            enabled_tools=tools_list,
        )

        # Store in active sessions
        _active_sessions[session_id] = voice_agent

        # Send connection established event FIRST (before starting agent)
        # Note: AgentCore Runtime WebSocket proxy may drop this message,
        # but client handles it via first-message detection workaround
        await websocket.send_json({
            "type": "bidi_connection_start",
            "connection_id": session_id,
            "status": "connected",
        })

        # Now start the voice agent (connects to Nova Sonic)
        await voice_agent.start()
        logger.info(f"[Voice] Voice agent started: session={session_id}")

        # Create tasks for bidirectional communication
        receive_task = asyncio.create_task(
            _receive_from_client(websocket, voice_agent, session_id)
        )
        send_task = asyncio.create_task(
            _send_to_client(websocket, voice_agent, session_id)
        )

        # Wait for either task to complete (one will complete when connection closes)
        done, pending = await asyncio.wait(
            [receive_task, send_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        # Cancel pending tasks
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        # Check for exceptions in completed tasks
        for task in done:
            if task.exception():
                logger.error(f"[Voice] Task error: {task.exception()}")

    except WebSocketDisconnect:
        logger.info(f"[Voice] WebSocket disconnected: session={session_id}")

    except Exception as e:
        logger.error(f"[Voice] Error: {e}", exc_info=True)
        try:
            await websocket.send_json({
                "type": "bidi_error",
                "message": str(e),
            })
        except Exception as send_err:
            logger.debug(f"[Voice] Failed to send error to client: {send_err}")

    finally:
        # Cleanup
        if session_id in _active_sessions:
            del _active_sessions[session_id]

        if voice_agent:
            try:
                await voice_agent.stop()
            except Exception as e:
                logger.error(f"[Voice] Error stopping agent: {e}")

        try:
            await websocket.close()
        except Exception as close_err:
            logger.debug(f"[Voice] Failed to close websocket: {close_err}")

        logger.info(f"[Voice] Session cleaned up: {session_id}")


async def _receive_from_client(
    websocket: WebSocket,
    voice_agent: VoiceChatbotAgent,
    session_id: str,
) -> None:
    """Receive messages from WebSocket client and forward to agent"""
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "bidi_audio_input":
                # Forward audio to agent
                audio = data.get("audio")
                sample_rate = data.get("sample_rate", 16000)
                if audio:
                    await voice_agent.send_audio(audio, sample_rate)

            elif msg_type == "bidi_text_input":
                # Forward text to agent
                text = data.get("text")
                if text:
                    await voice_agent.send_text(text)

            elif msg_type == "ping":
                # Respond to ping
                await websocket.send_json({"type": "pong"})

            elif msg_type == "stop":
                # Client requested stop
                logger.info(f"[Voice] Client requested stop: session={session_id}")
                break

            else:
                logger.warning(f"[Voice] Unknown message type: {msg_type}")

    except WebSocketDisconnect:
        logger.info(f"[Voice] Client disconnected: session={session_id}")
        raise

    except asyncio.CancelledError:
        logger.debug(f"[Voice] Receive task cancelled: session={session_id}")
        raise

    except Exception as e:
        logger.error(f"[Voice] Receive error: {e}", exc_info=True)
        raise


async def _send_to_client(
    websocket: WebSocket,
    voice_agent,
    session_id: str,
) -> None:
    """Receive events from agent and forward to WebSocket client"""
    try:
        async for event in voice_agent.receive_events():
            await websocket.send_json(event)

    except asyncio.CancelledError:
        logger.debug(f"[Voice] Send task cancelled: session={session_id}")
        raise

    except Exception as e:
        logger.error(f"[Voice] Send error: {e}", exc_info=True)
        raise


@router.get("/voice/sessions")
async def list_voice_sessions():
    """List active voice sessions (for debugging)"""
    return {
        "active_sessions": list(_active_sessions.keys()),
        "count": len(_active_sessions),
    }


@router.delete("/voice/sessions/{session_id}")
async def stop_voice_session(session_id: str):
    """Force stop a voice session"""
    if session_id in _active_sessions:
        voice_agent = _active_sessions[session_id]
        await voice_agent.stop()
        del _active_sessions[session_id]
        return {"status": "stopped", "session_id": session_id}
    return {"status": "not_found", "session_id": session_id}


# =============================================================================
# /ws endpoint for AgentCore Runtime
# AgentCore Runtime routes WebSocket requests to /ws on the container
# This is an alias of /voice/stream for cloud deployment compatibility
# =============================================================================

@router.websocket("/ws")
async def ws_stream(
    websocket: WebSocket,
    session_id: Optional[str] = Query(None, description="Session ID"),
    user_id: Optional[str] = Query(None, description="User ID"),
    enabled_tools: Optional[str] = Query(None, description="JSON array of enabled tool IDs"),
):
    """
    WebSocket endpoint for AgentCore Runtime (cloud mode)

    AgentCore Runtime expects containers to implement WebSocket at /ws path on port 8080.
    This endpoint mirrors /voice/stream for compatibility.
    """
    # Delegate to voice_stream implementation
    await voice_stream(
        websocket=websocket,
        session_id=session_id,
        user_id=user_id,
        enabled_tools=enabled_tools,
    )
