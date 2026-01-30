"""
Authentication API Routes for SSO Authentication.

This module provides API endpoints for authentication operations:
- /api/auth/callback - Handle OAuth2 callback from Cognito
- /api/auth/logout - Terminate user session
- /api/auth/session - Get current session information

These endpoints work with the Lambda@Edge authentication layer
and the session/user management modules.
"""

import os
import logging
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Request, HTTPException, Response, Cookie
from fastapi.responses import RedirectResponse, JSONResponse
from pydantic import BaseModel, Field

from auth.session_manager import (
    SessionManager,
    SessionConfig,
    SessionMetadata,
    SessionNotFoundError,
    SessionExpiredError,
)
from auth.user_manager import (
    UserManager,
    UserConfig,
    UserNotFoundError,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["authentication"])


# ============================================================
# Request/Response Models
# ============================================================

class CallbackRequest(BaseModel):
    """OAuth2 callback request parameters."""
    code: str = Field(..., description="Authorization code from Cognito")
    state: Optional[str] = Field(None, description="State parameter for CSRF protection")


class CallbackResponse(BaseModel):
    """OAuth2 callback response."""
    success: bool = Field(..., description="Whether callback was successful")
    redirect_url: str = Field(..., description="URL to redirect user to")
    session_id: Optional[str] = Field(None, description="Created session ID")


class LogoutResponse(BaseModel):
    """Logout response."""
    success: bool = Field(..., description="Whether logout was successful")
    message: str = Field(..., description="Logout status message")


class SessionResponse(BaseModel):
    """Session information response."""
    user: dict = Field(..., description="User information")
    session: dict = Field(..., description="Session information")


class ErrorResponse(BaseModel):
    """Error response."""
    error: str = Field(..., description="Error code")
    message: str = Field(..., description="Error message")
    request_id: Optional[str] = Field(None, description="Request ID for support")


# ============================================================
# Dependency Injection
# ============================================================

def get_session_manager() -> SessionManager:
    """Get session manager instance."""
    config = SessionConfig.from_env()
    return SessionManager(config=config)


def get_user_manager() -> UserManager:
    """Get user manager instance."""
    config = UserConfig.from_env()
    return UserManager(config=config)


def get_user_from_request(request: Request) -> dict:
    """Extract user information from request headers or state.
    
    In production, Lambda@Edge adds X-User-* headers after JWT validation.
    In development, the auth middleware may attach user to request.state.
    
    Args:
        request: The FastAPI request object
        
    Returns:
        Dictionary with user information
        
    Raises:
        HTTPException: If user information is not available
    """
    # Try to get from request state (set by auth middleware)
    if hasattr(request.state, 'user') and request.state.user:
        return request.state.user
    
    # Try to get from headers (set by Lambda@Edge)
    user_email = request.headers.get('X-User-Email')
    user_sub = request.headers.get('X-User-Sub')
    user_name = request.headers.get('X-User-Name')
    
    if user_email and user_sub:
        return {
            'email': user_email,
            'sub': user_sub,
            'name': user_name or user_email,
        }
    
    raise HTTPException(
        status_code=401,
        detail="Authentication required"
    )


# ============================================================
# Endpoints
# ============================================================

