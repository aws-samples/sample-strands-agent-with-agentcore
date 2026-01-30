"""
Unit tests for user management module.

Tests cover:
- User profile creation
- User profile retrieval
- User profile updates
- User preferences management
- DynamoDB integration (mocked)
"""
import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone
from botocore.exceptions import ClientError


# ============================================================
# UserProfile Model Tests
# ============================================================

class TestUserProfile:
    """Tests for the UserProfile Pydantic model."""

    def test_creates_profile_with_required_fields(self):
        """Test that UserProfile can be created with required fields."""
        from auth.user_manager import UserProfile, UserPreferences
        
        now = datetime.now(timezone.utc)
        
        profile = UserProfile(
            user_id="user-123",
            email="test@example.com",
            name="Test User",
            created_at=now,
            last_login_at=now
        )
        
        assert profile.user_id == "user-123"
        assert profile.email == "test@example.com"
        assert profile.name == "Test User"
        assert profile.login_count == 1
        assert profile.metadata is None

    def test_creates_profile_with_preferences(self):
        """Test that UserProfile can include preferences."""
        from auth.user_manager import UserProfile, UserPreferences
        
        now = datetime.now(timezone.utc)
        preferences = UserPreferences(theme="dark", language="es")
        
        profile = UserProfile(
            user_id="user-123",
            email="test@example.com",
            name="Test User",
            preferences=preferences,
            created_at=now,
            last_login_at=now
        )
        
        assert profile.preferences.theme == "dark"
        assert profile.preferences.language == "es"

    def test_profile_to_dict(self):
        """Test that to_dict returns correct dictionary."""
        from auth.user_manager import UserProfile, UserPreferences
        
        now = datetime.now(timezone.utc)
        preferences = UserPreferences(theme="dark")
        
        profile = UserProfile(
            user_id="user-123",
            email="test@example.com",
            name="Test User",
            preferences=preferences,
            created_at=now,
            last_login_at=now,
            login_count=5,
            metadata={"source": "sso"}
        )
        
        result = profile.to_dict()
        
        assert result["userId"] == "user-123"
        assert result["email"] == "test@example.com"
        assert result["name"] == "Test User"
        assert result["preferences"]["theme"] == "dark"
        assert result["loginCount"] == 5
        assert result["metadata"]["source"] == "sso"

    def test_profile_default_preferences(self):
        """Test that profile has default preferences."""
        from auth.user_manager import UserProfile
        
        now = datetime.now(timezone.utc)
        
        profile = UserProfile(
            user_id="user-123",
            email="test@example.com",
            name="Test User",
            created_at=now,
            last_login_at=now
        )
        
        assert profile.preferences.theme == "system"
        assert profile.preferences.language == "en"
        assert profile.preferences.notifications is True


# ============================================================
# UserPreferences Model Tests
# ============================================================

class TestUserPreferences:
    """Tests for the UserPreferences model."""

    def test_creates_preferences_with_defaults(self):
        """Test that UserPreferences has sensible defaults."""
        from auth.user_manager import UserPreferences
        
        prefs = UserPreferences()
        
        assert prefs.theme == "system"
        assert prefs.language == "en"
        assert prefs.notifications is True
        assert prefs.timezone is None
        assert prefs.compact_mode is False

    def test_creates_preferences_with_custom_values(self):
        """Test that UserPreferences accepts custom values."""
        from auth.user_manager import UserPreferences
        
        prefs = UserPreferences(
            theme="dark",
            language="es",
            notifications=False,
            timezone="America/New_York",
            compact_mode=True
        )
        
        assert prefs.theme == "dark"
        assert prefs.language == "es"
        assert prefs.notifications is False
        assert prefs.timezone == "America/New_York"
        assert prefs.compact_mode is True

    def test_preferences_theme_validation(self):
        """Test that theme only accepts valid values."""
        from auth.user_manager import UserPreferences
        from pydantic import ValidationError
        
        # Valid themes
        for theme in ["light", "dark", "system"]:
            prefs = UserPreferences(theme=theme)
            assert prefs.theme == theme
        
        # Invalid theme
        with pytest.raises(ValidationError):
            UserPreferences(theme="invalid")

    def test_preferences_allows_extra_fields(self):
        """Test that UserPreferences allows extra fields."""
        from auth.user_manager import UserPreferences
        
        prefs = UserPreferences(
            theme="dark",
            custom_setting="custom_value"
        )
        
        assert prefs.theme == "dark"
        assert prefs.custom_setting == "custom_value"


