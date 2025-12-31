"""
Unit tests for Stop Signal functionality.

Tests the stop signal provider (Local and DynamoDB) and router endpoint.
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

    def test_initial_state_no_stop_requested(self, provider):
        """Test that initially no stop is requested."""
        result = provider.is_stop_requested("user_123", "session_456")

        assert result is False

    def test_request_stop(self, provider):
        """Test requesting stop for a session."""
        provider.request_stop("user_123", "session_456")

        result = provider.is_stop_requested("user_123", "session_456")
        assert result is True

    def test_clear_stop_signal(self, provider):
        """Test clearing stop signal."""
        provider.request_stop("user_123", "session_456")
        assert provider.is_stop_requested("user_123", "session_456") is True

        provider.clear_stop_signal("user_123", "session_456")

        assert provider.is_stop_requested("user_123", "session_456") is False

    def test_clear_nonexistent_signal(self, provider):
        """Test clearing a signal that doesn't exist doesn't raise error."""
        # Should not raise any exception
        provider.clear_stop_signal("nonexistent_user", "nonexistent_session")

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

    def test_key_generation(self, provider):
        """Test internal key generation format."""
        key = provider._get_key("user_abc", "session_xyz")

        assert key == "user_abc:session_xyz"

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
    """Tests for DynamoDBStopSignalProvider."""

    @pytest.fixture
    def mock_dynamodb_table(self):
        """Create a mock DynamoDB table."""
        table = MagicMock()
        return table

    @pytest.fixture
    def provider(self, mock_dynamodb_table):
        """Create a DynamoDBStopSignalProvider with mocked table."""
        provider = DynamoDBStopSignalProvider(
            table_name="test-users-v2",
            region="us-west-2"
        )
        provider._table = mock_dynamodb_table
        return provider

    def test_initialization(self):
        """Test provider initialization."""
        provider = DynamoDBStopSignalProvider(
            table_name="my-table",
            region="us-east-1"
        )

        assert provider.table_name == "my-table"
        assert provider.region == "us-east-1"
        assert provider._table is None  # Lazy init

    def test_key_structure(self, provider):
        """Test DynamoDB key structure matches frontend schema."""
        key = provider._get_key("user_123", "session_456")

        assert key == {
            'userId': 'user_123',
            'sk': 'SESSION#session_456'
        }

    def test_is_stop_requested_true(self, provider, mock_dynamodb_table):
        """Test checking stop requested returns True when set."""
        mock_dynamodb_table.get_item.return_value = {
            'Item': {'stopRequested': True}
        }

        result = provider.is_stop_requested("user_123", "session_456")

        assert result is True
        mock_dynamodb_table.get_item.assert_called_once()

    def test_is_stop_requested_false(self, provider, mock_dynamodb_table):
        """Test checking stop requested returns False when not set."""
        mock_dynamodb_table.get_item.return_value = {
            'Item': {'stopRequested': False}
        }

        result = provider.is_stop_requested("user_123", "session_456")

        assert result is False

    def test_is_stop_requested_no_item(self, provider, mock_dynamodb_table):
        """Test checking stop requested returns False when item doesn't exist."""
        mock_dynamodb_table.get_item.return_value = {}

        result = provider.is_stop_requested("user_123", "session_456")

        assert result is False

    def test_is_stop_requested_no_attribute(self, provider, mock_dynamodb_table):
        """Test checking stop requested returns False when attribute missing."""
        mock_dynamodb_table.get_item.return_value = {
            'Item': {'otherAttribute': 'value'}
        }

        result = provider.is_stop_requested("user_123", "session_456")

        assert result is False

    def test_is_stop_requested_error_handling(self, provider, mock_dynamodb_table):
        """Test error handling when DynamoDB call fails."""
        mock_dynamodb_table.get_item.side_effect = Exception("DynamoDB error")

        result = provider.is_stop_requested("user_123", "session_456")

        # Should return False on error (fail-safe)
        assert result is False

    def test_request_stop_update_expression(self, provider, mock_dynamodb_table):
        """Test request_stop calls DynamoDB with correct update expression."""
        provider.request_stop("user_123", "session_456")

        mock_dynamodb_table.update_item.assert_called_once()
        call_kwargs = mock_dynamodb_table.update_item.call_args[1]

        assert 'Key' in call_kwargs
        assert call_kwargs['Key'] == {
            'userId': 'user_123',
            'sk': 'SESSION#session_456'
        }
        assert 'UpdateExpression' in call_kwargs
        assert 'stopRequested' in call_kwargs['UpdateExpression']

    def test_request_stop_error_propagation(self, provider, mock_dynamodb_table):
        """Test that errors in request_stop are propagated."""
        mock_dynamodb_table.update_item.side_effect = Exception("DynamoDB error")

        with pytest.raises(Exception) as exc_info:
            provider.request_stop("user_123", "session_456")

        assert "DynamoDB error" in str(exc_info.value)

    def test_clear_stop_signal(self, provider, mock_dynamodb_table):
        """Test clear_stop_signal removes stopRequested attribute."""
        provider.clear_stop_signal("user_123", "session_456")

        mock_dynamodb_table.update_item.assert_called_once()
        call_kwargs = mock_dynamodb_table.update_item.call_args[1]

        assert 'REMOVE' in call_kwargs['UpdateExpression']
        assert 'stopRequested' in call_kwargs['UpdateExpression']

    def test_clear_stop_signal_error_silent(self, provider, mock_dynamodb_table):
        """Test clear_stop_signal silently handles errors."""
        mock_dynamodb_table.update_item.side_effect = Exception("DynamoDB error")

        # Should not raise
        provider.clear_stop_signal("user_123", "session_456")

    def test_lazy_table_initialization(self):
        """Test that DynamoDB table is lazily initialized."""
        provider = DynamoDBStopSignalProvider(
            table_name="test-table",
            region="us-west-2"
        )

        assert provider._dynamodb is None
        assert provider._table is None

    @patch('boto3.resource')
    def test_get_table_creates_connection(self, mock_boto3_resource):
        """Test _get_table creates DynamoDB connection."""
        mock_dynamodb = MagicMock()
        mock_table = MagicMock()
        mock_boto3_resource.return_value = mock_dynamodb
        mock_dynamodb.Table.return_value = mock_table

        provider = DynamoDBStopSignalProvider(
            table_name="test-table",
            region="us-west-2"
        )

        table = provider._get_table()

        assert table is mock_table
        mock_boto3_resource.assert_called_once_with('dynamodb', region_name='us-west-2')
        mock_dynamodb.Table.assert_called_once_with('test-table')


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

    def test_local_provider_when_local_env(self, monkeypatch):
        """Test factory returns LocalStopSignalProvider when NEXT_PUBLIC_AGENTCORE_LOCAL=true."""
        monkeypatch.setenv("NEXT_PUBLIC_AGENTCORE_LOCAL", "true")
        LocalStopSignalProvider._instance = None

        provider = get_stop_signal_provider()

        assert isinstance(provider, LocalStopSignalProvider)

    def test_dynamodb_provider_when_not_local(self, monkeypatch):
        """Test factory returns DynamoDBStopSignalProvider when not local."""
        monkeypatch.setenv("NEXT_PUBLIC_AGENTCORE_LOCAL", "false")
        monkeypatch.setenv("PROJECT_NAME", "test-project")
        monkeypatch.setenv("AWS_REGION", "us-east-1")

        provider = get_stop_signal_provider()

        assert isinstance(provider, DynamoDBStopSignalProvider)
        assert provider.table_name == "test-project-users-v2"
        assert provider.region == "us-east-1"

    def test_dynamodb_provider_default_values(self, monkeypatch):
        """Test DynamoDB provider uses default values when env vars not set."""
        monkeypatch.delenv("NEXT_PUBLIC_AGENTCORE_LOCAL", raising=False)
        monkeypatch.delenv("PROJECT_NAME", raising=False)
        monkeypatch.delenv("AWS_REGION", raising=False)

        provider = get_stop_signal_provider()

        assert isinstance(provider, DynamoDBStopSignalProvider)
        assert provider.table_name == "strands-agent-chatbot-users-v2"
        assert provider.region == "us-west-2"

    def test_provider_singleton(self, monkeypatch):
        """Test factory returns same instance on subsequent calls."""
        monkeypatch.setenv("NEXT_PUBLIC_AGENTCORE_LOCAL", "true")
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

    @pytest.fixture
    def mock_agent(self):
        """Create a mock agent."""
        agent = MagicMock()
        agent.session_manager = MagicMock()
        agent.agent_id = "test_agent"
        return agent

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

    def test_stop_signal_workflow(self, local_provider):
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

    def test_empty_user_id(self, local_provider):
        """Test handling of empty user_id."""
        local_provider.request_stop("", "session_123")

        assert local_provider.is_stop_requested("", "session_123") is True

    def test_empty_session_id(self, local_provider):
        """Test handling of empty session_id."""
        local_provider.request_stop("user_123", "")

        assert local_provider.is_stop_requested("user_123", "") is True

    def test_special_characters_in_ids(self, local_provider):
        """Test handling of special characters in IDs."""
        user_id = "user@example.com:sub=123"
        session_id = "session#456&key=value"

        local_provider.request_stop(user_id, session_id)

        assert local_provider.is_stop_requested(user_id, session_id) is True

    def test_unicode_in_ids(self, local_provider):
        """Test handling of unicode characters in IDs."""
        user_id = "user_cn_123"
        session_id = "session_kr_456"

        local_provider.request_stop(user_id, session_id)

        assert local_provider.is_stop_requested(user_id, session_id) is True

    def test_very_long_ids(self, local_provider):
        """Test handling of very long IDs."""
        user_id = "user_" + "x" * 1000
        session_id = "session_" + "y" * 1000

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

    def test_repeated_clear_requests(self, local_provider):
        """Test that repeated clear requests don't cause issues."""
        user_id = "user_clear_repeat"
        session_id = "session_clear_repeat"

        local_provider.request_stop(user_id, session_id)

        # Clear multiple times
        for _ in range(10):
            local_provider.clear_stop_signal(user_id, session_id)

        assert local_provider.is_stop_requested(user_id, session_id) is False
