"""
Authentication Middleware for SSO Integration.

This middleware extracts user identity from HTTP headers injected by Lambda@Edge
after JWT validation at the CloudFront edge. It validates required headers,
attaches user context to the request state, and handles authentication errors.

Headers expected from Lambda@Edge:
- X-User-Email: User's email address (required)
- X-User-Sub: User's unique identifier from Cognito (required)
- X-User-Name: User's display name (optional, defaults to email)
- X-User-Groups: User's group memberships (optional)

Usage:
    from middleware.auth_middleware import AuthMiddleware, AuthConfig
    
    config = AuthConfig(
        public_paths=["/health", "/api/health", "/ping"],
        require_auth=True
    )
    app.add_middleware(AuthMiddleware, config=config)
"""

import os
import uuid
import logging
from typing import Optional, List, Set
from dataclasses import dataclass, field

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response
from pydantic import BaseModel, EmailStr, Field


logger = logging.getLogger(__name__)


class UserContext(BaseModel):
    """User context extracted from authentication headers.
    
    This model represents the authenticated user's identity information
    that is attached to each request after successful authentication.
    
    Attributes:
        email: User's email address (required)
        sub: User's unique identifier from Cognito (required)
        name: User's display name (defaults to email if not provided)
        groups: List of group memberships (optional)
    """
    email: str = Field(..., description="User's email address")
    sub: str = Field(..., description="User's unique identifier (Cognito sub)")
    name: str = Field(..., description="User's display name")
    groups: Optional[List[str]] = Field(default=None, description="User's group memberships")
    
    class Config:
        frozen = True  # Make immutable for security


@dataclass
class AuthConfig:
    """Configuration options for authentication middleware.
    
    Attributes:
        public_paths: Set of paths that don't require authentication
        require_auth: Whether to enforce authentication (can be disabled for local dev)
        log_auth_events: Whether to log authentication events
        correlation_id_header: Header name for correlation ID
    """
    public_paths: Set[str] = field(default_factory=lambda: {
        "/health",
        "/api/health", 
        "/ping",
        "/docs",
        "/openapi.json",
        "/redoc",
    })
    require_auth: bool = True
    log_auth_events: bool = True
    correlation_id_header: str = "X-Correlation-ID"
    
    @classmethod
    def from_env(cls) -> "AuthConfig":
        """Create configuration from environment variables.
        
        Environment variables:
            AUTH_PUBLIC_PATHS: Comma-separated list of public paths
            AUTH_REQUIRE_AUTH: Whether to require authentication (true/false)
            AUTH_LOG_EVENTS: Whether to log auth events (true/false)
        
        Auto-detection:
            When running in AgentCore Runtime (detected by MEMORY_ARN env var),
            authentication is automatically disabled because AWS IAM handles
            authentication at the SDK level (InvokeAgentRuntimeCommand).
        """
        public_paths_str = os.getenv("AUTH_PUBLIC_PATHS", "")
        additional_paths = {p.strip() for p in public_paths_str.split(",") if p.strip()}
        
        default_paths = {
            "/health",
            "/api/health",
            "/ping",
            "/docs",
            "/openapi.json",
            "/redoc",
        }
        
        # Auto-detect AgentCore Runtime environment
        # When running in AgentCore Runtime, these env vars are set by the Runtime
        is_agentcore_runtime = bool(os.getenv("MEMORY_ARN") or os.getenv("BROWSER_ID"))
        
        # Determine if auth should be required
        # 1. Explicit AUTH_REQUIRE_AUTH takes precedence
        # 2. If not set, disable auth in AgentCore Runtime (IAM handles auth)
        # 3. Default to requiring auth in other environments
        auth_require_env = os.getenv("AUTH_REQUIRE_AUTH")
        if auth_require_env is not None:
            require_auth = auth_require_env.lower() == "true"
        elif is_agentcore_runtime:
            require_auth = False
            logger.info("AgentCore Runtime detected - disabling auth middleware (IAM handles auth)")
        else:
            require_auth = True
        
        return cls(
            public_paths=default_paths | additional_paths,
            require_auth=require_auth,
            log_auth_events=os.getenv("AUTH_LOG_EVENTS", "true").lower() == "true",
        )