# ============================================================
# UserConfig Tests
# ============================================================

class TestUserConfig:
    """Tests for the UserConfig configuration class."""

    def test_default_config_values(self):
        """Test that UserConfig has sensible defaults."""
        from auth.user_manager import UserConfig
        
        config = UserConfig()
        
        assert config.table_name == "chatbot-users"
        assert config.region == "us-east-1"

    def test_custom_config_values(self):
        """Test that UserConfig accepts custom values."""
        from auth.user_manager import UserConfig
        
        config = UserConfig(
            table_name="custom-users",
            region="us-west-2",
            endpoint_url="http://localhost:8000"
        )
        
        assert config.table_name == "custom-users"
        assert config.region == "us-west-2"
        assert config.endpoint_url == "http://localhost:8000"

    def test_from_env_with_defaults(self, monkeypatch):
        """Test that from_env uses defaults when env vars not set."""
        from auth.user_manager import UserConfig
        
        monkeypatch.delenv("USER_TABLE_NAME", raising=False)
        monkeypatch.delenv("AWS_DEFAULT_REGION", raising=False)
        
        config = UserConfig.from_env()
        
        assert config.table_name == "chatbot-users"

    def test_from_env_with_custom_values(self, monkeypatch):
        """Test that from_env reads values from environment."""
        from auth.user_manager import UserConfig
        
        monkeypatch.setenv("USER_TABLE_NAME", "env-users")
        monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-west-1")
        
        config = UserConfig.from_env()
        
        assert config.table_name == "env-users"
        assert config.region == "eu-west-1"


# ============================================================
# UserManager Tests
# ============================================================

