"""
Unit tests for authentication middleware.

Tests cover:
- User context extraction from headers
- Required header validation
- Health check bypass
- Authentication error handling
- Configuration options
- Correlation ID handling
"""
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.responses import Response
import os


# ============================================================
# UserContext Model Tests
# ============================================================

class TestUserContext:
    """Tests for the UserContext Pydantic model."""

    def test_creates_user_context_with_required_fields(self):
        """Test that UserContext can be created with required fields."""
        from middleware.auth_middleware import UserContext
        
        user = UserContext(
            email="test@example.com",
            sub="user-123",
            name="Test User"
        )
        
        assert user.email == "test@example.com"
        assert user.sub == "user-123"
        assert user.name == "Test User"
        assert user.groups is None

    def test_creates_user_context_with_groups(self):
        """Test that UserContext can include groups."""
        from middleware.auth_middleware import UserContext
        
        user = UserContext(
            email="test@example.com",
            sub="user-123",
            name="Test User",
            groups=["admin", "developers"]
        )
        
        assert user.groups == ["admin", "developers"]

    def test_user_context_is_immutable(self):
        """Test that UserContext is immutable (frozen)."""
        from middleware.auth_middleware import UserContext
        
        user = UserContext(
            email="test@example.com",
            sub="user-123",
            name="Test User"
        )
        
        with pytest.raises(Exception):  # ValidationError for frozen model
            user.email = "changed@example.com"

    def test_user_context_requires_email(self):
        """Test that email is required."""
        from middleware.auth_middleware import UserContext
        from pydantic import ValidationError
        
        with pytest.raises(ValidationError):
            UserContext(sub="user-123", name="Test User")

    def test_user_context_requires_sub(self):
        """Test that sub is required."""
        from middleware.auth_middleware import UserContext
        from pydantic import ValidationError
        
        with pytest.raises(ValidationError):
            UserContext(email="test@example.com", name="Test User")


# ============================================================
# AuthConfig Tests
# ============================================================

class TestAuthConfig:
    """Tests for the AuthConfig configuration class."""

    def test_default_config_values(self):
        """Test that AuthConfig has sensible defaults."""
        from middleware.auth_middleware import AuthConfig
        
        config = AuthConfig()
        
        assert "/health" in config.public_paths
        assert "/api/health" in config.public_paths
        assert "/ping" in config.public_paths
        assert config.require_auth is True
        assert config.log_auth_events is True

    def test_custom_public_paths(self):
        """Test that custom public paths can be configured."""
        from middleware.auth_middleware import AuthConfig
        
        config = AuthConfig(public_paths={"/custom", "/another"})
        
        assert "/custom" in config.public_paths
        assert "/another" in config.public_paths

    def test_from_env_with_defaults(self, monkeypatch):
        """Test that from_env uses defaults when env vars not set."""
        from middleware.auth_middleware import AuthConfig
        
        # Clear any existing env vars
        monkeypatch.delenv("AUTH_PUBLIC_PATHS", raising=False)
        monkeypatch.delenv("AUTH_REQUIRE_AUTH", raising=False)
        monkeypatch.delenv("AUTH_LOG_EVENTS", raising=False)
        
        config = AuthConfig.from_env()
        
        assert "/health" in config.public_paths
        assert config.require_auth is True
        assert config.log_auth_events is True

    def test_from_env_with_custom_paths(self, monkeypatch):
        """Test that from_env reads custom paths from env."""
        from middleware.auth_middleware import AuthConfig
        
        monkeypatch.setenv("AUTH_PUBLIC_PATHS", "/custom1, /custom2")
        
        config = AuthConfig.from_env()
        
        assert "/custom1" in config.public_paths
        assert "/custom2" in config.public_paths
        # Default paths should still be included
        assert "/health" in config.public_paths

    def test_from_env_disable_auth(self, monkeypatch):
        """Test that auth can be disabled via env var."""
        from middleware.auth_middleware import AuthConfig
        
        monkeypatch.setenv("AUTH_REQUIRE_AUTH", "false")
        
        config = AuthConfig.from_env()
        
        assert config.require_auth is False

    def test_from_env_disable_logging(self, monkeypatch):
        """Test that logging can be disabled via env var."""
        from middleware.auth_middleware import AuthConfig
        
        monkeypatch.setenv("AUTH_LOG_EVENTS", "false")
        
        config = AuthConfig.from_env()
        
        assert config.log_auth_events is False

    def test_auto_detect_agentcore_runtime_with_memory_arn(self, monkeypatch):
        """Test that auth is auto-disabled when MEMORY_ARN is set (AgentCore Runtime)."""
        from middleware.auth_middleware import AuthConfig
        
        # Clear any existing auth env var
        monkeypatch.delenv("AUTH_REQUIRE_AUTH", raising=False)
        # Set AgentCore Runtime env var
        monkeypatch.setenv("MEMORY_ARN", "arn:aws:bedrock-agentcore:eu-west-1:123456789:memory/test")
        
        config = AuthConfig.from_env()
        
        assert config.require_auth is False

    def test_auto_detect_agentcore_runtime_with_browser_id(self, monkeypatch):
        """Test that auth is auto-disabled when BROWSER_ID is set (AgentCore Runtime)."""
        from middleware.auth_middleware import AuthConfig
        
        # Clear any existing auth env var
        monkeypatch.delenv("AUTH_REQUIRE_AUTH", raising=False)
        # Set AgentCore Runtime env var
        monkeypatch.setenv("BROWSER_ID", "browser-123")
        
        config = AuthConfig.from_env()
        
        assert config.require_auth is False

    def test_explicit_auth_overrides_auto_detect(self, monkeypatch):
        """Test that explicit AUTH_REQUIRE_AUTH takes precedence over auto-detection."""
        from middleware.auth_middleware import AuthConfig
        
        # Set both AgentCore Runtime env var AND explicit auth requirement
        monkeypatch.setenv("MEMORY_ARN", "arn:aws:bedrock-agentcore:eu-west-1:123456789:memory/test")
        monkeypatch.setenv("AUTH_REQUIRE_AUTH", "true")
        
        config = AuthConfig.from_env()
        
        # Explicit setting should override auto-detection
        assert config.require_auth is True


