"""
Unit tests for the users router.

Tests the /api/users/* endpoints including:
- /api/users/me
- /api/users/me/preferences
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from fastapi import FastAPI

from routers.users import router
from auth.user_manager import UserProfile, UserPreferences, UserNotFoundError


# Create test app
app = FastAPI()
app.include_router(router)


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def mock_profile():
    """Create a mock user profile."""
    now = datetime.now(timezone.utc)
    return UserProfile(
        user_id="user-sub-456",
        email="test@example.com",
        name="Test User",
        preferences=UserPreferences(theme="dark", language="en"),
        created_at=now,
        last_login_at=now,
        login_count=5,
        metadata=None,
    )


@pytest.fixture
def auth_headers():
    """Create authentication headers."""
    return {
        "X-User-Email": "test@example.com",
        "X-User-Sub": "user-sub-456",
        "X-User-Name": "Test User",
    }


class TestGetCurrentUser:
    """Tests for GET /api/users/me endpoint."""
    
    @patch("routers.users.get_user_manager")
    def test_get_user_success(
        self,
        mock_user_manager_factory,
        client,
        mock_profile,
        auth_headers,
    ):
        """Test successful user profile retrieval."""
        mock_user_manager = MagicMock()
        mock_user_manager.get_profile = AsyncMock(return_value=mock_profile)
        mock_user_manager_factory.return_value = mock_user_manager
        
        response = client.get("/api/users/me", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert data["userId"] == "user-sub-456"
        assert data["email"] == "test@example.com"
        assert data["name"] == "Test User"
        assert data["preferences"]["theme"] == "dark"
        assert data["loginCount"] == 5
    
    @patch("routers.users.get_user_manager")
    def test_get_user_creates_profile(
        self,
        mock_user_manager_factory,
        client,
        mock_profile,
        auth_headers,
    ):
        """Test profile creation when user doesn't exist."""
        mock_user_manager = MagicMock()
        mock_user_manager.get_profile = AsyncMock(
            side_effect=UserNotFoundError("user-sub-456")
        )
        mock_user_manager.create_or_update_profile = AsyncMock(return_value=mock_profile)
        mock_user_manager_factory.return_value = mock_user_manager
        
        response = client.get("/api/users/me", headers=auth_headers)
        
        assert response.status_code == 200
        mock_user_manager.create_or_update_profile.assert_called_once()
    
    def test_get_user_unauthenticated(self, client):
        """Test user retrieval without auth."""
        response = client.get("/api/users/me")
        
        assert response.status_code == 401