@router.post("/callback", response_model=CallbackResponse)
async def auth_callback(
    request: Request,
    code: str,
    state: Optional[str] = None,
):
    """Handle OAuth2 callback from Cognito.
    
    This endpoint is called after successful SAML authentication.
    Cognito redirects here with an authorization code that can be
    exchanged for tokens.
    
    In the SSO flow:
    1. User clicks app tile in AWS Access Portal
    2. IAM Identity Center authenticates user (SAML)
    3. Cognito receives SAML assertion and issues auth code
    4. User is redirected here with the code
    5. We create a session and redirect to the application
    
    Note: In production, the actual token exchange happens at
    Lambda@Edge. This endpoint primarily handles session creation
    and user profile management.
    
    Args:
        request: The FastAPI request object
        code: Authorization code from Cognito
        state: Optional state parameter for CSRF protection
        
    Returns:
        CallbackResponse with redirect URL and session ID
    """
    logger.info(f"Auth callback received: code={code[:10]}..., state={state}")
    
    # Get user info from request (should be set by Lambda@Edge or middleware)
    user = get_user_from_request(request)
    
    try:
        # Get managers
        session_manager = get_session_manager()
        user_manager = get_user_manager()
        
        # Create or update user profile
        profile = await user_manager.create_or_update_profile(
            user_id=user['sub'],
            email=user['email'],
            name=user['name'],
        )
        
        # Create session with metadata
        metadata = SessionMetadata(
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get('User-Agent'),
        )
        
        session = await session_manager.create_session(
            user_id=user['sub'],
            email=user['email'],
            name=user['name'],
            metadata=metadata,
        )
        
        logger.info(
            f"Auth callback successful: user={user['email']}, "
            f"session={session.session_id}"
        )
        
        # Determine redirect URL
        redirect_url = state if state and state.startswith('/') else '/'
        
        return CallbackResponse(
            success=True,
            redirect_url=redirect_url,
            session_id=session.session_id,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Auth callback failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Authentication callback failed: {str(e)}"
        )


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    request: Request,
    response: Response,
    session_id: Optional[str] = Cookie(None, alias="session"),
):
    """Terminate user session and logout.
    
    This endpoint:
    1. Deletes the user's session from DynamoDB
    2. Clears the session cookie
    3. Optionally redirects to Cognito logout endpoint
    
    Args:
        request: The FastAPI request object
        response: The FastAPI response object
        session_id: Session ID from cookie
        
    Returns:
        LogoutResponse with success status
    """
    logger.info(f"Logout request: session_id={session_id}")
    
    try:
        user = get_user_from_request(request)
        session_manager = get_session_manager()
        
        # Delete session if provided
        if session_id:
            deleted = await session_manager.delete_session(session_id)
            if deleted:
                logger.info(f"Session deleted: {session_id}")
            else:
                logger.warning(f"Session not found for deletion: {session_id}")
        
        # Clear session cookie
        response.delete_cookie(
            key="session",
            path="/",
            secure=True,
            httponly=True,
            samesite="lax",
        )
        
        logger.info(f"User logged out: {user['email']}")
        
        return LogoutResponse(
            success=True,
            message="Logged out successfully"
        )
        
    except HTTPException:
        # User not authenticated, but still clear cookie
        response.delete_cookie(key="session", path="/")
        return LogoutResponse(
            success=True,
            message="Logged out successfully"
        )
    except Exception as e:
        logger.error(f"Logout failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Logout failed: {str(e)}"
        )


@router.get("/session", response_model=SessionResponse)
async def get_session(
    request: Request,
    session_id: Optional[str] = Cookie(None, alias="session"),
):
    """Get current session information.
    
    Returns the current user and session information.
    This endpoint is used by the frontend to check authentication
    status and get user details.
    
    Args:
        request: The FastAPI request object
        session_id: Session ID from cookie
        
    Returns:
        SessionResponse with user and session information
    """
    try:
        user = get_user_from_request(request)
        
        # Build user response
        user_info = {
            "email": user['email'],
            "sub": user['sub'],
            "name": user['name'],
        }
        
        # Get session info if available
        session_info = {
            "id": session_id,
            "active": True,
        }
        
        if session_id:
            try:
                session_manager = get_session_manager()
                session = await session_manager.get_session(session_id)
                
                # Update session activity
                await session_manager.update_session_activity(session_id)
                
                session_info = {
                    "id": session.session_id,
                    "createdAt": session.created_at.isoformat(),
                    "expiresAt": datetime.fromtimestamp(
                        session.expires_at, tz=timezone.utc
                    ).isoformat(),
                    "active": True,
                }
            except (SessionNotFoundError, SessionExpiredError) as e:
                logger.warning(f"Session not found or expired: {e}")
                session_info = {
                    "id": None,
                    "active": False,
                    "error": str(e),
                }
        
        return SessionResponse(
            user=user_info,
            session=session_info,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get session failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get session: {str(e)}"
        )


@router.post("/refresh")
async def refresh_session(
    request: Request,
    session_id: Optional[str] = Cookie(None, alias="session"),
):
    """Refresh the current session.
    
    Extends the session TTL based on idle timeout configuration.
    This endpoint is called periodically by the frontend to keep
    the session alive while the user is active.
    
    Args:
        request: The FastAPI request object
        session_id: Session ID from cookie
        
    Returns:
        Updated session information
    """
    if not session_id:
        raise HTTPException(
            status_code=400,
            detail="No session to refresh"
        )
    
    try:
        session_manager = get_session_manager()
        session = await session_manager.update_session_activity(
            session_id,
            extend_ttl=True
        )
        
        logger.debug(f"Session refreshed: {session_id}")
        
        return {
            "success": True,
            "session": {
                "id": session.session_id,
                "expiresAt": datetime.fromtimestamp(
                    session.expires_at, tz=timezone.utc
                ).isoformat(),
            }
        }
        
    except SessionNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="Session not found"
        )
    except SessionExpiredError:
        raise HTTPException(
            status_code=401,
            detail="Session expired"
        )
    except Exception as e:
        logger.error(f"Session refresh failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to refresh session: {str(e)}"
        )