# ============================================================
# AuthMiddleware Tests
# ============================================================

class TestAuthMiddleware:
    """Tests for the AuthMiddleware class."""

    @pytest.fixture
    def app_with_auth(self):
        """Create a FastAPI app with auth middleware."""
        from middleware.auth_middleware import AuthMiddleware, AuthConfig
        
        app = FastAPI()
        config = AuthConfig(
            public_paths={"/health", "/ping"},
            require_auth=True,
            log_auth_events=False  # Disable logging for cleaner tests
        )
        app.add_middleware(AuthMiddleware, config=config)
        
        @app.get("/health")
        async def health():
            return {"status": "healthy"}
        
        @app.get("/protected")
        async def protected(request: Request):
            user = request.state.user
            return {
                "email": user.email,
                "sub": user.sub,
                "name": user.name
            }
        
        @app.get("/with-groups")
        async def with_groups(request: Request):
            user = request.state.user
            return {"groups": user.groups}
        
        return app

    @pytest.fixture
    def client(self, app_with_auth):
        """Create test client for the app."""
        return TestClient(app_with_auth)

    def test_health_check_bypasses_auth(self, client):
        """Test that health check endpoints don't require auth."""
        response = client.get("/health")
        
        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}

    def test_protected_route_requires_auth(self, client):
        """Test that protected routes return 401 without auth headers."""
        response = client.get("/protected")
        
        assert response.status_code == 401
        assert "error" in response.json()
        assert response.json()["error"]["code"] == "MISSING_AUTH_HEADERS"

    def test_protected_route_with_valid_headers(self, client):
        """Test that protected routes work with valid auth headers."""
        response = client.get(
            "/protected",
            headers={
                "X-User-Email": "test@example.com",
                "X-User-Sub": "user-123",
                "X-User-Name": "Test User"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "test@example.com"
        assert data["sub"] == "user-123"
        assert data["name"] == "Test User"

    def test_missing_email_header_returns_401(self, client):
        """Test that missing email header returns 401."""
        response = client.get(
            "/protected",
            headers={
                "X-User-Sub": "user-123",
                "X-User-Name": "Test User"
            }
        )
        
        assert response.status_code == 401
        assert "X-User-Email" in response.json()["error"]["message"]

    def test_missing_sub_header_returns_401(self, client):
        """Test that missing sub header returns 401."""
        response = client.get(
            "/protected",
            headers={
                "X-User-Email": "test@example.com",
                "X-User-Name": "Test User"
            }
        )
        
        assert response.status_code == 401
        assert "X-User-Sub" in response.json()["error"]["message"]

    def test_name_defaults_to_email(self, client):
        """Test that name defaults to email when not provided."""
        response = client.get(
            "/protected",
            headers={
                "X-User-Email": "test@example.com",
                "X-User-Sub": "user-123"
            }
        )
        
        assert response.status_code == 200
        assert response.json()["name"] == "test@example.com"

    def test_groups_are_parsed(self, client):
        """Test that groups header is parsed correctly."""
        response = client.get(
            "/with-groups",
            headers={
                "X-User-Email": "test@example.com",
                "X-User-Sub": "user-123",
                "X-User-Groups": "admin, developers, testers"
            }
        )
        
        assert response.status_code == 200
        assert response.json()["groups"] == ["admin", "developers", "testers"]

    def test_empty_groups_returns_none(self, client):
        """Test that empty groups header returns None."""
        response = client.get(
            "/with-groups",
            headers={
                "X-User-Email": "test@example.com",
                "X-User-Sub": "user-123"
            }
        )
        
        assert response.status_code == 200
        assert response.json()["groups"] is None

    def test_correlation_id_in_error_response(self, client):
        """Test that correlation ID is included in error responses."""
        response = client.get("/protected")
        
        assert response.status_code == 401
        assert "correlation_id" in response.json()["error"]
        assert "X-Correlation-ID" in response.headers

    def test_custom_correlation_id_is_preserved(self, client):
        """Test that custom correlation ID from request is preserved."""
        custom_id = "my-custom-correlation-id"
        response = client.get(
            "/protected",
            headers={"X-Correlation-ID": custom_id}
        )
        
        assert response.status_code == 401
        assert response.json()["error"]["correlation_id"] == custom_id
        assert response.headers["X-Correlation-ID"] == custom_id


# ============================================================
# Auth Disabled Tests
# ============================================================

class TestAuthDisabled:
    """Tests for when authentication is disabled."""

    @pytest.fixture
    def app_no_auth(self):
        """Create a FastAPI app with auth disabled."""
        from middleware.auth_middleware import AuthMiddleware, AuthConfig
        
        app = FastAPI()
        config = AuthConfig(
            require_auth=False,
            log_auth_events=False
        )
        app.add_middleware(AuthMiddleware, config=config)
        
        @app.get("/protected")
        async def protected(request: Request):
            user = request.state.user
            return {
                "email": user.email,
                "sub": user.sub,
                "name": user.name
            }
        
        return app

    @pytest.fixture
    def client(self, app_no_auth):
        """Create test client for the app."""
        return TestClient(app_no_auth)

    def test_protected_route_works_without_headers(self, client):
        """Test that protected routes work without auth headers when disabled."""
        response = client.get("/protected")
        
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "local-dev@example.com"
        assert data["sub"] == "local-dev-user"
        assert data["name"] == "Local Developer"


# ============================================================
# get_current_user Dependency Tests
# ============================================================

class TestGetCurrentUser:
    """Tests for the get_current_user dependency function."""

    @pytest.fixture
    def app_with_dependency(self):
        """Create a FastAPI app using get_current_user dependency."""
        from fastapi import Depends
        from middleware.auth_middleware import (
            AuthMiddleware, 
            AuthConfig, 
            get_current_user,
            UserContext
        )
        
        app = FastAPI()
        config = AuthConfig(
            require_auth=True,
            log_auth_events=False
        )
        app.add_middleware(AuthMiddleware, config=config)
        
        @app.get("/profile")
        async def get_profile(user: UserContext = Depends(get_current_user)):
            return {"email": user.email, "name": user.name}
        
        return app

    @pytest.fixture
    def client(self, app_with_dependency):
        """Create test client for the app."""
        return TestClient(app_with_dependency)

    def test_dependency_returns_user(self, client):
        """Test that dependency returns authenticated user."""
        response = client.get(
            "/profile",
            headers={
                "X-User-Email": "test@example.com",
                "X-User-Sub": "user-123",
                "X-User-Name": "Test User"
            }
        )
        
        assert response.status_code == 200
        assert response.json()["email"] == "test@example.com"
        assert response.json()["name"] == "Test User"


# ============================================================
# AuthenticationError Tests
# ============================================================

class TestAuthenticationError:
    """Tests for the AuthenticationError exception."""

    def test_error_with_message(self):
        """Test that error stores message."""
        from middleware.auth_middleware import AuthenticationError
        
        error = AuthenticationError(message="Test error")
        
        assert error.message == "Test error"
        assert str(error) == "Test error"

    def test_error_with_custom_code(self):
        """Test that error stores custom error code."""
        from middleware.auth_middleware import AuthenticationError
        
        error = AuthenticationError(
            message="Test error",
            error_code="CUSTOM_ERROR"
        )
        
        assert error.error_code == "CUSTOM_ERROR"

    def test_error_default_code(self):
        """Test that error has default error code."""
        from middleware.auth_middleware import AuthenticationError
        
        error = AuthenticationError(message="Test error")
        
        assert error.error_code == "AUTHENTICATION_FAILED"


# ============================================================
# Public Path Matching Tests
# ============================================================

class TestPublicPathMatching:
    """Tests for public path matching logic."""

    @pytest.fixture
    def app_with_wildcard_paths(self):
        """Create a FastAPI app with wildcard public paths."""
        from middleware.auth_middleware import AuthMiddleware, AuthConfig
        
        app = FastAPI()
        config = AuthConfig(
            public_paths={"/health", "/docs/*", "/api/public/*"},
            require_auth=True,
            log_auth_events=False
        )
        app.add_middleware(AuthMiddleware, config=config)
        
        @app.get("/health")
        async def health():
            return {"status": "healthy"}
        
        @app.get("/docs/swagger")
        async def docs_swagger():
            return {"docs": "swagger"}
        
        @app.get("/api/public/info")
        async def public_info():
            return {"info": "public"}
        
        @app.get("/api/private/data")
        async def private_data(request: Request):
            return {"data": "private"}
        
        return app

    @pytest.fixture
    def client(self, app_with_wildcard_paths):
        """Create test client for the app."""
        return TestClient(app_with_wildcard_paths)

    def test_exact_match_public_path(self, client):
        """Test that exact match public paths work."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_wildcard_public_path(self, client):
        """Test that wildcard public paths work."""
        response = client.get("/docs/swagger")
        assert response.status_code == 200

    def test_nested_wildcard_public_path(self, client):
        """Test that nested wildcard public paths work."""
        response = client.get("/api/public/info")
        assert response.status_code == 200

    def test_non_public_path_requires_auth(self, client):
        """Test that non-public paths still require auth."""
        response = client.get("/api/private/data")
        assert response.status_code == 401


# ============================================================
# Logging Tests
# ============================================================

class TestAuthLogging:
    """Tests for authentication logging."""

    @pytest.fixture
    def app_with_logging(self):
        """Create a FastAPI app with logging enabled."""
        from middleware.auth_middleware import AuthMiddleware, AuthConfig
        
        app = FastAPI()
        config = AuthConfig(
            public_paths={"/health"},
            require_auth=True,
            log_auth_events=True
        )
        app.add_middleware(AuthMiddleware, config=config)
        
        @app.get("/protected")
        async def protected(request: Request):
            return {"status": "ok"}
        
        return app

    @pytest.fixture
    def client(self, app_with_logging):
        """Create test client for the app."""
        return TestClient(app_with_logging)

    def test_successful_auth_is_logged(self, client, caplog):
        """Test that successful authentication is logged."""
        import logging
        
        with caplog.at_level(logging.INFO):
            response = client.get(
                "/protected",
                headers={
                    "X-User-Email": "test@example.com",
                    "X-User-Sub": "user-123"
                }
            )
        
        assert response.status_code == 200
        assert "Authentication successful" in caplog.text
        assert "test@example.com" in caplog.text

    def test_failed_auth_is_logged(self, client, caplog):
        """Test that failed authentication is logged."""
        import logging
        
        with caplog.at_level(logging.WARNING):
            response = client.get("/protected")
        
        assert response.status_code == 401
        assert "Authentication failed" in caplog.text


# ============================================================
# Integration with Main App Tests
# ============================================================

class TestMainAppIntegration:
    """Tests for middleware integration with main app."""

    def test_middleware_can_be_added_to_app(self):
        """Test that middleware can be properly added to a FastAPI app."""
        from middleware.auth_middleware import AuthMiddleware, AuthConfig
        
        app = FastAPI()
        config = AuthConfig(require_auth=True)
        app.add_middleware(AuthMiddleware, config=config)
        
        # Check that middleware is in the app's middleware stack
        middleware_classes = [m.cls.__name__ for m in app.user_middleware]
        assert "AuthMiddleware" in middleware_classes

    def test_middleware_config_from_env_works(self, monkeypatch):
        """Test that middleware can be configured from environment."""
        from middleware.auth_middleware import AuthMiddleware, AuthConfig
        
        monkeypatch.setenv("AUTH_REQUIRE_AUTH", "false")
        monkeypatch.setenv("AUTH_PUBLIC_PATHS", "/custom1,/custom2")
        
        config = AuthConfig.from_env()
        
        app = FastAPI()
        app.add_middleware(AuthMiddleware, config=config)
        
        # Verify config was applied
        assert config.require_auth is False
        assert "/custom1" in config.public_paths
        assert "/custom2" in config.public_paths
