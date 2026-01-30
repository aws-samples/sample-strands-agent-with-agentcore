"""
Middleware modules for AgentCore Runtime.

This package contains FastAPI middleware components for:
- Authentication and authorization
- Request/response processing
- Logging and monitoring
"""

from middleware.auth_middleware import AuthMiddleware, UserContext, AuthConfig

__all__ = [
    "AuthMiddleware",
    "UserContext", 
    "AuthConfig",
]
