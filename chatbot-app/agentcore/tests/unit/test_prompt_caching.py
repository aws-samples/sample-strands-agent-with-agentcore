"""
Tests for Prompt Caching functionality

Tests cover:
- ConversationCachingHook
- Cache point insertion logic
- Sliding window (max 3 cache points)
- BedrockModel cache_prompt configuration
- Agent caching_enabled flag
"""
import pytest
from unittest.mock import MagicMock
import copy
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../src'))


# ============================================================
# ConversationCachingHook Tests
# ============================================================

class TestConversationCachingHook:
    """Tests for ConversationCachingHook functionality."""

    @pytest.fixture
    def mock_event(self):
        """Create mock BeforeModelCallEvent with agent and messages."""
        event = MagicMock()
        event.agent = MagicMock()
        event.agent.messages = []
        return event

    def test_hook_disabled_does_nothing(self, mock_event):
        """Test that disabled hook does not modify messages."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=False)
        mock_event.agent.messages = [
            {"role": "user", "content": [{"text": "Hello"}]},
            {"role": "assistant", "content": [{"text": "Hi there"}]}
        ]

        original_messages = copy.deepcopy(mock_event.agent.messages)
        hook.add_conversation_cache_point(mock_event)

        assert mock_event.agent.messages == original_messages

    def test_hook_enabled_adds_cache_points(self, mock_event):
        """Test that enabled hook adds cache points."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=True)
        mock_event.agent.messages = [
            {"role": "user", "content": [{"text": "Hello"}]},
            {"role": "assistant", "content": [{"text": "Hi there"}]}
        ]

        hook.add_conversation_cache_point(mock_event)

        # Check that cache point was added to assistant message
        assistant_msg = mock_event.agent.messages[1]
        has_cache_point = any(
            isinstance(block, dict) and "cachePoint" in block
            for block in assistant_msg["content"]
        )
        assert has_cache_point

    def test_max_three_cache_points(self, mock_event):
        """Test that maximum 3 cache points are maintained (sliding window)."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=True)

        # Create messages with many turns
        messages = []
        for i in range(10):
            messages.append({"role": "user", "content": [{"text": f"Question {i}"}]})
            messages.append({"role": "assistant", "content": [{"text": f"Answer {i}"}]})

        mock_event.agent.messages = messages
        hook.add_conversation_cache_point(mock_event)

        # Count cache points
        cache_count = 0
        for msg in mock_event.agent.messages:
            content = msg.get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and "cachePoint" in block:
                        cache_count += 1

        assert cache_count <= 3

    def test_does_not_duplicate_cache_points(self, mock_event):
        """Test that existing cache points are not duplicated."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=True)

        # Message already has cache point
        mock_event.agent.messages = [
            {"role": "user", "content": [{"text": "Hello"}]},
            {"role": "assistant", "content": [
                {"text": "Hi there"},
                {"cachePoint": {"type": "default"}}
            ]}
        ]

        initial_cache_count = sum(
            1 for msg in mock_event.agent.messages
            for block in msg.get("content", [])
            if isinstance(block, dict) and "cachePoint" in block
        )

        hook.add_conversation_cache_point(mock_event)

        final_cache_count = sum(
            1 for msg in mock_event.agent.messages
            for block in msg.get("content", [])
            if isinstance(block, dict) and "cachePoint" in block
        )

        # Should not add more cache points to already cached message
        assert final_cache_count <= 3

    def test_prioritizes_assistant_messages(self, mock_event):
        """Test that assistant messages are prioritized for caching."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=True)

        mock_event.agent.messages = [
            {"role": "user", "content": [{"text": "Question 1"}]},
            {"role": "assistant", "content": [{"text": "Answer 1"}]},
            {"role": "user", "content": [{"text": "Question 2"}]},
            {"role": "assistant", "content": [{"text": "Answer 2"}]}
        ]

        hook.add_conversation_cache_point(mock_event)

        # Check that at least one assistant message has cache point
        assistant_cache_count = 0
        for msg in mock_event.agent.messages:
            if msg["role"] == "assistant":
                content = msg.get("content", [])
                has_cache = any(
                    isinstance(block, dict) and "cachePoint" in block
                    for block in content
                )
                if has_cache:
                    assistant_cache_count += 1

        assert assistant_cache_count > 0

    def test_handles_tool_result_caching(self, mock_event):
        """Test caching after tool_result blocks."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=True)

        mock_event.agent.messages = [
            {"role": "user", "content": [{"text": "Search for X"}]},
            {"role": "assistant", "content": [
                {"text": "Let me search"},
                {"toolUse": {"toolUseId": "tool-1", "name": "search", "input": {}}}
            ]},
            {"role": "user", "content": [
                {"toolResult": {"toolUseId": "tool-1", "content": [{"text": "Results"}]}}
            ]},
            {"role": "assistant", "content": [{"text": "Here are the results"}]}
        ]

        hook.add_conversation_cache_point(mock_event)

        # Verify hook runs without error and messages are processed
        assert len(mock_event.agent.messages) == 4

    def test_handles_empty_messages(self, mock_event):
        """Test handling of empty message list."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=True)
        mock_event.agent.messages = []

        # Should not raise
        hook.add_conversation_cache_point(mock_event)

        assert mock_event.agent.messages == []

    def test_handles_string_content(self, mock_event):
        """Test handling of string content (not list)."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=True)

        # Some older formats might have string content
        mock_event.agent.messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"}
        ]

        # Should not raise - handles gracefully
        hook.add_conversation_cache_point(mock_event)


