"""
Stop Signal Router

Provides endpoint to set stop signal for graceful stream termination.
Used in local development mode.
"""

import logging
from fastapi import APIRouter
from pydantic import BaseModel
from agent.stop_signal import get_stop_signal_provider

logger = logging.getLogger(__name__)

router = APIRouter()


class StopRequest(BaseModel):
    user_id: str
    session_id: str


class StopResponse(BaseModel):
    success: bool
    message: str
    user_id: str
    session_id: str


@router.post("/stop", response_model=StopResponse)
async def set_stop_signal(request: StopRequest):
    """
    Set stop signal for a user-session.
    AgentCore will check this signal periodically during streaming
    and gracefully stop if set.
    """
    try:
        provider = get_stop_signal_provider()
        provider.request_stop(request.user_id, request.session_id)

        logger.info(f"[StopRouter] Stop signal set for {request.user_id}:{request.session_id}")

        return StopResponse(
            success=True,
            message="Stop signal set",
            user_id=request.user_id,
            session_id=request.session_id
        )

    except Exception as e:
        logger.error(f"[StopRouter] Error setting stop signal: {e}")
        return StopResponse(
            success=False,
            message=str(e),
            user_id=request.user_id,
            session_id=request.session_id
        )