class TestUserManager:
    """Tests for the UserManager class."""

    @pytest.fixture
    def mock_dynamodb(self):
        """Create a mock DynamoDB table."""
        mock_table = MagicMock()
        return mock_table

    @pytest.fixture
    def user_manager(self, mock_dynamodb):
        """Create a UserManager with mocked DynamoDB."""
        from auth.user_manager import UserManager, UserConfig
        
        config = UserConfig(table_name="test-users")
        manager = UserManager(config=config)
        manager._table = mock_dynamodb
        return manager

    @pytest.mark.asyncio
    async def test_create_profile_success(self, user_manager, mock_dynamodb):
        """Test successful profile creation."""
        mock_dynamodb.put_item.return_value = {}
        
        profile = await user_manager.create_profile(
            user_id="user-123",
            email="test@example.com",
            name="Test User"
        )
        
        assert profile.user_id == "user-123"
        assert profile.email == "test@example.com"
        assert profile.name == "Test User"
        assert profile.login_count == 1
        
        # Verify DynamoDB was called
        mock_dynamodb.put_item.assert_called_once()
        call_args = mock_dynamodb.put_item.call_args
        item = call_args.kwargs["Item"]
        assert item["userId"] == "user-123"
        assert item["sk"] == "PROFILE"

    @pytest.mark.asyncio
    async def test_create_profile_with_preferences(self, user_manager, mock_dynamodb):
        """Test profile creation with custom preferences."""
        from auth.user_manager import UserPreferences
        
        mock_dynamodb.put_item.return_value = {}
        preferences = UserPreferences(theme="dark", language="es")
        
        profile = await user_manager.create_profile(
            user_id="user-123",
            email="test@example.com",
            name="Test User",
            preferences=preferences
        )
        
        assert profile.preferences.theme == "dark"
        assert profile.preferences.language == "es"

    @pytest.mark.asyncio
    async def test_create_profile_already_exists(self, user_manager, mock_dynamodb):
        """Test profile creation when user already exists."""
        from auth.user_manager import UserAlreadyExistsError
        
        mock_dynamodb.put_item.side_effect = ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException", "Message": ""}},
            "PutItem"
        )
        
        with pytest.raises(UserAlreadyExistsError) as exc_info:
            await user_manager.create_profile(
                user_id="user-123",
                email="test@example.com",
                name="Test User"
            )
        
        assert exc_info.value.user_id == "user-123"

    @pytest.mark.asyncio
    async def test_get_profile_success(self, user_manager, mock_dynamodb):
        """Test successful profile retrieval."""
        now = datetime.now(timezone.utc)
        
        mock_dynamodb.get_item.return_value = {
            "Item": {
                "userId": "user-123",
                "sk": "PROFILE",
                "email": "test@example.com",
                "name": "Test User",
                "preferences": {"theme": "dark", "language": "en"},
                "createdAt": now.isoformat(),
                "lastLoginAt": now.isoformat(),
                "loginCount": 5
            }
        }
        
        profile = await user_manager.get_profile("user-123")
        
        assert profile.user_id == "user-123"
        assert profile.email == "test@example.com"
        assert profile.preferences.theme == "dark"
        assert profile.login_count == 5

    @pytest.mark.asyncio
    async def test_get_profile_not_found(self, user_manager, mock_dynamodb):
        """Test profile retrieval when user doesn't exist."""
        from auth.user_manager import UserNotFoundError
        
        mock_dynamodb.get_item.return_value = {}
        
        with pytest.raises(UserNotFoundError) as exc_info:
            await user_manager.get_profile("nonexistent-user")
        
        assert exc_info.value.user_id == "nonexistent-user"

    @pytest.mark.asyncio
    async def test_profile_exists_true(self, user_manager, mock_dynamodb):
        """Test profile_exists returns True when profile exists."""
        mock_dynamodb.get_item.return_value = {
            "Item": {"userId": "user-123"}
        }
        
        result = await user_manager.profile_exists("user-123")
        
        assert result is True

    @pytest.mark.asyncio
    async def test_profile_exists_false(self, user_manager, mock_dynamodb):
        """Test profile_exists returns False when profile doesn't exist."""
        mock_dynamodb.get_item.return_value = {}
        
        result = await user_manager.profile_exists("nonexistent-user")
        
        assert result is False

    @pytest.mark.asyncio
    async def test_create_or_update_profile_creates_new(self, user_manager, mock_dynamodb):
        """Test create_or_update_profile creates new profile."""
        # First update fails (user doesn't exist)
        mock_dynamodb.update_item.side_effect = ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException", "Message": ""}},
            "UpdateItem"
        )
        # Then create succeeds
        mock_dynamodb.put_item.return_value = {}
        
        profile = await user_manager.create_or_update_profile(
            user_id="user-123",
            email="test@example.com",
            name="Test User"
        )
        
        assert profile.user_id == "user-123"
        assert profile.login_count == 1

    @pytest.mark.asyncio
    async def test_create_or_update_profile_updates_existing(self, user_manager, mock_dynamodb):
        """Test create_or_update_profile updates existing profile."""
        now = datetime.now(timezone.utc)
        
        mock_dynamodb.update_item.return_value = {
            "Attributes": {
                "userId": "user-123",
                "sk": "PROFILE",
                "email": "test@example.com",
                "name": "Test User",
                "preferences": {"theme": "system", "language": "en"},
                "createdAt": now.isoformat(),
                "lastLoginAt": now.isoformat(),
                "loginCount": 6
            }
        }
        
        profile = await user_manager.create_or_update_profile(
            user_id="user-123",
            email="test@example.com",
            name="Test User"
        )
        
        assert profile.user_id == "user-123"
        assert profile.login_count == 6

    @pytest.mark.asyncio
    async def test_update_profile_name(self, user_manager, mock_dynamodb):
        """Test updating profile name."""
        now = datetime.now(timezone.utc)
        
        mock_dynamodb.update_item.return_value = {
            "Attributes": {
                "userId": "user-123",
                "sk": "PROFILE",
                "email": "test@example.com",
                "name": "New Name",
                "preferences": {"theme": "system"},
                "createdAt": now.isoformat(),
                "lastLoginAt": now.isoformat(),
                "loginCount": 1
            }
        }
        
        profile = await user_manager.update_profile(
            user_id="user-123",
            name="New Name"
        )
        
        assert profile.name == "New Name"

    @pytest.mark.asyncio
    async def test_update_profile_not_found(self, user_manager, mock_dynamodb):
        """Test updating profile when user doesn't exist."""
        from auth.user_manager import UserNotFoundError
        
        mock_dynamodb.update_item.side_effect = ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException", "Message": ""}},
            "UpdateItem"
        )
        
        with pytest.raises(UserNotFoundError):
            await user_manager.update_profile(
                user_id="nonexistent-user",
                name="New Name"
            )

    @pytest.mark.asyncio
    async def test_get_preferences(self, user_manager, mock_dynamodb):
        """Test getting user preferences."""
        now = datetime.now(timezone.utc)
        
        mock_dynamodb.get_item.return_value = {
            "Item": {
                "userId": "user-123",
                "sk": "PROFILE",
                "email": "test@example.com",
                "name": "Test User",
                "preferences": {"theme": "dark", "language": "es"},
                "createdAt": now.isoformat(),
                "lastLoginAt": now.isoformat()
            }
        }
        
        prefs = await user_manager.get_preferences("user-123")
        
        assert prefs.theme == "dark"
        assert prefs.language == "es"

    @pytest.mark.asyncio
    async def test_update_preferences(self, user_manager, mock_dynamodb):
        """Test updating user preferences."""
        from auth.user_manager import UserPreferences
        
        mock_dynamodb.update_item.return_value = {
            "Attributes": {
                "preferences": {"theme": "light", "language": "fr"}
            }
        }
        
        new_prefs = UserPreferences(theme="light", language="fr")
        prefs = await user_manager.update_preferences("user-123", new_prefs)
        
        assert prefs.theme == "light"
        assert prefs.language == "fr"

    @pytest.mark.asyncio
    async def test_update_preferences_not_found(self, user_manager, mock_dynamodb):
        """Test updating preferences when user doesn't exist."""
        from auth.user_manager import UserPreferences, UserNotFoundError
        
        mock_dynamodb.update_item.side_effect = ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException", "Message": ""}},
            "UpdateItem"
        )
        
        with pytest.raises(UserNotFoundError):
            await user_manager.update_preferences(
                "nonexistent-user",
                UserPreferences(theme="dark")
            )

    @pytest.mark.asyncio
    async def test_update_single_preference(self, user_manager, mock_dynamodb):
        """Test updating a single preference value."""
        mock_dynamodb.update_item.return_value = {
            "Attributes": {
                "preferences": {"theme": "dark", "language": "en"}
            }
        }
        
        prefs = await user_manager.update_single_preference(
            "user-123",
            "theme",
            "dark"
        )
        
        assert prefs.theme == "dark"

    @pytest.mark.asyncio
    async def test_delete_profile_success(self, user_manager, mock_dynamodb):
        """Test successful profile deletion."""
        mock_dynamodb.delete_item.return_value = {
            "Attributes": {"userId": "user-123"}
        }
        
        result = await user_manager.delete_profile("user-123")
        
        assert result is True
        mock_dynamodb.delete_item.assert_called_once_with(
            Key={"userId": "user-123", "sk": "PROFILE"},
            ReturnValues="ALL_OLD"
        )

    @pytest.mark.asyncio
    async def test_delete_profile_not_found(self, user_manager, mock_dynamodb):
        """Test profile deletion when profile doesn't exist."""
        mock_dynamodb.delete_item.return_value = {}
        
        result = await user_manager.delete_profile("nonexistent-user")
        
        assert result is False

    @pytest.mark.asyncio
    async def test_get_user_by_email_found(self, user_manager, mock_dynamodb):
        """Test finding user by email."""
        now = datetime.now(timezone.utc)
        
        mock_dynamodb.scan.return_value = {
            "Items": [
                {
                    "userId": "user-123",
                    "sk": "PROFILE",
                    "email": "test@example.com",
                    "name": "Test User",
                    "preferences": {"theme": "system"},
                    "createdAt": now.isoformat(),
                    "lastLoginAt": now.isoformat()
                }
            ]
        }
        
        profile = await user_manager.get_user_by_email("test@example.com")
        
        assert profile is not None
        assert profile.user_id == "user-123"
        assert profile.email == "test@example.com"

    @pytest.mark.asyncio
    async def test_get_user_by_email_not_found(self, user_manager, mock_dynamodb):
        """Test finding user by email when not found."""
        mock_dynamodb.scan.return_value = {"Items": []}
        
        profile = await user_manager.get_user_by_email("nonexistent@example.com")
        
        assert profile is None


