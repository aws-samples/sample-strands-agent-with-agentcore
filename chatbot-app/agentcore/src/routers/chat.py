"""Chat router - handles agent execution and SSE streaming
Implements AgentCore Runtime standard endpoints:
- POST /invocations (required)
- GET /ping (required)
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional, List
import logging
import json

from models.schemas import InvocationRequest
from agent.agent import ChatbotAgent

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

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
