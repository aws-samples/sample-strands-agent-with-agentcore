"""
Authentication modules for SSO Integration.

This package contains modules for:
- Session management (DynamoDB-backed)
- User profile management (DynamoDB-backed)
- Authentication utilities
"""

from auth.session_manager import (
    SessionManager,
    Session,
    SessionMetadata,
    SessionConfig,
    SessionNotFoundError,
    SessionExpiredError,
)
from auth.user_manager import (
    UserManager,
    UserProfile,
    UserPreferences,
    UserNotFoundError,
)

__all__ = [
    # Session Management
    "SessionManager",
    "Session",
    "SessionMetadata",
    "SessionConfig",
    "SessionNotFoundError",
    "SessionExpiredError",
    # User Management
    "UserManager",
    "UserProfile",
    "UserPreferences",
    "UserNotFoundError",
]
