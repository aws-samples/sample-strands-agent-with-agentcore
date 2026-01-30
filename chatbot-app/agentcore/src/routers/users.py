"""
User Management API Routes for SSO Authentication.

This module provides API endpoints for user profile and preferences:
- /api/users/me - Get current user profile
- /api/users/me/preferences - Get/Update user preferences

These endpoints work with the user management module and require
authentication via Lambda@Edge or the auth middleware.
"""

import logging
from typing import Optional, Any, Dict

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field

from auth.user_manager import (
    UserManager,
    UserConfig,
    UserPreferences,
    UserNotFoundError,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/users", tags=["users"])


# ============================================================
# Request/Response Models
# ============================================================

class UserProfileResponse(BaseModel):
    """User profile response."""
    user_id: str = Field(..., alias="userId", description="User's unique identifier")
    email: str = Field(..., description="User's email address")
    name: str = Field(..., description="User's display name")
    preferences: dict = Field(..., description="User preferences")
    created_at: str = Field(..., alias="createdAt", description="Profile creation timestamp")
    last_login_at: str = Field(..., alias="lastLoginAt", description="Last login timestamp")
    login_count: int = Field(..., alias="loginCount", description="Number of logins")
    
    class Config:
        populate_by_name = True


class PreferencesUpdateRequest(BaseModel):
    """Request to update user preferences."""
    theme: Optional[str] = Field(None, description="UI theme (light/dark/system)")
    language: Optional[str] = Field(None, description="Preferred language code")
    notifications: Optional[bool] = Field(None, description="Enable notifications")
    timezone: Optional[str] = Field(None, description="Preferred timezone")
    compact_mode: Optional[bool] = Field(None, alias="compactMode", description="Use compact UI")
    
    class Config:
        populate_by_name = True


class PreferencesResponse(BaseModel):
    """User preferences response."""
    success: bool = Field(..., description="Whether update was successful")
    preferences: dict = Field(..., description="Current preferences")


class ProfileUpdateRequest(BaseModel):
    """Request to update user profile."""
    name: Optional[str] = Field(None, description="Display name")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")


class SinglePreferenceUpdate(BaseModel):
    """Request to update a single preference value."""
    value: Any = Field(..., description="The new preference value")


# ============================================================
# Dependency Injection
# ============================================================

def get_user_manager() -> UserManager:
    """Get user manager instance."""
    config = UserConfig.from_env()
    return UserManager(config=config)


def get_user_from_request(request: Request) -> dict:
    """Extract user information from request headers or state.
    
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

@router.get("/me", response_model=UserProfileResponse)
async def get_current_user(request: Request):
    """Get current user profile.
    
    Returns the profile for the authenticated user, including
    preferences and login statistics.
    
    Args:
        request: The FastAPI request object
        
    Returns:
        UserProfileResponse with user profile data
    """
    try:
        user = get_user_from_request(request)
        user_manager = get_user_manager()
        
        # Get or create profile
        try:
            profile = await user_manager.get_profile(user['sub'])
        except UserNotFoundError:
            # Create profile if it doesn't exist
            profile = await user_manager.create_or_update_profile(
                user_id=user['sub'],
                email=user['email'],
                name=user['name'],
            )
        
        logger.debug(f"User profile retrieved: {user['email']}")
        
        return UserProfileResponse(
            userId=profile.user_id,
            email=profile.email,
            name=profile.name,
            preferences=profile.preferences.model_dump(),
            createdAt=profile.created_at.isoformat(),
            lastLoginAt=profile.last_login_at.isoformat(),
            loginCount=profile.login_count,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get user profile failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get user profile: {str(e)}"
        )


@router.put("/me", response_model=UserProfileResponse)
async def update_current_user(
    request: Request,
    update: ProfileUpdateRequest,
):
    """Update current user profile.
    
    Updates the profile for the authenticated user.
    Only provided fields will be updated.
    
    Args:
        request: The FastAPI request object
        update: Profile update request
        
    Returns:
        UserProfileResponse with updated profile data
    """
    try:
        user = get_user_from_request(request)
        user_manager = get_user_manager()
        
        profile = await user_manager.update_profile(
            user_id=user['sub'],
            name=update.name,
            metadata=update.metadata,
        )
        
        logger.info(f"User profile updated: {user['email']}")
        
        return UserProfileResponse(
            userId=profile.user_id,
            email=profile.email,
            name=profile.name,
            preferences=profile.preferences.model_dump(),
            createdAt=profile.created_at.isoformat(),
            lastLoginAt=profile.last_login_at.isoformat(),
            loginCount=profile.login_count,
        )
        
    except UserNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="User profile not found"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update user profile failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update user profile: {str(e)}"
        )


@router.get("/me/preferences")
async def get_preferences(request: Request):
    """Get current user preferences.
    
    Returns the preferences for the authenticated user.
    
    Args:
        request: The FastAPI request object
        
    Returns:
        User preferences dictionary
    """
    try:
        user = get_user_from_request(request)
        user_manager = get_user_manager()
        
        try:
            preferences = await user_manager.get_preferences(user['sub'])
        except UserNotFoundError:
            # Return default preferences if user doesn't exist
            preferences = UserPreferences()
        
        logger.debug(f"User preferences retrieved: {user['email']}")
        
        return {
            "preferences": preferences.model_dump()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get preferences failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get preferences: {str(e)}"
        )


@router.put("/me/preferences", response_model=PreferencesResponse)
async def update_preferences(
    request: Request,
    update: PreferencesUpdateRequest,
):
    """Update current user preferences.
    
    Updates preferences for the authenticated user.
    Only provided fields will be updated.
    
    Args:
        request: The FastAPI request object
        update: Preferences update request
        
    Returns:
        PreferencesResponse with updated preferences
    """
    try:
        user = get_user_from_request(request)
        user_manager = get_user_manager()
        
        # Get current preferences
        try:
            current = await user_manager.get_preferences(user['sub'])
        except UserNotFoundError:
            # Create profile first if it doesn't exist
            await user_manager.create_or_update_profile(
                user_id=user['sub'],
                email=user['email'],
                name=user['name'],
            )
            current = UserPreferences()
        
        # Merge updates with current preferences
        update_dict = update.model_dump(exclude_none=True)
        current_dict = current.model_dump()
        current_dict.update(update_dict)
        
        # Update preferences
        new_preferences = UserPreferences(**current_dict)
        updated = await user_manager.update_preferences(
            user_id=user['sub'],
            preferences=new_preferences,
        )
        
        logger.info(f"User preferences updated: {user['email']}")
        
        return PreferencesResponse(
            success=True,
            preferences=updated.model_dump(),
        )
        
    except UserNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="User profile not found"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update preferences failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update preferences: {str(e)}"
        )


@router.patch("/me/preferences/{key}")
async def update_single_preference(
    request: Request,
    key: str,
    update: SinglePreferenceUpdate,
):
    """Update a single preference value.
    
    Updates a single preference key for the authenticated user.
    
    Args:
        request: The FastAPI request object
        key: The preference key to update
        update: The update request with the new value
        
    Returns:
        Updated preferences
    """
    # Validate key
    valid_keys = {'theme', 'language', 'notifications', 'timezone', 'compact_mode'}
    if key not in valid_keys:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid preference key: {key}. Valid keys: {valid_keys}"
        )
    
    try:
        user = get_user_from_request(request)
        user_manager = get_user_manager()
        
        updated = await user_manager.update_single_preference(
            user_id=user['sub'],
            key=key,
            value=update.value,
        )
        
        logger.info(f"User preference updated: {user['email']}, key={key}")
        
        return {
            "success": True,
            "preferences": updated.model_dump(),
        }
        
    except UserNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="User profile not found"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update single preference failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update preference: {str(e)}"
        )
