"""
Unit tests for session management module.

Tests cover:
- Session creation
- Session retrieval
- Session update and activity tracking
- Session deletion
- Session expiration handling
- TTL management
- DynamoDB integration (mocked)
"""
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from datetime import datetime, timezone, timedelta
from botocore.exceptions import ClientError
import uuid


# ============================================================
# Session Model Tests
# ============================================================

class TestSession:
    """Tests for the Session Pydantic model."""

    def test_creates_session_with_required_fields(self):
        """Test that Session can be created with required fields."""
        from auth.session_manager import Session
        
        now = datetime.now(timezone.utc)
        expires_at = int((now + timedelta(hours=8)).timestamp())
        
        session = Session(
            session_id="session-123",
            user_id="user-456",
            email="test@example.com",
            name="Test User",
            created_at=now,
            last_accessed_at=now,
            expires_at=expires_at
        )
        
        assert session.session_id == "session-123"
        assert session.user_id == "user-456"
        assert session.email == "test@example.com"
        assert session.name == "Test User"
        assert session.metadata is None

    def test_creates_session_with_metadata(self):
        """Test that Session can include metadata."""
        from auth.session_manager import Session, SessionMetadata
        
        now = datetime.now(timezone.utc)
        expires_at = int((now + timedelta(hours=8)).timestamp())
        metadata = SessionMetadata(
            ip_address="192.168.1.1",
            user_agent="Mozilla/5.0"
        )
        
        session = Session(
            session_id="session-123",
            user_id="user-456",
            email="test@example.com",
            name="Test User",
            created_at=now,
            last_accessed_at=now,
            expires_at=expires_at,
            metadata=metadata
        )
        
        assert session.metadata.ip_address == "192.168.1.1"
        assert session.metadata.user_agent == "Mozilla/5.0"

    def test_session_is_expired_returns_true_for_expired(self):
        """Test that is_expired returns True for expired sessions."""
        from auth.session_manager import Session
        
        now = datetime.now(timezone.utc)
        # Set expiry to 1 hour ago
        expires_at = int((now - timedelta(hours=1)).timestamp())
        
        session = Session(
            session_id="session-123",
            user_id="user-456",
            email="test@example.com",
            name="Test User",
            created_at=now - timedelta(hours=9),
            last_accessed_at=now - timedelta(hours=2),
            expires_at=expires_at
        )
        
        assert session.is_expired() is True

    def test_session_is_expired_returns_false_for_valid(self):
        """Test that is_expired returns False for valid sessions."""
        from auth.session_manager import Session
        
        now = datetime.now(timezone.utc)
        # Set expiry to 1 hour from now
        expires_at = int((now + timedelta(hours=1)).timestamp())
        
        session = Session(
            session_id="session-123",
            user_id="user-456",
            email="test@example.com",
            name="Test User",
            created_at=now,
            last_accessed_at=now,
            expires_at=expires_at
        )
        
        assert session.is_expired() is False

    def test_session_time_until_expiry(self):
        """Test that time_until_expiry returns correct timedelta."""
        from auth.session_manager import Session
        
        now = datetime.now(timezone.utc)
        expires_at = int((now + timedelta(hours=2)).timestamp())
        
        session = Session(
            session_id="session-123",
            user_id="user-456",
            email="test@example.com",
            name="Test User",
            created_at=now,
            last_accessed_at=now,
            expires_at=expires_at
        )
        
        time_left = session.time_until_expiry()
        # Should be approximately 2 hours (allow for test execution time)
        assert timedelta(hours=1, minutes=59) < time_left < timedelta(hours=2, minutes=1)

    def test_session_to_dict(self):
        """Test that to_dict returns correct dictionary."""
        from auth.session_manager import Session, SessionMetadata
        
        now = datetime.now(timezone.utc)
        expires_at = int((now + timedelta(hours=8)).timestamp())
        metadata = SessionMetadata(ip_address="192.168.1.1")
        
        session = Session(
            session_id="session-123",
            user_id="user-456",
            email="test@example.com",
            name="Test User",
            created_at=now,
            last_accessed_at=now,
            expires_at=expires_at,
            metadata=metadata
        )
        
        result = session.to_dict()
        
        assert result["sessionId"] == "session-123"
        assert result["userId"] == "user-456"
        assert result["email"] == "test@example.com"
        assert result["name"] == "Test User"
        assert result["expiresAt"] == expires_at
        assert result["metadata"]["ip_address"] == "192.168.1.1"


