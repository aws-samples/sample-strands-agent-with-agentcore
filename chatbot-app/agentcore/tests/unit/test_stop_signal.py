"""
Unit tests for Stop Signal functionality.

Tests the DynamoDBStopSignalProvider, factory function, and router endpoint.
Focuses on meaningful logic:
- Two-phase stop protocol
- DynamoDB error handling
- Factory function behavior
- Router integration
"""
import os
import sys
import pytest
import threading
from unittest.mock import MagicMock, patch, AsyncMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../src'))

from agent.stop_signal import (
    StopSignalProvider,
    DynamoDBStopSignalProvider,
    get_stop_signal_provider,
)


# ============================================================
# DynamoDBStopSignalProvider Tests
# ============================================================

class TestDynamoDBStopSignalProvider:
    """Tests for DynamoDBStopSignalProvider with two-phase stop protocol."""

    @pytest.fixture
    def provider_and_client(self):
        """Create a DynamoDBStopSignalProvider with mocked boto3 client."""
        mock_client = MagicMock()
        with patch("boto3.client", return_value=mock_client):
            provider = DynamoDBStopSignalProvider("test-table")
        return provider, mock_client

    def test_is_stop_requested_phase1(self, provider_and_client):
        """Test is_stop_requested returns True only for phase 1."""
        provider, mock_client = provider_and_client
        mock_client.get_item.return_value = {
            "Item": {"phase": {"N": "1"}}
        }
        assert provider.is_stop_requested("user1", "sess1") is True
        mock_client.get_item.assert_called_once_with(
            TableName="test-table",
            Key={"userId": {"S": "STOP#user1"}, "sk": {"S": "SESSION#sess1"}},
            ProjectionExpression="phase",
        )

    def test_is_stop_requested_phase2_ignored(self, provider_and_client):
        """Test is_stop_requested returns False for phase 2 (Code Agent only)."""
        provider, mock_client = provider_and_client
        mock_client.get_item.return_value = {
            "Item": {"phase": {"N": "2"}}
        }
        assert provider.is_stop_requested("user1", "sess1") is False

    def test_is_stop_requested_not_found(self, provider_and_client):
        """Test is_stop_requested returns False when item missing."""
        provider, mock_client = provider_and_client
        mock_client.get_item.return_value = {}
        assert provider.is_stop_requested("user1", "sess1") is False

    def test_is_stop_requested_error(self, provider_and_client):
        """Test is_stop_requested returns False on DynamoDB error."""
        provider, mock_client = provider_and_client
        mock_client.get_item.side_effect = Exception("DynamoDB timeout")
        assert provider.is_stop_requested("user1", "sess1") is False

    def test_request_stop_writes_phase1(self, provider_and_client):
        """Test request_stop writes item with phase=1 and TTL."""
        provider, mock_client = provider_and_client
        provider.request_stop("user1", "sess1")
        mock_client.put_item.assert_called_once()
        call_args = mock_client.put_item.call_args
        item = call_args[1]["Item"]
        assert item["userId"]["S"] == "STOP#user1"
        assert item["sk"]["S"] == "SESSION#sess1"
        assert item["phase"]["N"] == "1"
        assert "ttl" in item

    def test_escalate_to_code_agent(self, provider_and_client):
        """Test escalate_to_code_agent updates phase to 2."""
        provider, mock_client = provider_and_client
        provider.escalate_to_code_agent("user1", "sess1")
        mock_client.update_item.assert_called_once_with(
            TableName="test-table",
            Key={"userId": {"S": "STOP#user1"}, "sk": {"S": "SESSION#sess1"}},
            UpdateExpression="SET phase = :p",
            ExpressionAttributeValues={":p": {"N": "2"}},
        )

    def test_escalate_to_code_agent_error(self, provider_and_client):
        """Test escalate_to_code_agent handles errors gracefully."""
        provider, mock_client = provider_and_client
        mock_client.update_item.side_effect = Exception("DynamoDB error")
        # Should not raise
        provider.escalate_to_code_agent("user1", "sess1")

    def test_clear_stop_signal(self, provider_and_client):
        """Test clear_stop_signal deletes the item."""
        provider, mock_client = provider_and_client
        provider.clear_stop_signal("user1", "sess1")
        mock_client.delete_item.assert_called_once_with(
            TableName="test-table",
            Key={"userId": {"S": "STOP#user1"}, "sk": {"S": "SESSION#sess1"}},
        )

    def test_clear_stop_signal_error(self, provider_and_client):
        """Test clear_stop_signal handles errors gracefully."""
        provider, mock_client = provider_and_client
        mock_client.delete_item.side_effect = Exception("DynamoDB error")
        # Should not raise
        provider.clear_stop_signal("user1", "sess1")

    def test_two_phase_lifecycle(self, provider_and_client):
        """Test complete two-phase stop signal lifecycle."""
        provider, mock_client = provider_and_client

        # Phase 1: BFF writes stop signal
        provider.request_stop("user1", "sess1")
        assert mock_client.put_item.call_args[1]["Item"]["phase"]["N"] == "1"

        # Main Agent detects phase 1
        mock_client.get_item.return_value = {"Item": {"phase": {"N": "1"}}}
        assert provider.is_stop_requested("user1", "sess1") is True

        # Main Agent escalates to phase 2
        provider.escalate_to_code_agent("user1", "sess1")
        mock_client.update_item.assert_called_once()

        # Main Agent no longer sees stop (phase is now 2)
        mock_client.get_item.return_value = {"Item": {"phase": {"N": "2"}}}
        assert provider.is_stop_requested("user1", "sess1") is False

        # Code Agent cleans up
        provider.clear_stop_signal("user1", "sess1")
        mock_client.delete_item.assert_called_once()


