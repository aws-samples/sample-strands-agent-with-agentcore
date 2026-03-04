"""
Unit tests for Stop Signal functionality.

Tests the LocalStopSignalProvider and router endpoint.
Focuses on meaningful logic:
- Thread safety
- Session isolation
- Stop signal lifecycle
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
    LocalStopSignalProvider,
    DynamoDBStopSignalProvider,
    get_stop_signal_provider,
)


# ============================================================
# LocalStopSignalProvider Tests
# ============================================================

class TestLocalStopSignalProvider:
    """Tests for LocalStopSignalProvider (in-memory)."""

    @pytest.fixture
    def provider(self):
        """Create a fresh LocalStopSignalProvider instance."""
        # Reset singleton for testing
        LocalStopSignalProvider._instance = None
        return LocalStopSignalProvider()

    def test_singleton_pattern(self):
        """Test that LocalStopSignalProvider is a singleton."""
        LocalStopSignalProvider._instance = None
        provider1 = LocalStopSignalProvider()
        provider2 = LocalStopSignalProvider()

        assert provider1 is provider2

    def test_stop_signal_lifecycle(self, provider):
        """Test complete stop signal lifecycle"""
        # Initially no stop requested
        assert provider.is_stop_requested("user_123", "session_456") is False

        # Request stop
        provider.request_stop("user_123", "session_456")
        assert provider.is_stop_requested("user_123", "session_456") is True

        # Clear stop signal
        provider.clear_stop_signal("user_123", "session_456")
        assert provider.is_stop_requested("user_123", "session_456") is False

    def test_multiple_sessions_isolation(self, provider):
        """Test that stop signals are isolated per session."""
        provider.request_stop("user_1", "session_1")

        assert provider.is_stop_requested("user_1", "session_1") is True
        assert provider.is_stop_requested("user_1", "session_2") is False
        assert provider.is_stop_requested("user_2", "session_1") is False

    def test_multiple_users_isolation(self, provider):
        """Test that stop signals are isolated per user."""
        provider.request_stop("user_1", "session_1")
        provider.request_stop("user_2", "session_2")

        assert provider.is_stop_requested("user_1", "session_1") is True
        assert provider.is_stop_requested("user_2", "session_2") is True
        assert provider.is_stop_requested("user_1", "session_2") is False
        assert provider.is_stop_requested("user_2", "session_1") is False

    def test_escalate_is_noop(self, provider):
        """Test that escalate_to_code_agent is a no-op for local provider."""
        provider.request_stop("user_1", "session_1")
        # escalate should not raise or change state
        provider.escalate_to_code_agent("user_1", "session_1")
        # Signal should still be active (not cleared by escalate)
        assert provider.is_stop_requested("user_1", "session_1") is True

    def test_thread_safety_request_stop(self, provider):
        """Test thread safety of request_stop."""
        results = []

        def request_and_check():
            provider.request_stop("user_thread", "session_thread")
            results.append(provider.is_stop_requested("user_thread", "session_thread"))

        threads = [threading.Thread(target=request_and_check) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # All threads should see True after requesting
        assert all(results)

    def test_thread_safety_concurrent_sessions(self, provider):
        """Test thread safety with concurrent sessions."""
        def set_stop_for_session(session_id):
            provider.request_stop("user_concurrent", session_id)

        threads = [
            threading.Thread(target=set_stop_for_session, args=(f"session_{i}",))
            for i in range(20)
        ]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # All sessions should have stop requested
        for i in range(20):
            assert provider.is_stop_requested("user_concurrent", f"session_{i}") is True


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

    def test_returns_local_provider_when_no_env(self):
        """Test factory returns LocalStopSignalProvider when DYNAMODB_USERS_TABLE not set."""
        LocalStopSignalProvider._instance = None
        with patch.dict(os.environ, {}, clear=False):
            # Ensure DYNAMODB_USERS_TABLE is not set
            os.environ.pop("DYNAMODB_USERS_TABLE", None)
            provider = get_stop_signal_provider()
        assert isinstance(provider, LocalStopSignalProvider)

    def test_returns_dynamodb_provider_when_env_set(self):
        """Test factory returns DynamoDBStopSignalProvider when DYNAMODB_USERS_TABLE is set."""
        with patch.dict(os.environ, {"DYNAMODB_USERS_TABLE": "my-table", "AWS_REGION": "us-west-2"}), \
             patch("boto3.client"):
            provider = get_stop_signal_provider()
        assert isinstance(provider, DynamoDBStopSignalProvider)

    def test_provider_singleton(self):
        """Test factory returns same instance on subsequent calls."""
        LocalStopSignalProvider._instance = None

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


# ============================================================
# Integration Tests: Stop Signal with StreamEventProcessor
# ============================================================

class TestStopSignalStreamIntegration:
    """Tests for stop signal integration with streaming."""

    @pytest.fixture
    def local_provider(self):
        """Create a local provider for testing."""
        LocalStopSignalProvider._instance = None
        return LocalStopSignalProvider()

    def test_stop_check_during_streaming_scenario(self, local_provider):
        """Test stop signal check during simulated streaming."""
        user_id = "user_streaming"
        session_id = "session_streaming"

        # Simulate streaming loop checking stop signal
        stop_checks = []

        for i in range(5):
            is_stopped = local_provider.is_stop_requested(user_id, session_id)
            stop_checks.append(is_stopped)

            # Simulate stop request mid-stream
            if i == 2:
                local_provider.request_stop(user_id, session_id)

        # First 3 checks should be False, last 2 should be True
        assert stop_checks == [False, False, False, True, True]

    def test_stop_signal_cleared_after_stream_ends(self, local_provider):
        """Test that stop signal is properly cleared after stream ends."""
        user_id = "user_clear"
        session_id = "session_clear"

        # Request stop
        local_provider.request_stop(user_id, session_id)
        assert local_provider.is_stop_requested(user_id, session_id) is True

        # Simulate stream ending and clearing signal
        local_provider.clear_stop_signal(user_id, session_id)

        # Next request should not be stopped
        assert local_provider.is_stop_requested(user_id, session_id) is False

    def test_stop_signal_complete_workflow(self, local_provider):
        """Test complete stop signal workflow."""
        user_id = "workflow_user"
        session_id = "workflow_session"

        # 1. Start: no stop requested
        assert local_provider.is_stop_requested(user_id, session_id) is False

        # 2. User clicks stop button (frontend -> BFF -> AgentCore)
        local_provider.request_stop(user_id, session_id)

        # 3. AgentCore checks and sees stop requested
        assert local_provider.is_stop_requested(user_id, session_id) is True

        # 4. AgentCore processes stop, saves partial response, clears signal
        local_provider.clear_stop_signal(user_id, session_id)

        # 5. Signal is cleared for next request
        assert local_provider.is_stop_requested(user_id, session_id) is False


# ============================================================
# Edge Cases and Error Handling
# ============================================================

class TestStopSignalEdgeCases:
    """Tests for edge cases and error handling."""

    @pytest.fixture
    def local_provider(self):
        LocalStopSignalProvider._instance = None
        return LocalStopSignalProvider()

    def test_special_characters_in_ids(self, local_provider):
        """Test handling of special characters in IDs."""
        user_id = "user@example.com:sub=123"
        session_id = "session#456&key=value"

        local_provider.request_stop(user_id, session_id)
        assert local_provider.is_stop_requested(user_id, session_id) is True

    def test_repeated_stop_requests(self, local_provider):
        """Test that repeated stop requests don't cause issues."""
        user_id = "user_repeat"
        session_id = "session_repeat"

        # Request stop multiple times
        for _ in range(10):
            local_provider.request_stop(user_id, session_id)

        assert local_provider.is_stop_requested(user_id, session_id) is True

        # Single clear should clear it
        local_provider.clear_stop_signal(user_id, session_id)
        assert local_provider.is_stop_requested(user_id, session_id) is False

    def test_clear_nonexistent_signal(self, local_provider):
        """Test clearing a signal that doesn't exist doesn't raise error."""
        # Should not raise any exception
        local_provider.clear_stop_signal("nonexistent_user", "nonexistent_session")
