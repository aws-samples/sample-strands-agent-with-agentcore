"""
Unit tests for the authentication router.

Tests the /api/auth/* endpoints including:
- /api/auth/callback
- /api/auth/logout
- /api/auth/session
- /api/auth/refresh
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from fastapi import FastAPI

from routers.auth import router
from auth.session_manager import Session, SessionMetadata, SessionNotFoundError, SessionExpiredError


# Create test app
app = FastAPI()
app.include_router(router)


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def mock_session():
    """Create a mock session."""
    now = datetime.now(timezone.utc)
    return Session(
        session_id="test-session-123",
        user_id="user-sub-456",
        email="test@example.com",
        name="Test User",
        created_at=now,
        last_accessed_at=now,
        expires_at=int((now + timedelta(hours=8)).timestamp()),
        metadata=SessionMetadata(ip_address="127.0.0.1"),
    )


@pytest.fixture
def auth_headers():
    """Create authentication headers."""
    return {
        "X-User-Email": "test@example.com",
        "X-User-Sub": "user-sub-456",
        "X-User-Name": "Test User",
    }


class TestAuthCallback:
    """Tests for /api/auth/callback endpoint."""
    
    @patch("routers.auth.get_session_manager")
    @patch("routers.auth.get_user_manager")
    def test_callback_success(
        self, 
        mock_user_manager_factory, 
        mock_session_manager_factory,
        client,
        mock_session,
        auth_headers,
    ):
        """Test successful auth callback."""
        # Setup mocks
        mock_session_manager = MagicMock()
        mock_session_manager.create_session = AsyncMock(return_value=mock_session)
        mock_session_manager_factory.return_value = mock_session_manager
        
        mock_user_manager = MagicMock()
        mock_user_manager.create_or_update_profile = AsyncMock(return_value=MagicMock(
            user_id="user-sub-456",
            email="test@example.com",
            name="Test User",
        ))
        mock_user_manager_factory.return_value = mock_user_manager
        
        # Make request
        response = client.post(
            "/api/auth/callback",
            params={"code": "auth-code-123", "state": "/dashboard"},
            headers=auth_headers,
        )
        
        # Verify
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["redirect_url"] == "/dashboard"
        assert data["session_id"] == "test-session-123"
    
    @patch("routers.auth.get_session_manager")
    @patch("routers.auth.get_user_manager")
    def test_callback_default_redirect(
        self,
        mock_user_manager_factory,
        mock_session_manager_factory,
        client,
        mock_session,
        auth_headers,
    ):
        """Test callback with no state defaults to root."""
        mock_session_manager = MagicMock()
        mock_session_manager.create_session = AsyncMock(return_value=mock_session)
        mock_session_manager_factory.return_value = mock_session_manager
        
        mock_user_manager = MagicMock()
        mock_user_manager.create_or_update_profile = AsyncMock(return_value=MagicMock())
        mock_user_manager_factory.return_value = mock_user_manager
        
        response = client.post(
            "/api/auth/callback",
            params={"code": "auth-code-123"},
            headers=auth_headers,
        )
        
        assert response.status_code == 200
        assert response.json()["redirect_url"] == "/"
    
    def test_callback_unauthenticated(self, client):
        """Test callback without auth headers."""
        response = client.post(
            "/api/auth/callback",
            params={"code": "auth-code-123"},
        )
        
        assert response.status_code == 401


class TestLogout:
    """Tests for /api/auth/logout endpoint."""
    
    @patch("routers.auth.get_session_manager")
    def test_logout_success(
        self,
        mock_session_manager_factory,
        client,
        auth_headers,
    ):
        """Test successful logout."""
        mock_session_manager = MagicMock()
        mock_session_manager.delete_session = AsyncMock(return_value=True)
        mock_session_manager_factory.return_value = mock_session_manager
        
        response = client.post(
            "/api/auth/logout",
            headers=auth_headers,
            cookies={"session": "test-session-123"},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["message"] == "Logged out successfully"
    
    @patch("routers.auth.get_session_manager")
    def test_logout_no_session(
        self,
        mock_session_manager_factory,
        client,
        auth_headers,
    ):
        """Test logout without session cookie."""
        mock_session_manager = MagicMock()
        mock_session_manager_factory.return_value = mock_session_manager
        
        response = client.post(
            "/api/auth/logout",
            headers=auth_headers,
        )
        
        assert response.status_code == 200
        assert response.json()["success"] is True
    
    def test_logout_unauthenticated(self, client):
        """Test logout without auth headers still succeeds."""
        response = client.post("/api/auth/logout")
        
        # Should still succeed (clears cookie)
        assert response.status_code == 200


class TestGetSession:
    """Tests for /api/auth/session endpoint."""
    
    @patch("routers.auth.get_session_manager")
    def test_get_session_success(
        self,
        mock_session_manager_factory,
        client,
        mock_session,
        auth_headers,
    ):
        """Test successful session retrieval."""
        mock_session_manager = MagicMock()
        mock_session_manager.get_session = AsyncMock(return_value=mock_session)
        mock_session_manager.update_session_activity = AsyncMock(return_value=mock_session)
        mock_session_manager_factory.return_value = mock_session_manager
        
        response = client.get(
            "/api/auth/session",
            headers=auth_headers,
            cookies={"session": "test-session-123"},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["user"]["email"] == "test@example.com"
        assert data["user"]["sub"] == "user-sub-456"
        assert data["session"]["id"] == "test-session-123"
        assert data["session"]["active"] is True
    
    def test_get_session_no_cookie(self, client, auth_headers):
        """Test session retrieval without cookie."""
        response = client.get(
            "/api/auth/session",
            headers=auth_headers,
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["user"]["email"] == "test@example.com"
        assert data["session"]["id"] is None
    
    def test_get_session_unauthenticated(self, client):
        """Test session retrieval without auth."""
        response = client.get("/api/auth/session")
        
        assert response.status_code == 401
    
    @patch("routers.auth.get_session_manager")
    def test_get_session_expired(
        self,
        mock_session_manager_factory,
        client,
        auth_headers,
    ):
        """Test session retrieval with expired session."""
        mock_session_manager = MagicMock()
        mock_session_manager.get_session = AsyncMock(
            side_effect=SessionExpiredError("test-session", datetime.now(timezone.utc))
        )
        mock_session_manager_factory.return_value = mock_session_manager
        
        response = client.get(
            "/api/auth/session",
            headers=auth_headers,
            cookies={"session": "test-session-123"},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["session"]["active"] is False


class TestRefreshSession:
    """Tests for /api/auth/refresh endpoint."""
    
    @patch("routers.auth.get_session_manager")
    def test_refresh_success(
        self,
        mock_session_manager_factory,
        client,
        mock_session,
        auth_headers,
    ):
        """Test successful session refresh."""
        mock_session_manager = MagicMock()
        mock_session_manager.update_session_activity = AsyncMock(return_value=mock_session)
        mock_session_manager_factory.return_value = mock_session_manager
        
        response = client.post(
            "/api/auth/refresh",
            headers=auth_headers,
            cookies={"session": "test-session-123"},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["session"]["id"] == "test-session-123"
    
    def test_refresh_no_session(self, client, auth_headers):
        """Test refresh without session cookie."""
        response = client.post(
            "/api/auth/refresh",
            headers=auth_headers,
        )
        
        assert response.status_code == 400
    
    @patch("routers.auth.get_session_manager")
    def test_refresh_session_not_found(
        self,
        mock_session_manager_factory,
        client,
        auth_headers,
    ):
        """Test refresh with non-existent session."""
        mock_session_manager = MagicMock()
        mock_session_manager.update_session_activity = AsyncMock(
            side_effect=SessionNotFoundError("test-session")
        )
        mock_session_manager_factory.return_value = mock_session_manager
        
        response = client.post(
            "/api/auth/refresh",
            headers=auth_headers,
            cookies={"session": "test-session-123"},
        )
        
        assert response.status_code == 404
    
    @patch("routers.auth.get_session_manager")
    def test_refresh_session_expired(
        self,
        mock_session_manager_factory,
        client,
        auth_headers,
    ):
        """Test refresh with expired session."""
        mock_session_manager = MagicMock()
        mock_session_manager.update_session_activity = AsyncMock(
            side_effect=SessionExpiredError("test-session", datetime.now(timezone.utc))
        )
        mock_session_manager_factory.return_value = mock_session_manager
        
        response = client.post(
            "/api/auth/refresh",
            headers=auth_headers,
            cookies={"session": "test-session-123"},
        )
        
        assert response.status_code == 401