# ============================================================
# SessionMetadata Tests
# ============================================================

class TestSessionMetadata:
    """Tests for the SessionMetadata model."""

    def test_creates_metadata_with_all_fields(self):
        """Test that SessionMetadata can be created with all fields."""
        from auth.session_manager import SessionMetadata
        
        metadata = SessionMetadata(
            ip_address="192.168.1.1",
            user_agent="Mozilla/5.0",
            device_id="device-123",
            location={"country": "US", "city": "Seattle"}
        )
        
        assert metadata.ip_address == "192.168.1.1"
        assert metadata.user_agent == "Mozilla/5.0"
        assert metadata.device_id == "device-123"
        assert metadata.location["country"] == "US"

    def test_creates_metadata_with_defaults(self):
        """Test that SessionMetadata has sensible defaults."""
        from auth.session_manager import SessionMetadata
        
        metadata = SessionMetadata()
        
        assert metadata.ip_address is None
        assert metadata.user_agent is None
        assert metadata.device_id is None
        assert metadata.location is None

    def test_metadata_allows_extra_fields(self):
        """Test that SessionMetadata allows extra fields."""
        from auth.session_manager import SessionMetadata
        
        metadata = SessionMetadata(
            ip_address="192.168.1.1",
            custom_field="custom_value"
        )
        
        assert metadata.ip_address == "192.168.1.1"
        assert metadata.custom_field == "custom_value"


# ============================================================
# SessionConfig Tests
# ============================================================

class TestSessionConfig:
    """Tests for the SessionConfig configuration class."""

    def test_default_config_values(self):
        """Test that SessionConfig has sensible defaults."""
        from auth.session_manager import SessionConfig
        
        config = SessionConfig()
        
        assert config.table_name == "chatbot-sessions"
        assert config.session_duration_hours == 8
        assert config.idle_timeout_minutes == 60
        assert config.region == "us-east-1"

    def test_custom_config_values(self):
        """Test that SessionConfig accepts custom values."""
        from auth.session_manager import SessionConfig
        
        config = SessionConfig(
            table_name="custom-sessions",
            session_duration_hours=4,
            idle_timeout_minutes=30,
            region="us-west-2"
        )
        
        assert config.table_name == "custom-sessions"
        assert config.session_duration_hours == 4
        assert config.idle_timeout_minutes == 30
        assert config.region == "us-west-2"

    def test_from_env_with_defaults(self, monkeypatch):
        """Test that from_env uses defaults when env vars not set."""
        from auth.session_manager import SessionConfig
        
        # Clear any existing env vars
        monkeypatch.delenv("SESSION_TABLE_NAME", raising=False)
        monkeypatch.delenv("SESSION_DURATION_HOURS", raising=False)
        monkeypatch.delenv("SESSION_IDLE_TIMEOUT_MINUTES", raising=False)
        
        config = SessionConfig.from_env()
        
        assert config.table_name == "chatbot-sessions"
        assert config.session_duration_hours == 8
        assert config.idle_timeout_minutes == 60

    def test_from_env_with_custom_values(self, monkeypatch):
        """Test that from_env reads values from environment."""
        from auth.session_manager import SessionConfig
        
        monkeypatch.setenv("SESSION_TABLE_NAME", "env-sessions")
        monkeypatch.setenv("SESSION_DURATION_HOURS", "12")
        monkeypatch.setenv("SESSION_IDLE_TIMEOUT_MINUTES", "90")
        
        config = SessionConfig.from_env()
        
        assert config.table_name == "env-sessions"
        assert config.session_duration_hours == 12
        assert config.idle_timeout_minutes == 90


