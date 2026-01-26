"""
Tests for SwarmMessageStore

Tests cover:
- Message sequence building (_build_messages_to_save)
- Swarm context serialization (_build_swarm_context)
- Content block ordering and role alternation
"""

import pytest
from unittest.mock import Mock, MagicMock, patch
import os
import sys

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))


class TestBuildMessagesToSave:
    """Test _build_messages_to_save method - core message formatting logic."""

    def _create_store_instance(self):
        """Create a SwarmMessageStore instance for testing without real session manager."""
        from agent.session.swarm_message_store import SwarmMessageStore

        with patch.object(SwarmMessageStore, '_create_session_manager', return_value=Mock()):
            with patch.object(SwarmMessageStore, '_get_next_message_index', return_value=0):
                store = SwarmMessageStore(
                    session_id="test-session",
                    user_id="test-user",
                    memory_id=None
                )
        return store

    def test_user_message_only(self):
        """Should create user message when no content blocks."""
        store = self._create_store_instance()

        result = store._build_messages_to_save(
            user_message="Hello",
            content_blocks=None,
            swarm_state=None
        )

        assert len(result) == 1
        assert result[0]["role"] == "user"
        assert result[0]["content"] == [{"text": "Hello"}]

    def test_text_only_response(self):
        """Should create user + assistant messages for text-only response."""
        store = self._create_store_instance()

        content_blocks = [
            {"text": "Hello! How can I help you?"}
        ]

        result = store._build_messages_to_save(
            user_message="Hi",
            content_blocks=content_blocks,
            swarm_state=None
        )

        assert len(result) == 2
        assert result[0]["role"] == "user"
        assert result[1]["role"] == "assistant"
        assert result[1]["content"] == [{"text": "Hello! How can I help you?"}]

    def test_tool_use_and_result_alternation(self):
        """Should split toolResult into separate user message (Bedrock API format)."""
        store = self._create_store_instance()

        content_blocks = [
            {"text": "Let me search for that."},
            {"toolUse": {"toolUseId": "tool-1", "name": "web_search", "input": {"query": "test"}}},
            {"toolResult": {"toolUseId": "tool-1", "content": [{"text": "Search results"}], "status": "success"}},
            {"text": "Based on the search results..."}
        ]

        result = store._build_messages_to_save(
            user_message="Search for test",
            content_blocks=content_blocks,
            swarm_state=None
        )

        # Expected: user -> assistant (text + toolUse) -> user (toolResult) -> assistant (text)
        assert len(result) == 4

        # First user message
        assert result[0]["role"] == "user"
        assert result[0]["content"] == [{"text": "Search for test"}]

        # Assistant with text + toolUse
        assert result[1]["role"] == "assistant"
        assert len(result[1]["content"]) == 2
        assert result[1]["content"][0] == {"text": "Let me search for that."}
        assert "toolUse" in result[1]["content"][1]

        # User with toolResult
        assert result[2]["role"] == "user"
        assert "toolResult" in result[2]["content"][0]

        # Final assistant text
        assert result[3]["role"] == "assistant"
        assert result[3]["content"] == [{"text": "Based on the search results..."}]

    def test_multiple_tool_calls(self):
        """Should handle multiple tool use/result pairs correctly."""
        store = self._create_store_instance()

        content_blocks = [
            {"toolUse": {"toolUseId": "t1", "name": "tool_a", "input": {}}},
            {"toolResult": {"toolUseId": "t1", "content": [{"text": "Result A"}], "status": "success"}},
            {"toolUse": {"toolUseId": "t2", "name": "tool_b", "input": {}}},
            {"toolResult": {"toolUseId": "t2", "content": [{"text": "Result B"}], "status": "success"}},
            {"text": "Done."}
        ]

        result = store._build_messages_to_save(
            user_message="Do tasks",
            content_blocks=content_blocks,
            swarm_state=None
        )

        # Verify alternating pattern: user -> assistant (toolUse) -> user (toolResult) -> assistant (toolUse) -> user (toolResult) -> assistant (text)
        assert len(result) == 6
        roles = [msg["role"] for msg in result]
        assert roles == ["user", "assistant", "user", "assistant", "user", "assistant"]

    def test_swarm_context_appended_to_final_assistant(self):
        """Should append swarm_context to final assistant message."""
        store = self._create_store_instance()

        content_blocks = [
            {"text": "Here is the response."}
        ]

        swarm_state = {
            "node_history": ["coordinator", "web_researcher", "responder"],
            "shared_context": {
                "web_researcher": {"citations": [{"source": "Test", "url": "http://test.com"}]}
            }
        }

        result = store._build_messages_to_save(
            user_message="Search",
            content_blocks=content_blocks,
            swarm_state=swarm_state
        )

        # Check swarm_context is in the final assistant message
        final_assistant = result[-1]
        assert final_assistant["role"] == "assistant"

        # Should have original text + swarm_context text
        assert len(final_assistant["content"]) == 2
        assert final_assistant["content"][0] == {"text": "Here is the response."}
        assert "<swarm_context>" in final_assistant["content"][1]["text"]

    def test_empty_content_blocks(self):
        """Should handle empty content blocks (returns user message only)."""
        store = self._create_store_instance()

        result = store._build_messages_to_save(
            user_message="Hello",
            content_blocks=[],
            swarm_state=None
        )

        # Only user message when no assistant content
        assert len(result) == 1
        assert result[0]["role"] == "user"