class TestUpdateCurrentUser:
    """Tests for PUT /api/users/me endpoint."""
    
    @patch("routers.users.get_user_manager")
    def test_update_user_success(
        self,
        mock_user_manager_factory,
        client,
        mock_profile,
        auth_headers,
    ):
        """Test successful user profile update."""
        updated_profile = UserProfile(
            user_id=mock_profile.user_id,
            email=mock_profile.email,
            name="Updated Name",
            preferences=mock_profile.preferences,
            created_at=mock_profile.created_at,
            last_login_at=mock_profile.last_login_at,
            login_count=mock_profile.login_count,
            metadata=None,
        )
        
        mock_user_manager = MagicMock()
        mock_user_manager.update_profile = AsyncMock(return_value=updated_profile)
        mock_user_manager_factory.return_value = mock_user_manager
        
        response = client.put(
            "/api/users/me",
            headers=auth_headers,
            json={"name": "Updated Name"},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
    
    @patch("routers.users.get_user_manager")
    def test_update_user_not_found(
        self,
        mock_user_manager_factory,
        client,
        auth_headers,
    ):
        """Test update for non-existent user."""
        mock_user_manager = MagicMock()
        mock_user_manager.update_profile = AsyncMock(
            side_effect=UserNotFoundError("user-sub-456")
        )
        mock_user_manager_factory.return_value = mock_user_manager
        
        response = client.put(
            "/api/users/me",
            headers=auth_headers,
            json={"name": "New Name"},
        )
        
        assert response.status_code == 404


class TestGetPreferences:
    """Tests for GET /api/users/me/preferences endpoint."""
    
    @patch("routers.users.get_user_manager")
    def test_get_preferences_success(
        self,
        mock_user_manager_factory,
        client,
        auth_headers,
    ):
        """Test successful preferences retrieval."""
        mock_preferences = UserPreferences(
            theme="dark",
            language="en",
            notifications=True,
        )
        
        mock_user_manager = MagicMock()
        mock_user_manager.get_preferences = AsyncMock(return_value=mock_preferences)
        mock_user_manager_factory.return_value = mock_user_manager
        
        response = client.get("/api/users/me/preferences", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert data["preferences"]["theme"] == "dark"
        assert data["preferences"]["language"] == "en"
    
    @patch("routers.users.get_user_manager")
    def test_get_preferences_default(
        self,
        mock_user_manager_factory,
        client,
        auth_headers,
    ):
        """Test default preferences for new user."""
        mock_user_manager = MagicMock()
        mock_user_manager.get_preferences = AsyncMock(
            side_effect=UserNotFoundError("user-sub-456")
        )
        mock_user_manager_factory.return_value = mock_user_manager
        
        response = client.get("/api/users/me/preferences", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        # Should return default preferences
        assert data["preferences"]["theme"] == "system"


class TestUpdatePreferences:
    """Tests for PUT /api/users/me/preferences endpoint."""
    
    @patch("routers.users.get_user_manager")
    def test_update_preferences_success(
        self,
        mock_user_manager_factory,
        client,
        auth_headers,
    ):
        """Test successful preferences update."""
        current_prefs = UserPreferences(theme="light", language="en")
        updated_prefs = UserPreferences(theme="dark", language="en")
        
        mock_user_manager = MagicMock()
        mock_user_manager.get_preferences = AsyncMock(return_value=current_prefs)
        mock_user_manager.update_preferences = AsyncMock(return_value=updated_prefs)
        mock_user_manager_factory.return_value = mock_user_manager
        
        response = client.put(
            "/api/users/me/preferences",
            headers=auth_headers,
            json={"theme": "dark"},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["preferences"]["theme"] == "dark"
    
    @patch("routers.users.get_user_manager")
    def test_update_preferences_creates_profile(
        self,
        mock_user_manager_factory,
        client,
        mock_profile,
        auth_headers,
    ):
        """Test preferences update creates profile if needed."""
        updated_prefs = UserPreferences(theme="dark")
        
        mock_user_manager = MagicMock()
        mock_user_manager.get_preferences = AsyncMock(
            side_effect=UserNotFoundError("user-sub-456")
        )
        mock_user_manager.create_or_update_profile = AsyncMock(return_value=mock_profile)
        mock_user_manager.update_preferences = AsyncMock(return_value=updated_prefs)
        mock_user_manager_factory.return_value = mock_user_manager
        
        response = client.put(
            "/api/users/me/preferences",
            headers=auth_headers,
            json={"theme": "dark"},
        )
        
        assert response.status_code == 200
        mock_user_manager.create_or_update_profile.assert_called_once()


class TestUpdateSinglePreference:
    """Tests for PATCH /api/users/me/preferences/{key} endpoint."""
    
    @patch("routers.users.get_user_manager")
    def test_update_single_preference_success(
        self,
        mock_user_manager_factory,
        client,
        auth_headers,
    ):
        """Test successful single preference update."""
        updated_prefs = UserPreferences(theme="dark")
        
        mock_user_manager = MagicMock()
        mock_user_manager.update_single_preference = AsyncMock(return_value=updated_prefs)
        mock_user_manager_factory.return_value = mock_user_manager
        
        response = client.patch(
            "/api/users/me/preferences/theme",
            headers=auth_headers,
            json={"value": "dark"},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
    
    def test_update_invalid_preference_key(self, client, auth_headers):
        """Test update with invalid preference key."""
        response = client.patch(
            "/api/users/me/preferences/invalid_key",
            headers=auth_headers,
            json={"value": "test"},
        )
        
        assert response.status_code == 400
        assert "Invalid preference key" in response.json()["detail"]
    
    @patch("routers.users.get_user_manager")
    def test_update_single_preference_user_not_found(
        self,
        mock_user_manager_factory,
        client,
        auth_headers,
    ):
        """Test single preference update for non-existent user."""
        mock_user_manager = MagicMock()
        mock_user_manager.update_single_preference = AsyncMock(
            side_effect=UserNotFoundError("user-sub-456")
        )
        mock_user_manager_factory.return_value = mock_user_manager
        
        response = client.patch(
            "/api/users/me/preferences/theme",
            headers=auth_headers,
            json={"value": "dark"},
        )
        
        assert response.status_code == 404
