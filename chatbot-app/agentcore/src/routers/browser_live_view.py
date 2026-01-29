"""Browser Live View API endpoint

Provides presigned URLs for DCV live view connections.
Uses BrowserClient SDK to generate properly signed URLs.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
import logging
import os

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/browser/live-view")
async def get_browser_live_view_url(sessionId: str, browserId: str):
    """Get presigned live view URL for browser session.

    This endpoint supports both:
    1. Builtin browser tools (uses cached controller)
    2. A2A Browser Use Agent (creates new BrowserClient)

    Query Parameters:
        sessionId: Browser session ID (from metadata)
        browserId: Browser identifier

    Returns:
        JSONResponse with:
        - presignedUrl: WSS URL with AWS SigV4 signature
        - sessionId: Browser session ID
        - browserId: Browser identifier
        - expiresIn: URL expiration time (seconds)
    """
    try:
        logger.info(f"[Live View] Request for browser sessionId={sessionId}, browserId={browserId}")

        # Import here to avoid circular dependencies
        from builtin_tools.lib.browser_controller import _browser_sessions
        from bedrock_agentcore.tools.browser_client import BrowserClient

        # Strategy 1: Try to find builtin browser tool controller
        controller = None
        for chat_session_id, ctrl in _browser_sessions.items():
            if (ctrl.browser_session_client and
                ctrl.browser_session_client.session_id == sessionId):
                controller = ctrl
                logger.info(f"[Live View] Found builtin browser controller for chat session: {chat_session_id}")
                break

        # Strategy 2: If not found, create new BrowserClient for A2A browser session
        if not controller:
            logger.info(f"[Live View] No builtin controller found, creating BrowserClient for A2A session")

            if not browserId:
                raise HTTPException(
                    status_code=400,
                    detail="browserId is required for A2A browser sessions"
                )

            # Create BrowserClient to generate live view URL
            try:
                region = os.getenv('AWS_REGION', 'us-west-2')
                browser_client = BrowserClient(region=region)

                # Set session_id directly (don't call start - session already exists)
                browser_client.session_id = sessionId
                browser_client.browser_id = browserId

                logger.info(f"[Live View] Created BrowserClient for A2A session: {sessionId}")

                # Generate presigned live view URL using SDK
                expires = 300
                presigned_url = browser_client.generate_live_view_url(expires=expires)

                logger.info(
                    f"[Live View] Generated fresh presigned URL for A2A session {sessionId}: "
                    f"{presigned_url[:100]}..."
                )

                return JSONResponse(
                    status_code=200,
                    content={
                        "success": True,
                        "presignedUrl": presigned_url,
                        "sessionId": sessionId,
                        "browserId": browserId,
                        "expiresIn": expires,
                    }
                )

            except Exception as e:
                logger.error(f"[Live View] Failed to create BrowserClient for A2A session: {e}", exc_info=True)
                raise HTTPException(
                    status_code=500,
                    detail="Failed to access browser session. Please check logs for details."
                )

        # Strategy 1 success: Use builtin controller
        if not controller.browser_session_client:
            raise HTTPException(
                status_code=400,
                detail="Browser session client not initialized"
            )

        # Verify browser IDs match (for builtin tools)
        if controller.browser_id != browserId:
            logger.warning(
                f"[Live View] Browser ID mismatch: requested={browserId}, "
                f"controller={controller.browser_id}"
            )

        # Generate presigned live view URL using SDK
        # Note: SDK limits expires to max 300 seconds (5 minutes)
        expires = 300

        try:
            presigned_url = controller.browser_session_client.generate_live_view_url(
                expires=expires
            )

            # Keep HTTPS format - DCV SDK handles WebSocket conversion internally
            logger.info(
                f"[Live View] Generated fresh presigned URL for builtin session {sessionId}: "
                f"{presigned_url[:100]}..."
            )

            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    "presignedUrl": presigned_url,
                    "sessionId": sessionId,
                    "browserId": browserId,
                    "expiresIn": expires,
                }
            )

        except Exception as e:
            import traceback
            logger.error(f"[Live View] Failed to generate presigned URL: {e}")
            logger.error(f"[Live View] Traceback: {traceback.format_exc()}")
            raise HTTPException(
                status_code=500,
                detail="Failed to generate live view URL. Please check logs for details."
            )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[Live View] Unexpected error: {e}")
        logger.error(f"[Live View] Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error. Please check logs for details."
        )