class AuthMiddleware(BaseHTTPMiddleware):
    """FastAPI middleware for SSO authentication.
    
    This middleware:
    1. Extracts user identity from headers injected by Lambda@Edge
    2. Validates that required headers are present
    3. Attaches user context to request.state.user
    4. Bypasses authentication for configured public paths
    5. Logs authentication events for monitoring
    6. Returns 401 for missing/invalid authentication
    
    Example:
        app = FastAPI()
        config = AuthConfig(public_paths={"/health", "/ping"})
        app.add_middleware(AuthMiddleware, config=config)
        
        @app.get("/protected")
        async def protected_route(request: Request):
            user = request.state.user
            return {"message": f"Hello {user.name}"}
    """
    
    # Header names for user identity
    HEADER_USER_EMAIL = "X-User-Email"
    HEADER_USER_SUB = "X-User-Sub"
    HEADER_USER_NAME = "X-User-Name"
    HEADER_USER_GROUPS = "X-User-Groups"
    
    def __init__(self, app, config: Optional[AuthConfig] = None):
        """Initialize the authentication middleware.
        
        Args:
            app: The FastAPI application
            config: Authentication configuration (uses defaults if not provided)
        """
        super().__init__(app)
        self.config = config or AuthConfig.from_env()
        logger.info(
            f"AuthMiddleware initialized: require_auth={self.config.require_auth}, "
            f"public_paths={self.config.public_paths}"
        )
    
    async def dispatch(
        self, 
        request: Request, 
        call_next: RequestResponseEndpoint
    ) -> Response:
        """Process the request through authentication middleware.
        
        Args:
            request: The incoming HTTP request
            call_next: The next middleware/route handler
            
        Returns:
            The response from the route handler or an error response
        """
        # Generate or extract correlation ID for request tracing
        correlation_id = self._get_or_create_correlation_id(request)
        request.state.correlation_id = correlation_id
        
        # Check if path is public (no auth required)
        if self._is_public_path(request.url.path):
            if self.config.log_auth_events:
                logger.debug(
                    f"Public path accessed: {request.url.path}",
                    extra={"correlation_id": correlation_id}
                )
            return await call_next(request)
        
        # Skip authentication if disabled (local development)
        if not self.config.require_auth:
            if self.config.log_auth_events:
                logger.debug(
                    f"Auth disabled, allowing request: {request.url.path}",
                    extra={"correlation_id": correlation_id}
                )
            # Set a default user context for local development
            request.state.user = UserContext(
                email="local-dev@example.com",
                sub="local-dev-user",
                name="Local Developer",
                groups=None
            )
            return await call_next(request)
        
        # Extract and validate user identity from headers
        try:
            user_context = self._extract_user_context(request)
            request.state.user = user_context
            
            if self.config.log_auth_events:
                logger.info(
                    f"Authentication successful: user={user_context.email}, "
                    f"path={request.url.path}, method={request.method}",
                    extra={
                        "correlation_id": correlation_id,
                        "user_email": user_context.email,
                        "user_sub": user_context.sub,
                        "path": request.url.path,
                        "method": request.method,
                    }
                )
            
            response = await call_next(request)
            return response
            
        except AuthenticationError as e:
            if self.config.log_auth_events:
                logger.warning(
                    f"Authentication failed: {e.message}, path={request.url.path}",
                    extra={
                        "correlation_id": correlation_id,
                        "error_code": e.error_code,
                        "path": request.url.path,
                        "method": request.method,
                    }
                )
            return self._create_error_response(e, correlation_id)
    
    def _is_public_path(self, path: str) -> bool:
        """Check if the request path is a public path that doesn't require auth.
        
        Args:
            path: The request URL path
            
        Returns:
            True if the path is public, False otherwise
        """
        # Exact match
        if path in self.config.public_paths:
            return True
        
        # Check for path prefix matches (e.g., /docs/*)
        for public_path in self.config.public_paths:
            if public_path.endswith("*") and path.startswith(public_path[:-1]):
                return True
        
        return False
    
    def _extract_user_context(self, request: Request) -> UserContext:
        """Extract user context from request headers.
        
        Args:
            request: The incoming HTTP request
            
        Returns:
            UserContext with user identity information
            
        Raises:
            AuthenticationError: If required headers are missing
        """
        # Extract headers (case-insensitive)
        user_email = request.headers.get(self.HEADER_USER_EMAIL)
        user_sub = request.headers.get(self.HEADER_USER_SUB)
        user_name = request.headers.get(self.HEADER_USER_NAME)
        user_groups_str = request.headers.get(self.HEADER_USER_GROUPS)
        
        # Validate required headers
        missing_headers = []
        if not user_email:
            missing_headers.append(self.HEADER_USER_EMAIL)
        if not user_sub:
            missing_headers.append(self.HEADER_USER_SUB)
        
        if missing_headers:
            raise AuthenticationError(
                message=f"Missing required authentication headers: {', '.join(missing_headers)}",
                error_code="MISSING_AUTH_HEADERS"
            )
        
        # Parse groups if provided
        groups = None
        if user_groups_str:
            groups = [g.strip() for g in user_groups_str.split(",") if g.strip()]
        
        return UserContext(
            email=user_email,
            sub=user_sub,
            name=user_name or user_email,  # Default to email if name not provided
            groups=groups
        )
    
    def _get_or_create_correlation_id(self, request: Request) -> str:
        """Get correlation ID from request or create a new one.
        
        Args:
            request: The incoming HTTP request
            
        Returns:
            Correlation ID string
        """
        correlation_id = request.headers.get(self.config.correlation_id_header)
        if not correlation_id:
            correlation_id = str(uuid.uuid4())
        return correlation_id
    
    def _create_error_response(
        self, 
        error: "AuthenticationError", 
        correlation_id: str
    ) -> JSONResponse:
        """Create a JSON error response for authentication failures.
        
        Args:
            error: The authentication error
            correlation_id: Request correlation ID
            
        Returns:
            JSONResponse with error details
        """
        return JSONResponse(
            status_code=401,
            content={
                "error": {
                    "code": error.error_code,
                    "message": error.message,
                    "correlation_id": correlation_id,
                }
            },
            headers={
                "WWW-Authenticate": "Bearer",
                self.config.correlation_id_header: correlation_id,
            }
        )


class AuthenticationError(Exception):
    """Exception raised for authentication failures.
    
    Attributes:
        message: Human-readable error message
        error_code: Machine-readable error code
    """
    
    def __init__(self, message: str, error_code: str = "AUTHENTICATION_FAILED"):
        self.message = message
        self.error_code = error_code
        super().__init__(self.message)


def get_current_user(request: Request) -> UserContext:
    """Dependency function to get the current authenticated user.
    
    This can be used as a FastAPI dependency to access the authenticated
    user in route handlers.
    
    Args:
        request: The incoming HTTP request
        
    Returns:
        UserContext for the authenticated user
        
    Raises:
        HTTPException: If user is not authenticated
        
    Example:
        from fastapi import Depends
        from middleware.auth_middleware import get_current_user, UserContext
        
        @app.get("/profile")
        async def get_profile(user: UserContext = Depends(get_current_user)):
            return {"email": user.email, "name": user.name}
    """
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user