class TestBuildSwarmContext:
    """Test _build_swarm_context method - context serialization logic."""

    def _create_store_instance(self):
        """Create a SwarmMessageStore instance for testing."""
        from agent.session.swarm_message_store import SwarmMessageStore

        with patch.object(SwarmMessageStore, '_create_session_manager', return_value=Mock()):
            with patch.object(SwarmMessageStore, '_get_next_message_index', return_value=0):
                store = SwarmMessageStore(
                    session_id="test-session",
                    user_id="test-user",
                    memory_id=None
                )
        return store

    def test_filters_coordinator_and_responder_from_agents_used(self):
        """Should exclude coordinator and responder from agents_used list."""
        store = self._create_store_instance()

        swarm_state = {
            "node_history": ["coordinator", "web_researcher", "data_analyst", "responder"],
            "shared_context": {}
        }

        result = store._build_swarm_context(swarm_state)

        assert "agents_used:" in result
        assert "coordinator" not in result.split("agents_used:")[1].split("\n")[0]
        assert "responder" not in result.split("agents_used:")[1].split("\n")[0]
        assert "web_researcher" in result
        assert "data_analyst" in result

    def test_filters_coordinator_and_responder_from_shared_context(self):
        """Should exclude coordinator and responder from shared_context."""
        store = self._create_store_instance()

        swarm_state = {
            "node_history": ["coordinator", "web_researcher", "responder"],
            "shared_context": {
                "coordinator": {"should": "not appear"},
                "web_researcher": {"citations": [{"url": "test.com"}]},
                "responder": {"should": "not appear"}
            }
        }

        result = store._build_swarm_context(swarm_state)

        assert "web_researcher:" in result
        assert "citations" in result
        assert '"coordinator":' not in result
        assert '"responder":' not in result

    def test_returns_none_for_empty_state(self):
        """Should return None when no agents_used and no shared_context."""
        store = self._create_store_instance()

        swarm_state = {
            "node_history": ["coordinator", "responder"],  # Only filtered agents
            "shared_context": {}
        }

        result = store._build_swarm_context(swarm_state)

        assert result is None

    def test_returns_none_for_coordinator_only_context(self):
        """Should return None when only coordinator data exists."""
        store = self._create_store_instance()

        swarm_state = {
            "node_history": ["coordinator", "responder"],
            "shared_context": {
                "coordinator": {"data": "filtered out"}
            }
        }

        result = store._build_swarm_context(swarm_state)

        assert result is None

    def test_json_serializes_shared_context_data(self):
        """Should properly JSON serialize agent data in shared_context."""
        store = self._create_store_instance()

        swarm_state = {
            "node_history": ["coordinator", "data_analyst", "responder"],
            "shared_context": {
                "data_analyst": {
                    "images": [
                        {"filename": "chart.png", "description": "Sales chart"}
                    ]
                }
            }
        }

        result = store._build_swarm_context(swarm_state)

        # Should be valid JSON within the context
        assert "data_analyst:" in result
        assert '"images"' in result
        assert '"filename"' in result
        assert "chart.png" in result

    def test_swarm_context_format(self):
        """Should wrap content in <swarm_context> tags."""
        store = self._create_store_instance()

        swarm_state = {
            "node_history": ["coordinator", "web_researcher", "responder"],
            "shared_context": {}
        }

        result = store._build_swarm_context(swarm_state)

        assert result.startswith("<swarm_context>")
        assert result.endswith("</swarm_context>")


class TestMessageIndexTracking:
    """Test message index management for sequential storage."""

    def test_get_next_message_index_returns_zero_for_new_session(self):
        """Should return 0 for new session with no messages."""
        from agent.session.swarm_message_store import SwarmMessageStore

        mock_repo = Mock()
        mock_repo.list_messages.side_effect = Exception("Session not found")

        with patch.object(SwarmMessageStore, '_create_session_manager') as mock_create:
            mock_manager = Mock()
            mock_manager.session_repository = mock_repo
            mock_create.return_value = mock_manager

            store = SwarmMessageStore(
                session_id="new-session",
                user_id="test-user",
                memory_id=None
            )

        assert store._message_index == 0

    def test_get_next_message_index_returns_existing_count(self):
        """Should return count of existing messages."""
        from agent.session.swarm_message_store import SwarmMessageStore

        mock_repo = Mock()
        mock_repo.list_messages.return_value = [Mock(), Mock(), Mock()]  # 3 existing messages

        with patch.object(SwarmMessageStore, '_create_session_manager') as mock_create:
            mock_manager = Mock()
            mock_manager.session_repository = mock_repo
            mock_create.return_value = mock_manager

            store = SwarmMessageStore(
                session_id="existing-session",
                user_id="test-user",
                memory_id=None
            )

        assert store._message_index == 3
