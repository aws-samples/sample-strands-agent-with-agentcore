"""
Tests for voice.py router

Tests cover:
- /voice/sessions endpoint (list active sessions)
- /voice/sessions/{session_id} endpoint (stop session)

Note: WebSocket tests are excluded as they require complex mocking
of BidiAgent and Nova Sonic connections.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


class TestVoiceSessionsEndpoint:
    """Tests for the /voice/sessions endpoint."""

    @pytest.fixture
    def client(self):
        """Create test client with voice router."""
        from routers.voice import router, _active_sessions

        # Clear any existing sessions
        _active_sessions.clear()

        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def test_list_sessions_empty(self, client):
        """Test listing sessions when none are active."""
        response = client.get("/voice/sessions")

        assert response.status_code == 200
        data = response.json()
        assert data["active_sessions"] == []
        assert data["count"] == 0

    def test_list_sessions_with_active(self, client):
        """Test listing sessions with active sessions."""
        from routers.voice import _active_sessions

        # Simulate active sessions
        _active_sessions["session-1"] = "mock_agent_1"
        _active_sessions["session-2"] = "mock_agent_2"

        response = client.get("/voice/sessions")

        assert response.status_code == 200
        data = response.json()
        assert set(data["active_sessions"]) == {"session-1", "session-2"}
        assert data["count"] == 2

        # Cleanup
        _active_sessions.clear()


class TestStopSessionEndpoint:
    """Tests for the /voice/sessions/{session_id} DELETE endpoint."""

    @pytest.fixture
    def client(self):
        """Create test client with voice router."""
        from routers.voice import router, _active_sessions

        _active_sessions.clear()

        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def test_stop_nonexistent_session(self, client):
        """Test stopping a session that doesn't exist."""
        response = client.delete("/voice/sessions/nonexistent-id")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "not_found"
        assert data["session_id"] == "nonexistent-id"

    def test_stop_existing_session(self, client):
        """Test stopping an existing session."""
        from routers.voice import _active_sessions
        from unittest.mock import MagicMock, AsyncMock

        # Create mock agent with async stop method
        mock_agent = MagicMock()
        mock_agent.stop = AsyncMock()

        _active_sessions["test-session"] = mock_agent

        response = client.delete("/voice/sessions/test-session")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "stopped"
        assert data["session_id"] == "test-session"

        # Verify session was removed
        assert "test-session" not in _active_sessions

        # Verify stop was called
        mock_agent.stop.assert_called_once()