# ============================================================
# SessionManager Tests
# ============================================================

class TestSessionManager:
    """Tests for the SessionManager class."""

    @pytest.fixture
    def mock_dynamodb(self):
        """Create a mock DynamoDB table."""
        mock_table = MagicMock()
        return mock_table

    @pytest.fixture
    def session_manager(self, mock_dynamodb):
        """Create a SessionManager with mocked DynamoDB."""
        from auth.session_manager import SessionManager, SessionConfig
        
        config = SessionConfig(
            table_name="test-sessions",
            session_duration_hours=8,
            idle_timeout_minutes=60
        )
        manager = SessionManager(config=config)
        manager._table = mock_dynamodb
        return manager

    @pytest.mark.asyncio
    async def test_create_session_success(self, session_manager, mock_dynamodb):
        """Test successful session creation."""
        mock_dynamodb.put_item.return_value = {}
        
        session = await session_manager.create_session(
            user_id="user-123",
            email="test@example.com",
            name="Test User"
        )
        
        assert session.user_id == "user-123"
        assert session.email == "test@example.com"
        assert session.name == "Test User"
        assert session.session_id is not None
        assert session.is_expired() is False
        
        # Verify DynamoDB was called
        mock_dynamodb.put_item.assert_called_once()
        call_args = mock_dynamodb.put_item.call_args
        item = call_args.kwargs["Item"]
        assert item["userId"] == "user-123"
        assert item["email"] == "test@example.com"

    @pytest.mark.asyncio
    async def test_create_session_with_metadata(self, session_manager, mock_dynamodb):
        """Test session creation with metadata."""
        from auth.session_manager import SessionMetadata
        
        mock_dynamodb.put_item.return_value = {}
        metadata = SessionMetadata(
            ip_address="192.168.1.1",
            user_agent="Mozilla/5.0"
        )
        
        session = await session_manager.create_session(
            user_id="user-123",
            email="test@example.com",
            name="Test User",
            metadata=metadata
        )
        
        assert session.metadata.ip_address == "192.168.1.1"
        assert session.metadata.user_agent == "Mozilla/5.0"

    @pytest.mark.asyncio
    async def test_create_session_dynamodb_error(self, session_manager, mock_dynamodb):
        """Test session creation handles DynamoDB errors."""
        mock_dynamodb.put_item.side_effect = ClientError(
            {"Error": {"Code": "InternalError", "Message": "Test error"}},
            "PutItem"
        )
        
        with pytest.raises(ClientError):
            await session_manager.create_session(
                user_id="user-123",
                email="test@example.com",
                name="Test User"
            )

    @pytest.mark.asyncio
    async def test_get_session_success(self, session_manager, mock_dynamodb):
        """Test successful session retrieval."""
        now = datetime.now(timezone.utc)
        expires_at = int((now + timedelta(hours=8)).timestamp())
        
        mock_dynamodb.get_item.return_value = {
            "Item": {
                "sessionId": "session-123",
                "userId": "user-456",
                "email": "test@example.com",
                "name": "Test User",
                "createdAt": now.isoformat(),
                "lastAccessedAt": now.isoformat(),
                "expiresAt": expires_at
            }
        }
        
        session = await session_manager.get_session("session-123")
        
        assert session.session_id == "session-123"
        assert session.user_id == "user-456"
        assert session.email == "test@example.com"

    @pytest.mark.asyncio
    async def test_get_session_not_found(self, session_manager, mock_dynamodb):
        """Test session retrieval when session doesn't exist."""
        from auth.session_manager import SessionNotFoundError
        
        mock_dynamodb.get_item.return_value = {}
        
        with pytest.raises(SessionNotFoundError) as exc_info:
            await session_manager.get_session("nonexistent-session")
        
        assert exc_info.value.session_id == "nonexistent-session"

    @pytest.mark.asyncio
    async def test_get_session_expired(self, session_manager, mock_dynamodb):
        """Test session retrieval when session is expired."""
        from auth.session_manager import SessionExpiredError
        
        now = datetime.now(timezone.utc)
        # Set expiry to 1 hour ago
        expires_at = int((now - timedelta(hours=1)).timestamp())
        
        mock_dynamodb.get_item.return_value = {
            "Item": {
                "sessionId": "session-123",
                "userId": "user-456",
                "email": "test@example.com",
                "name": "Test User",
                "createdAt": (now - timedelta(hours=9)).isoformat(),
                "lastAccessedAt": (now - timedelta(hours=2)).isoformat(),
                "expiresAt": expires_at
            }
        }
        
        with pytest.raises(SessionExpiredError) as exc_info:
            await session_manager.get_session("session-123")
        
        assert exc_info.value.session_id == "session-123"

    @pytest.mark.asyncio
    async def test_get_session_skip_expiry_validation(self, session_manager, mock_dynamodb):
        """Test session retrieval without expiry validation."""
        now = datetime.now(timezone.utc)
        # Set expiry to 1 hour ago
        expires_at = int((now - timedelta(hours=1)).timestamp())
        
        mock_dynamodb.get_item.return_value = {
            "Item": {
                "sessionId": "session-123",
                "userId": "user-456",
                "email": "test@example.com",
                "name": "Test User",
                "createdAt": (now - timedelta(hours=9)).isoformat(),
                "lastAccessedAt": (now - timedelta(hours=2)).isoformat(),
                "expiresAt": expires_at
            }
        }
        
        # Should not raise even though expired
        session = await session_manager.get_session(
            "session-123", 
            validate_expiry=False
        )
        
        assert session.session_id == "session-123"
        assert session.is_expired() is True

    @pytest.mark.asyncio
    async def test_get_session_with_metadata(self, session_manager, mock_dynamodb):
        """Test session retrieval with metadata."""
        now = datetime.now(timezone.utc)
        expires_at = int((now + timedelta(hours=8)).timestamp())
        
        mock_dynamodb.get_item.return_value = {
            "Item": {
                "sessionId": "session-123",
                "userId": "user-456",
                "email": "test@example.com",
                "name": "Test User",
                "createdAt": now.isoformat(),
                "lastAccessedAt": now.isoformat(),
                "expiresAt": expires_at,
                "metadata": {
                    "ip_address": "192.168.1.1",
                    "user_agent": "Mozilla/5.0"
                }
            }
        }
        
        session = await session_manager.get_session("session-123")
        
        assert session.metadata is not None
        assert session.metadata.ip_address == "192.168.1.1"
        assert session.metadata.user_agent == "Mozilla/5.0"

    @pytest.mark.asyncio
    async def test_update_session_activity(self, session_manager, mock_dynamodb):
        """Test session activity update."""
        now = datetime.now(timezone.utc)
        expires_at = int((now + timedelta(hours=8)).timestamp())
        
        # Mock get_item for initial session retrieval
        mock_dynamodb.get_item.return_value = {
            "Item": {
                "sessionId": "session-123",
                "userId": "user-456",
                "email": "test@example.com",
                "name": "Test User",
                "createdAt": now.isoformat(),
                "lastAccessedAt": now.isoformat(),
                "expiresAt": expires_at
            }
        }
        mock_dynamodb.update_item.return_value = {}
        
        updated_session = await session_manager.update_session_activity("session-123")
        
        assert updated_session.session_id == "session-123"
        mock_dynamodb.update_item.assert_called_once()

    @pytest.mark.asyncio
    async def test_update_session_metadata(self, session_manager, mock_dynamodb):
        """Test session metadata update."""
        from auth.session_manager import SessionMetadata
        
        now = datetime.now(timezone.utc)
        expires_at = int((now + timedelta(hours=8)).timestamp())
        
        mock_dynamodb.get_item.return_value = {
            "Item": {
                "sessionId": "session-123",
                "userId": "user-456",
                "email": "test@example.com",
                "name": "Test User",
                "createdAt": now.isoformat(),
                "lastAccessedAt": now.isoformat(),
                "expiresAt": expires_at
            }
        }
        mock_dynamodb.update_item.return_value = {}
        
        new_metadata = SessionMetadata(
            ip_address="10.0.0.1",
            user_agent="Chrome/100"
        )
        
        updated_session = await session_manager.update_session_metadata(
            "session-123",
            new_metadata
        )
        
        assert updated_session.metadata.ip_address == "10.0.0.1"
        mock_dynamodb.update_item.assert_called_once()

    @pytest.mark.asyncio
    async def test_delete_session_success(self, session_manager, mock_dynamodb):
        """Test successful session deletion."""
        mock_dynamodb.delete_item.return_value = {
            "Attributes": {"sessionId": "session-123"}
        }
        
        result = await session_manager.delete_session("session-123")
        
        assert result is True
        mock_dynamodb.delete_item.assert_called_once_with(
            Key={"sessionId": "session-123"},
            ReturnValues="ALL_OLD"
        )

    @pytest.mark.asyncio
    async def test_delete_session_not_found(self, session_manager, mock_dynamodb):
        """Test session deletion when session doesn't exist."""
        mock_dynamodb.delete_item.return_value = {}
        
        result = await session_manager.delete_session("nonexistent-session")
        
        assert result is False

    @pytest.mark.asyncio
    async def test_get_sessions_by_user(self, session_manager, mock_dynamodb):
        """Test retrieving all sessions for a user."""
        now = datetime.now(timezone.utc)
        expires_at = int((now + timedelta(hours=8)).timestamp())
        
        mock_dynamodb.scan.return_value = {
            "Items": [
                {
                    "sessionId": "session-1",
                    "userId": "user-123",
                    "email": "test@example.com",
                    "name": "Test User",
                    "createdAt": now.isoformat(),
                    "lastAccessedAt": now.isoformat(),
                    "expiresAt": expires_at
                },
                {
                    "sessionId": "session-2",
                    "userId": "user-123",
                    "email": "test@example.com",
                    "name": "Test User",
                    "createdAt": now.isoformat(),
                    "lastAccessedAt": now.isoformat(),
                    "expiresAt": expires_at
                }
            ]
        }
        
        sessions = await session_manager.get_sessions_by_user("user-123")
        
        assert len(sessions) == 2
        assert all(s.user_id == "user-123" for s in sessions)

    @pytest.mark.asyncio
    async def test_delete_user_sessions(self, session_manager, mock_dynamodb):
        """Test deleting all sessions for a user."""
        now = datetime.now(timezone.utc)
        expires_at = int((now + timedelta(hours=8)).timestamp())
        
        mock_dynamodb.scan.return_value = {
            "Items": [
                {
                    "sessionId": "session-1",
                    "userId": "user-123",
                    "email": "test@example.com",
                    "name": "Test User",
                    "createdAt": now.isoformat(),
                    "lastAccessedAt": now.isoformat(),
                    "expiresAt": expires_at
                },
                {
                    "sessionId": "session-2",
                    "userId": "user-123",
                    "email": "test@example.com",
                    "name": "Test User",
                    "createdAt": now.isoformat(),
                    "lastAccessedAt": now.isoformat(),
                    "expiresAt": expires_at
                }
            ]
        }
        mock_dynamodb.delete_item.return_value = {"Attributes": {}}
        
        count = await session_manager.delete_user_sessions("user-123")
        
        assert count == 2
        assert mock_dynamodb.delete_item.call_count == 2


# ============================================================
# Exception Tests
# ============================================================

class TestSessionExceptions:
    """Tests for session-related exceptions."""

    def test_session_not_found_error(self):
        """Test SessionNotFoundError exception."""
        from auth.session_manager import SessionNotFoundError
        
        error = SessionNotFoundError("session-123")
        
        assert error.session_id == "session-123"
        assert "session-123" in str(error)

    def test_session_expired_error(self):
        """Test SessionExpiredError exception."""
        from auth.session_manager import SessionExpiredError
        
        expired_at = datetime.now(timezone.utc)
        error = SessionExpiredError("session-123", expired_at)
        
        assert error.session_id == "session-123"
        assert error.expired_at == expired_at
        assert "session-123" in str(error)