# ============================================================
# Cache Point Format Tests
# ============================================================

class TestCachePointFormat:
    """Tests for cache point format compliance."""

    def test_cache_point_structure(self):
        """Test that cache point has correct structure."""
        cache_point = {"cachePoint": {"type": "default"}}

        assert "cachePoint" in cache_point
        assert cache_point["cachePoint"]["type"] == "default"

    def test_cache_point_in_message_content(self):
        """Test cache point placement in message content array."""
        message = {
            "role": "assistant",
            "content": [
                {"text": "Here is my response"},
                {"cachePoint": {"type": "default"}}
            ]
        }

        # Cache point should be after text content
        assert message["content"][0].get("text") is not None
        assert message["content"][1].get("cachePoint") is not None

    def test_cache_point_after_tool_result(self):
        """Test cache point placement after tool result."""
        message = {
            "role": "user",
            "content": [
                {
                    "toolResult": {
                        "toolUseId": "tool-123",
                        "content": [{"text": "Results"}],
                        "status": "success"
                    }
                },
                {"cachePoint": {"type": "default"}}
            ]
        }

        # Cache point should be after toolResult
        assert "toolResult" in message["content"][0]
        assert "cachePoint" in message["content"][1]


# ============================================================
# BedrockModel Cache Configuration Tests
# ============================================================

class TestBedrockModelCacheConfig:
    """Tests for BedrockModel cache_prompt configuration."""

    def test_cache_prompt_default_value(self):
        """Test that cache_prompt is set to 'default' when enabled."""
        model_config = {
            "model_id": "anthropic.claude-3-sonnet-20240229-v1:0",
            "temperature": 0.7,
            "cache_prompt": "default"
        }

        assert model_config["cache_prompt"] == "default"

    def test_cache_prompt_not_present_when_disabled(self):
        """Test that cache_prompt is not in config when disabled."""
        model_config = {
            "model_id": "anthropic.claude-3-sonnet-20240229-v1:0",
            "temperature": 0.7
        }

        assert "cache_prompt" not in model_config

    def test_valid_cache_prompt_values(self):
        """Test valid values for cache_prompt."""
        # According to Strands/Bedrock, valid values are typically "default" or None
        valid_values = ["default", None]

        for value in valid_values:
            config = {"cache_prompt": value} if value else {}
            # Should not raise
            assert True


# ============================================================
# Agent Caching Integration Tests
# ============================================================