# ============================================================
# Exception Tests
# ============================================================

class TestUserExceptions:
    """Tests for user-related exceptions."""

    def test_user_not_found_error(self):
        """Test UserNotFoundError exception."""
        from auth.user_manager import UserNotFoundError
        
        error = UserNotFoundError("user-123")
        
        assert error.user_id == "user-123"
        assert "user-123" in str(error)

    def test_user_already_exists_error(self):
        """Test UserAlreadyExistsError exception."""
        from auth.user_manager import UserAlreadyExistsError
        
        error = UserAlreadyExistsError("user-123")
        
        assert error.user_id == "user-123"
        assert "user-123" in str(error)


# ============================================================
# Integration Tests (with mocked DynamoDB)
# ============================================================

class TestUserManagerIntegration:
    """Integration tests for UserManager with mocked DynamoDB."""

    @pytest.fixture
    def mock_dynamodb(self):
        """Create a mock DynamoDB table."""
        mock_table = MagicMock()
        return mock_table

    @pytest.fixture
    def user_manager(self, mock_dynamodb):
        """Create a UserManager with mocked DynamoDB."""
        from auth.user_manager import UserManager, UserConfig
        
        config = UserConfig(table_name="test-users")
        manager = UserManager(config=config)
        manager._table = mock_dynamodb
        return manager

    @pytest.mark.asyncio
    async def test_full_user_lifecycle(self, user_manager, mock_dynamodb):
        """Test complete user lifecycle: create, update, delete."""
        from auth.user_manager import UserPreferences
        
        now = datetime.now(timezone.utc)
        
        # 1. Create profile
        mock_dynamodb.put_item.return_value = {}
        profile = await user_manager.create_profile(
            user_id="user-123",
            email="test@example.com",
            name="Test User"
        )
        assert profile.user_id == "user-123"
        
        # 2. Get profile
        mock_dynamodb.get_item.return_value = {
            "Item": {
                "userId": "user-123",
                "sk": "PROFILE",
                "email": "test@example.com",
                "name": "Test User",
                "preferences": {"theme": "system"},
                "createdAt": now.isoformat(),
                "lastLoginAt": now.isoformat(),
                "loginCount": 1
            }
        }
        profile = await user_manager.get_profile("user-123")
        assert profile.email == "test@example.com"
        
        # 3. Update preferences
        mock_dynamodb.update_item.return_value = {
            "Attributes": {
                "preferences": {"theme": "dark", "language": "en"}
            }
        }
        prefs = await user_manager.update_preferences(
            "user-123",
            UserPreferences(theme="dark")
        )
        assert prefs.theme == "dark"
        
        # 4. Delete profile
        mock_dynamodb.delete_item.return_value = {"Attributes": {}}
        result = await user_manager.delete_profile("user-123")
        assert result is True

    @pytest.mark.asyncio
    async def test_login_flow(self, user_manager, mock_dynamodb):
        """Test typical login flow with create_or_update_profile."""
        now = datetime.now(timezone.utc)
        
        # First login - creates new profile
        mock_dynamodb.update_item.side_effect = ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException", "Message": ""}},
            "UpdateItem"
        )
        mock_dynamodb.put_item.return_value = {}
        
        profile = await user_manager.create_or_update_profile(
            user_id="user-123",
            email="test@example.com",
            name="Test User"
        )
        assert profile.login_count == 1
        
        # Second login - updates existing profile
        mock_dynamodb.update_item.side_effect = None
        mock_dynamodb.update_item.return_value = {
            "Attributes": {
                "userId": "user-123",
                "sk": "PROFILE",
                "email": "test@example.com",
                "name": "Test User",
                "preferences": {"theme": "system"},
                "createdAt": now.isoformat(),
                "lastLoginAt": now.isoformat(),
                "loginCount": 2
            }
        }
        
        profile = await user_manager.create_or_update_profile(
            user_id="user-123",
            email="test@example.com",
            name="Test User"
        )
        assert profile.login_count == 2