# ============================================================
# Factory Function Tests
# ============================================================

class TestGetStopSignalProvider:
    """Tests for get_stop_signal_provider factory function."""

    def setup_method(self):
        """Reset global state before each test."""
        import agent.stop_signal as module
        module._provider_instance = None

    def teardown_method(self):
        """Reset global state after each test."""
        import agent.stop_signal as module
        module._provider_instance = None

    def test_returns_none_when_no_env(self):
        """Test factory returns None when DYNAMODB_USERS_TABLE not set."""
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DYNAMODB_USERS_TABLE", None)
            provider = get_stop_signal_provider()
        assert provider is None

    def test_returns_dynamodb_provider_when_env_set(self):
        """Test factory returns DynamoDBStopSignalProvider when DYNAMODB_USERS_TABLE is set."""
        with patch.dict(os.environ, {"DYNAMODB_USERS_TABLE": "my-table", "AWS_REGION": "us-west-2"}), \
             patch("boto3.client"):
            provider = get_stop_signal_provider()
        assert isinstance(provider, DynamoDBStopSignalProvider)

    def test_provider_singleton(self):
        """Test factory returns same instance on subsequent calls."""
        with patch.dict(os.environ, {"DYNAMODB_USERS_TABLE": "my-table", "AWS_REGION": "us-west-2"}), \
             patch("boto3.client"):
            provider1 = get_stop_signal_provider()
            provider2 = get_stop_signal_provider()
        assert provider1 is provider2


# ============================================================
# Stop Router Tests
# ============================================================

class TestStopRouter:
    """Tests for the /stop API endpoint."""

    @pytest.fixture
    def mock_provider(self):
        """Create a mock stop signal provider."""
        return MagicMock(spec=StopSignalProvider)

    @pytest.mark.asyncio
    async def test_stop_endpoint_success(self, mock_provider):
        """Test successful stop signal request."""
        from routers.stop import set_stop_signal, StopRequest

        with patch('routers.stop.get_stop_signal_provider', return_value=mock_provider):
            request = StopRequest(user_id="user_123", session_id="session_456")
            response = await set_stop_signal(request)

        assert response.success is True
        assert response.message == "Stop signal set"
        assert response.user_id == "user_123"
        assert response.session_id == "session_456"
        mock_provider.request_stop.assert_called_once_with("user_123", "session_456")

    @pytest.mark.asyncio
    async def test_stop_endpoint_error(self, mock_provider):
        """Test stop signal request with error."""
        from routers.stop import set_stop_signal, StopRequest

        mock_provider.request_stop.side_effect = Exception("Provider error")

        with patch('routers.stop.get_stop_signal_provider', return_value=mock_provider):
            request = StopRequest(user_id="user_123", session_id="session_456")
            response = await set_stop_signal(request)

        assert response.success is False
        assert "Provider error" in response.message

    @pytest.mark.asyncio
    async def test_stop_request_model_validation(self):
        """Test StopRequest model requires both fields."""
        from routers.stop import StopRequest
        from pydantic import ValidationError

        # Valid request
        request = StopRequest(user_id="user", session_id="session")
        assert request.user_id == "user"
        assert request.session_id == "session"

        # Invalid request - missing fields
        with pytest.raises(ValidationError):
            StopRequest()

        with pytest.raises(ValidationError):
            StopRequest(user_id="user")

        with pytest.raises(ValidationError):
            StopRequest(session_id="session")