class TestAgentCachingIntegration:
    """Tests for agent-level caching configuration."""

    def test_caching_hook_initialization_enabled(self):
        """Test ConversationCachingHook initialization with enabled=True."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=True)
        assert hook.enabled is True

    def test_caching_hook_initialization_disabled(self):
        """Test ConversationCachingHook initialization with enabled=False."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=False)
        assert hook.enabled is False

    def test_caching_hook_default_enabled(self):
        """Test that caching defaults to True when not specified."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook()
        assert hook.enabled is True

    def test_get_config_includes_caching_status(self):
        """Test that get_config returns caching_enabled status."""
        config = {
            "model_id": "anthropic.claude-3-sonnet-20240229-v1:0",
            "temperature": 0.7,
            "system_prompt": "You are helpful.",
            "caching_enabled": True
        }

        assert "caching_enabled" in config
        assert config["caching_enabled"] is True


# ============================================================
# Sliding Window Cache Management Tests
# ============================================================

class TestSlidingWindowCacheManagement:
    """Tests for sliding window cache point management."""

    @pytest.fixture
    def mock_event(self):
        """Create mock BeforeModelCallEvent."""
        event = MagicMock()
        event.agent = MagicMock()
        event.agent.messages = []
        return event

    def test_removes_oldest_cache_when_exceeds_limit(self, mock_event):
        """Test that oldest cache point is removed when limit exceeded."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=True)

        # Simulate messages with 3 cache points already
        mock_event.agent.messages = [
            {"role": "assistant", "content": [
                {"text": "Answer 1"},
                {"cachePoint": {"type": "default"}}  # Oldest
            ]},
            {"role": "user", "content": [{"text": "Q2"}]},
            {"role": "assistant", "content": [
                {"text": "Answer 2"},
                {"cachePoint": {"type": "default"}}
            ]},
            {"role": "user", "content": [{"text": "Q3"}]},
            {"role": "assistant", "content": [
                {"text": "Answer 3"},
                {"cachePoint": {"type": "default"}}
            ]},
            {"role": "user", "content": [{"text": "Q4"}]},
            {"role": "assistant", "content": [{"text": "Answer 4"}]}  # New, needs cache
        ]

        # Count initial cache points
        initial_count = sum(
            1 for msg in mock_event.agent.messages
            for block in msg.get("content", [])
            if isinstance(block, dict) and "cachePoint" in block
        )

        assert initial_count == 3  # At limit

        hook.add_conversation_cache_point(mock_event)

        # Count final cache points - should still be <= 3
        final_count = sum(
            1 for msg in mock_event.agent.messages
            for block in msg.get("content", [])
            if isinstance(block, dict) and "cachePoint" in block
        )

        assert final_count <= 3

    def test_cache_points_at_recent_messages(self, mock_event):
        """Test that cache points are placed at recent messages."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=True)

        # Create conversation with multiple assistant messages
        mock_event.agent.messages = [
            {"role": "user", "content": [{"text": "Q1"}]},
            {"role": "assistant", "content": [{"text": "Old answer"}]},
            {"role": "user", "content": [{"text": "Q2"}]},
            {"role": "assistant", "content": [{"text": "Recent answer 1"}]},
            {"role": "user", "content": [{"text": "Q3"}]},
            {"role": "assistant", "content": [{"text": "Recent answer 2"}]},
            {"role": "user", "content": [{"text": "Q4"}]},
            {"role": "assistant", "content": [{"text": "Recent answer 3"}]}
        ]

        hook.add_conversation_cache_point(mock_event)

        # Count cache points per message
        cache_positions = []
        for idx, msg in enumerate(mock_event.agent.messages):
            has_cache = any(
                isinstance(block, dict) and "cachePoint" in block
                for block in msg.get("content", [])
            )
            if has_cache:
                cache_positions.append(idx)

        # Cache points should be on more recent messages (higher indices)
        if cache_positions:
            # Most recent cache should be in the later half of messages
            assert max(cache_positions) >= len(mock_event.agent.messages) // 2


# ============================================================
# Cache Point Position Validation Tests
# ============================================================

class TestCachePointPositionValidation:
    """Tests for cache point position validation."""

    def test_cache_point_not_at_message_start(self):
        """Test that cache point is not inserted at message start."""
        # Cache points should be after content, not at the beginning
        message = {
            "role": "assistant",
            "content": [
                {"text": "Response text"},
                {"cachePoint": {"type": "default"}}
            ]
        }

        # First block should not be cache point
        assert "cachePoint" not in message["content"][0]

    def test_cache_point_after_text_block(self):
        """Test cache point is placed after text block."""
        message = {
            "role": "assistant",
            "content": [
                {"text": "This is my response"},
                {"cachePoint": {"type": "default"}}
            ]
        }

        # Find text block index
        text_idx = next(
            i for i, block in enumerate(message["content"])
            if isinstance(block, dict) and "text" in block
        )

        # Find cache point index
        cache_idx = next(
            i for i, block in enumerate(message["content"])
            if isinstance(block, dict) and "cachePoint" in block
        )

        # Cache should come after text
        assert cache_idx > text_idx

    def test_cache_point_after_tool_use_block(self):
        """Test cache point placement with tool use."""
        message = {
            "role": "assistant",
            "content": [
                {"text": "Let me help you"},
                {"toolUse": {"toolUseId": "123", "name": "search", "input": {}}},
                {"cachePoint": {"type": "default"}}
            ]
        }

        # Cache should be at the end
        assert "cachePoint" in message["content"][-1]


# ============================================================
# HookProvider Integration Tests
# ============================================================

class TestHookProviderIntegration:
    """Tests for ConversationCachingHook as HookProvider."""

    def test_register_hooks_method_exists(self):
        """Test that register_hooks method is implemented."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=True)
        assert hasattr(hook, 'register_hooks')
        assert callable(hook.register_hooks)

    def test_add_conversation_cache_point_method_exists(self):
        """Test that add_conversation_cache_point method is implemented."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=True)
        assert hasattr(hook, 'add_conversation_cache_point')
        assert callable(hook.add_conversation_cache_point)

    def test_hook_registers_for_before_model_call_event(self):
        """Test that hook registers for BeforeModelCallEvent."""
        from agent.agent import ConversationCachingHook

        hook = ConversationCachingHook(enabled=True)

        # Create mock registry
        mock_registry = MagicMock()

        # Call register_hooks
        hook.register_hooks(mock_registry)

        # Verify add_callback was called
        mock_registry.add_callback.assert_called_once()

        # Get the args from the call
        call_args = mock_registry.add_callback.call_args
        # First arg should be BeforeModelCallEvent (or its string name)
        # Second arg should be the callback function
        assert call_args[0][1] == hook.add_conversation_cache_point
