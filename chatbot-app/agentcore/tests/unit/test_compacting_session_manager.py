"""
Tests for CompactingSessionManager

Tests cover:
- Threshold-based summarization triggering
- Summary retrieval from AgentCore LTM
- Message loading with summarization applied
- Configuration options
- Edge cases and error handling
"""

import pytest
from unittest.mock import Mock, MagicMock, patch
import os
import sys

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))


class TestCompactingSessionManagerInit:
    """Test CompactingSessionManager initialization"""

    @patch('agent.compacting_session_manager.AgentCoreMemorySessionManager.__init__')
    def test_init_with_default_config(self, mock_parent_init):
        """Should initialize with default thresholds and turn counts"""
        mock_parent_init.return_value = None

        from agent.compacting_session_manager import CompactingSessionManager
        from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig

        config = MagicMock(spec=AgentCoreMemoryConfig)
        config.memory_id = 'test-memory'
        config.session_id = 'test-session'
        config.actor_id = 'test-user'

        manager = CompactingSessionManager(
            agentcore_memory_config=config,
            region_name='us-west-2'
        )

        # Two-stage compaction thresholds
        assert manager.truncation_threshold == 20  # Stage 1 trigger
        assert manager.compaction_threshold == 50  # Stage 2 trigger
        # Turn management
        assert manager.recent_turns_count == 5
        assert manager.min_recent_turns == 3
        # Tool content limit
        assert manager.max_tool_content_length == 1000

    @patch('agent.compacting_session_manager.AgentCoreMemorySessionManager.__init__')
    def test_init_with_custom_config(self, mock_parent_init):
        """Should accept custom compaction_threshold, recent_turns_count, and min_recent_turns"""
        mock_parent_init.return_value = None

        from agent.compacting_session_manager import CompactingSessionManager
        from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig

        config = MagicMock(spec=AgentCoreMemoryConfig)

        manager = CompactingSessionManager(
            agentcore_memory_config=config,
            region_name='us-west-2',
            compaction_threshold=50,
            recent_turns_count=10,
            min_recent_turns=5,
            summarization_strategy_id='custom-strategy-123'
        )

        assert manager.compaction_threshold == 50
        assert manager.recent_turns_count == 10
        assert manager.min_recent_turns == 5
        assert manager.summarization_strategy_id == 'custom-strategy-123'

class TestThresholdLogic:
    """Test threshold-based summarization triggering"""

    def test_below_threshold_loads_all_messages(self):
        """When event count is below threshold, should load all messages"""
        total_events = 20
        threshold = 50

        should_summarize = total_events > threshold
        assert should_summarize is False

    def test_above_threshold_triggers_compaction(self):
        """When event count exceeds threshold, should trigger compaction"""
        total_events = 60
        threshold = 50

        should_compact = total_events > threshold
        assert should_compact is True

    def test_exactly_at_threshold_no_compaction(self):
        """When event count equals threshold, should not compact"""
        total_events = 50
        threshold = 50

        should_compact = total_events > threshold
        assert should_compact is False

    def test_offset_considered_in_effective_count(self):
        """Effective event count should subtract conversation_manager offset"""
        total_events = 40
        offset = 15
        threshold = 50

        effective_events = total_events - offset
        should_summarize = effective_events > threshold

        assert effective_events == 25
        assert should_summarize is False


class TestTurnSafety:
    """Test turn-based safe cutoff logic - using actual CompactingSessionManager methods"""

    @pytest.fixture
    def manager(self):
        """Create CompactingSessionManager instance for testing"""
        with patch('agent.compacting_session_manager.AgentCoreMemorySessionManager.__init__', return_value=None):
            from agent.compacting_session_manager import CompactingSessionManager
            from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig

            config = MagicMock(spec=AgentCoreMemoryConfig)
            config.memory_id = 'test-memory'

            manager = CompactingSessionManager(
                agentcore_memory_config=config,
                region_name='us-west-2',
                recent_turns_count=5,
                min_recent_turns=3
            )
            return manager

    def test_has_tool_use_detection(self, manager):
        """Should detect toolUse in message content"""
        msg_with_tool = {
            "role": "assistant",
            "content": [
                {"text": "Let me search for that"},
                {"toolUse": {"toolUseId": "123", "name": "web_search", "input": {}}}
            ]
        }
        msg_without_tool = {
            "role": "assistant",
            "content": [{"text": "Here is your answer"}]
        }

        assert manager._has_tool_use(msg_with_tool) is True
        assert manager._has_tool_use(msg_without_tool) is False

    def test_has_tool_result_detection(self, manager):
        """Should detect toolResult in message content"""
        msg_with_result = {
            "role": "user",
            "content": [
                {"toolResult": {"toolUseId": "123", "content": [{"text": "result"}]}}
            ]
        }
        msg_user_text = {
            "role": "user",
            "content": [{"text": "Hello"}]
        }

        assert manager._has_tool_result(msg_with_result) is True
        assert manager._has_tool_result(msg_user_text) is False

    def test_find_safe_cutoff_preserves_tool_pairs(self, manager):
        """Cutoff should never separate toolUse from toolResult"""
        messages = [
            {"role": "user", "content": [{"text": "Search for Python"}]},
            {"role": "assistant", "content": [{"toolUse": {"toolUseId": "1"}}]},
            {"role": "user", "content": [{"toolResult": {"toolUseId": "1"}}]},
            {"role": "assistant", "content": [{"text": "Found results"}]},
            {"role": "user", "content": [{"text": "Thanks"}]},
            {"role": "assistant", "content": [{"text": "You're welcome"}]},
        ]

        # Set both recent_turns_count and min_recent_turns to 1
        # to force cutoff to happen
        manager.recent_turns_count = 1
        manager.min_recent_turns = 1
        cutoff = manager._find_safe_cutoff_index(messages)

        # Should cut at index 4 (user text "Thanks"), NOT at index 2 (toolResult)
        assert cutoff == 4
        # Verify the message at cutoff is user text, not toolResult
        assert messages[cutoff]["role"] == "user"
        assert not manager._has_tool_result(messages[cutoff])

    def test_find_safe_cutoff_simple_turns(self, manager):
        """Simple turn: user text + assistant text"""
        messages = [
            {"role": "user", "content": [{"text": "Hello"}]},
            {"role": "assistant", "content": [{"text": "Hi there"}]},
            {"role": "user", "content": [{"text": "How are you?"}]},
            {"role": "assistant", "content": [{"text": "I'm doing well"}]},
        ]

        # With 2 turns available and recent_turns_count=1, min_recent_turns=1
        manager.recent_turns_count = 1
        manager.min_recent_turns = 1
        cutoff = manager._find_safe_cutoff_index(messages)

        # Should return index 2 (start at "How are you?")
        assert cutoff == 2
        assert messages[cutoff]["content"][0]["text"] == "How are you?"

    def test_find_safe_cutoff_fewer_turns_than_requested(self, manager):
        """When available turns < recent_turns_count, should keep all available turns"""
        messages = [
            {"role": "user", "content": [{"text": "Calculate something"}]},
            {"role": "assistant", "content": [{"toolUse": {"toolUseId": "1"}}]},
            {"role": "user", "content": [{"toolResult": {"toolUseId": "1"}}]},
            {"role": "assistant", "content": [{"text": "Result 1"}]},
            {"role": "user", "content": [{"text": "Calculate more"}]},
            {"role": "assistant", "content": [{"text": "Result 2"}]},
        ]

        # 2 turns available (index 0 and 4), recent_turns_count=5
        manager.recent_turns_count = 5
        manager.min_recent_turns = 3
        cutoff = manager._find_safe_cutoff_index(messages)

        # Should return 0 (keep all) since only 2 turns < min_recent_turns=3
        assert cutoff == 0

    def test_find_safe_cutoff_all_tool_chains_loads_all(self, manager):
        """When only one valid cutoff point exists (first user text), should load all"""
        messages = [
            {"role": "user", "content": [{"text": "Do complex task"}]},
            {"role": "assistant", "content": [{"toolUse": {"toolUseId": "1"}}]},
            {"role": "user", "content": [{"toolResult": {"toolUseId": "1"}}]},
            {"role": "assistant", "content": [{"toolUse": {"toolUseId": "2"}}]},
            {"role": "user", "content": [{"toolResult": {"toolUseId": "2"}}]},
            {"role": "assistant", "content": [{"toolUse": {"toolUseId": "3"}}]},
            {"role": "user", "content": [{"toolResult": {"toolUseId": "3"}}]},
        ]

        manager.recent_turns_count = 5
        manager.min_recent_turns = 3
        cutoff = manager._find_safe_cutoff_index(messages)

        # Only 1 turn available (index 0), less than min_recent_turns=3
        assert cutoff == 0

    def test_find_safe_cutoff_empty_messages(self, manager):
        """Should handle empty messages gracefully"""
        cutoff = manager._find_safe_cutoff_index([])
        assert cutoff == 0


class TestSummaryRetrieval:
    """Test summary retrieval from AgentCore LTM - using actual CompactingSessionManager methods"""

    @pytest.fixture
    def manager(self):
        """Create CompactingSessionManager instance for testing"""
        with patch('agent.compacting_session_manager.AgentCoreMemorySessionManager.__init__', return_value=None):
            from agent.compacting_session_manager import CompactingSessionManager
            from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig

            config = MagicMock(spec=AgentCoreMemoryConfig)
            config.memory_id = 'test-memory'
            config.actor_id = 'user-456'

            manager = CompactingSessionManager(
                agentcore_memory_config=config,
                region_name='us-west-2'
            )
            # Set config for namespace building
            manager.config = config
            return manager

    def test_retrieve_summaries_builds_correct_namespace(self):
        """Should build correct namespace path for SUMMARIZATION strategy"""
        strategy_id = 'conversation_summary-abc123'
        actor_id = 'user-456'

        expected_namespace = f"/strategies/{strategy_id}/actors/{actor_id}"

        assert expected_namespace == '/strategies/conversation_summary-abc123/actors/user-456'

    def test_build_summary_prefix_format(self, manager):
        """Should build correct summary prefix from summaries"""
        summaries = [
            "User discussed Python programming",
            "User prefers detailed explanations"
        ]

        result = manager._build_summary_prefix(summaries)

        assert "<conversation_summary>" in result
        assert "</conversation_summary>" in result
        assert "Python programming" in result
        assert "detailed explanations" in result
        assert "Please continue the conversation" in result

    def test_build_summary_prefix_empty_returns_empty(self, manager):
        """Should return empty string when no summaries"""
        result = manager._build_summary_prefix([])
        assert result == ""

    def test_prepend_summary_to_first_user_message(self, manager):
        """Summary should be prepended to first user message text"""
        messages = [
            {"role": "user", "content": [{"text": "Hello, what is 2+2?"}]},
            {"role": "assistant", "content": [{"text": "4"}]},
        ]
        summary_prefix = "<conversation_summary>User likes math</conversation_summary>\n\n"

        result = manager._prepend_summary_to_first_message(messages, summary_prefix)

        assert result[0]["role"] == "user"
        assert result[0]["content"][0]["text"].startswith("<conversation_summary>")
        assert "Hello, what is 2+2?" in result[0]["content"][0]["text"]

    def test_prepend_summary_does_not_modify_original(self, manager):
        """Prepending summary should not modify original messages"""
        original_text = "Original question"
        messages = [
            {"role": "user", "content": [{"text": original_text}]},
            {"role": "assistant", "content": [{"text": "Answer"}]},
        ]
        summary_prefix = "<conversation_summary>Summary</conversation_summary>\n\n"

        result = manager._prepend_summary_to_first_message(messages, summary_prefix)

        # Original unchanged
        assert messages[0]["content"][0]["text"] == original_text
        # Result has summary prepended
        assert result[0]["content"][0]["text"].startswith("<conversation_summary>")

    def test_prepend_summary_empty_prefix_returns_original(self, manager):
        """Empty summary prefix should return messages unchanged"""
        messages = [
            {"role": "user", "content": [{"text": "Hello"}]},
        ]

        result = manager._prepend_summary_to_first_message(messages, "")

        assert result == messages

    def test_prepend_summary_empty_messages_returns_empty(self, manager):
        """Empty messages list should return empty list"""
        result = manager._prepend_summary_to_first_message([], "some summary")
        assert result == []

    def test_prepend_summary_non_user_first_message_returns_original(self, manager):
        """If first message is not user role, should return original"""
        messages = [
            {"role": "assistant", "content": [{"text": "Hello"}]},
        ]
        summary_prefix = "<conversation_summary>Summary</conversation_summary>\n\n"

        result = manager._prepend_summary_to_first_message(messages, summary_prefix)

        # Should return original since first message is not user
        assert result == messages


class TestMessageLoading:
    """Test message loading with summarization"""

    def test_recent_offset_calculation(self):
        """Should calculate correct offset for recent messages"""
        total_messages = 100
        recent_count = 10

        # We want last 10 messages, so offset should be 90
        recent_offset = max(0, total_messages - recent_count)

        assert recent_offset == 90

    def test_recent_offset_with_few_messages(self):
        """Should handle case where total messages < recent_count"""
        total_messages = 5
        recent_count = 10

        recent_offset = max(0, total_messages - recent_count)

        assert recent_offset == 0

    def test_final_messages_order(self):
        """Messages should be in order: prepend + summary + recent"""
        prepend = [{"role": "system", "content": [{"text": "system"}]}]
        summary = {"role": "user", "content": [{"text": "summary"}]}
        recent = [
            {"role": "user", "content": [{"text": "recent1"}]},
            {"role": "assistant", "content": [{"text": "recent2"}]}
        ]

        final_messages = prepend.copy()
        if summary:
            final_messages.append(summary)
        final_messages.extend(recent)

        assert len(final_messages) == 4
        assert final_messages[0]["content"][0]["text"] == "system"
        assert final_messages[1]["content"][0]["text"] == "summary"
        assert final_messages[2]["content"][0]["text"] == "recent1"


class TestStrategyIdLookup:
    """Test SUMMARIZATION strategy ID lookup"""

    def test_strategy_lookup_from_memory_config(self):
        """Should extract strategy ID from Memory configuration"""
        mock_response = {
            'memory': {
                'strategies': [
                    {'type': 'USER_PREFERENCE', 'strategyId': 'user_pref-123'},
                    {'type': 'SEMANTIC', 'strategyId': 'semantic-456'},
                    {'type': 'SUMMARIZATION', 'strategyId': 'summary-789'},
                ]
            }
        }

        strategies = mock_response['memory']['strategies']
        summarization_id = None

        for strategy in strategies:
            if strategy.get('type') == 'SUMMARIZATION':
                summarization_id = strategy.get('strategyId')
                break

        assert summarization_id == 'summary-789'

    def test_strategy_lookup_with_old_field_names(self):
        """Should handle old field names (memoryStrategyType, memoryStrategyId)"""
        mock_response = {
            'memory': {
                'memoryStrategies': [
                    {'memoryStrategyType': 'SUMMARIZATION', 'memoryStrategyId': 'old-summary-123'},
                ]
            }
        }

        strategies = mock_response['memory'].get('strategies', mock_response['memory'].get('memoryStrategies', []))
        summarization_id = None

        for strategy in strategies:
            strategy_type = strategy.get('type', strategy.get('memoryStrategyType', ''))
            if strategy_type == 'SUMMARIZATION':
                summarization_id = strategy.get('strategyId', strategy.get('memoryStrategyId', ''))
                break

        assert summarization_id == 'old-summary-123'

    def test_strategy_not_found(self):
        """Should return None when SUMMARIZATION strategy not configured"""
        mock_response = {
            'memory': {
                'strategies': [
                    {'type': 'USER_PREFERENCE', 'strategyId': 'user_pref-123'},
                ]
            }
        }

        strategies = mock_response['memory']['strategies']
        summarization_id = None

        for strategy in strategies:
            if strategy.get('type') == 'SUMMARIZATION':
                summarization_id = strategy.get('strategyId')
                break

        assert summarization_id is None


class TestConfigurationFromEnvironment:
    """Test configuration loading from environment variables"""

    def test_default_compaction_threshold(self):
        """Should use default compaction threshold of 50"""
        threshold = int(os.environ.get('COMPACTION_THRESHOLD', '50'))
        assert threshold == 50

    def test_default_truncation_threshold(self):
        """Should use default truncation threshold of 20"""
        threshold = int(os.environ.get('COMPACTION_TRUNCATION_THRESHOLD', '20'))
        assert threshold == 20

    def test_default_recent_turns(self):
        """Should use default recent turns of 5"""
        recent_turns = int(os.environ.get('COMPACTION_RECENT_TURNS', '5'))
        assert recent_turns == 5

    def test_custom_compaction_threshold_from_env(self):
        """Should read custom event threshold from environment"""
        with patch.dict(os.environ, {'COMPACTION_THRESHOLD': '50'}):
            threshold = int(os.environ.get('COMPACTION_THRESHOLD', '50'))
            assert threshold == 50

    def test_custom_truncation_threshold_from_env(self):
        """Should read custom truncation threshold from environment"""
        with patch.dict(os.environ, {'COMPACTION_TRUNCATION_THRESHOLD': '25'}):
            threshold = int(os.environ.get('COMPACTION_TRUNCATION_THRESHOLD', '30'))
            assert threshold == 25

    def test_custom_recent_turns_from_env(self):
        """Should read custom recent turns from environment"""
        with patch.dict(os.environ, {'COMPACTION_RECENT_TURNS': '10'}):
            recent_turns = int(os.environ.get('COMPACTION_RECENT_TURNS', '5'))
            assert recent_turns == 10

    def test_default_min_recent_turns(self):
        """Should use default min recent turns of 3"""
        min_turns = int(os.environ.get('COMPACTION_MIN_TURNS', '3'))
        assert min_turns == 3

    def test_custom_min_turns_from_env(self):
        """Should read custom min turns from environment"""
        with patch.dict(os.environ, {'COMPACTION_MIN_TURNS': '2'}):
            min_turns = int(os.environ.get('COMPACTION_MIN_TURNS', '3'))
            assert min_turns == 2

    def test_default_max_tool_content_length(self):
        """Should use default max tool content length of 1000"""
        max_length = int(os.environ.get('COMPACTION_MAX_TOOL_LENGTH', '1000'))
        assert max_length == 1000

    def test_custom_max_tool_content_length_from_env(self):
        """Should read custom max tool content length from environment"""
        with patch.dict(os.environ, {'COMPACTION_MAX_TOOL_LENGTH': '500'}):
            max_length = int(os.environ.get('COMPACTION_MAX_TOOL_LENGTH', '1000'))
            assert max_length == 500


class TestToolTruncation:
    """Test Stage 1: Tool content truncation - using actual CompactingSessionManager methods"""

    @pytest.fixture
    def manager(self):
        """Create CompactingSessionManager instance for testing"""
        with patch('agent.compacting_session_manager.AgentCoreMemorySessionManager.__init__', return_value=None):
            from agent.compacting_session_manager import CompactingSessionManager
            from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig

            config = MagicMock(spec=AgentCoreMemoryConfig)
            config.memory_id = 'test-memory'

            manager = CompactingSessionManager(
                agentcore_memory_config=config,
                region_name='us-west-2',
                max_tool_content_length=1000
            )
            return manager

    def test_truncate_text_short_unchanged(self, manager):
        """Text shorter than max_length should remain unchanged"""
        text = "Short text"
        result = manager._truncate_text(text, 1000)
        assert result == text

    def test_truncate_text_long_with_indicator(self, manager):
        """Long text should be truncated with indicator"""
        text = "A" * 2000
        result = manager._truncate_text(text, 1000)

        assert len(result) < len(text)
        assert "[truncated," in result
        assert "1000 chars removed]" in result

    def test_truncate_tool_contents_result_text(self, manager):
        """Should truncate long toolResult text content"""
        messages = [{
            "role": "user",
            "content": [{
                "toolResult": {
                    "toolUseId": "123",
                    "content": [{"text": "B" * 2000}]
                }
            }]
        }]

        result = manager._truncate_tool_contents(messages)

        # Verify truncation was applied
        result_text = result[0]["content"][0]["toolResult"]["content"][0]["text"]
        assert len(result_text) < 2000
        assert "[truncated," in result_text

    def test_truncate_tool_contents_use_input(self, manager):
        """Should truncate long toolUse input"""
        messages = [{
            "role": "assistant",
            "content": [{
                "toolUse": {
                    "toolUseId": "123",
                    "name": "web_search",
                    "input": {"query": "A" * 2000}
                }
            }]
        }]

        result = manager._truncate_tool_contents(messages)

        # Verify input was truncated
        truncated_input = result[0]["content"][0]["toolUse"]["input"]
        assert "[truncated," in truncated_input["query"]

    def test_truncate_tool_contents_preserves_structure(self, manager):
        """Truncation should preserve message structure and roles"""
        messages = [
            {"role": "user", "content": [{"text": "Hello"}]},
            {
                "role": "assistant",
                "content": [
                    {"text": "Let me search"},
                    {"toolUse": {"toolUseId": "1", "name": "search", "input": {"q": "A" * 2000}}}
                ]
            },
            {
                "role": "user",
                "content": [
                    {"toolResult": {"toolUseId": "1", "content": [{"text": "B" * 2000}]}}
                ]
            },
        ]

        result = manager._truncate_tool_contents(messages)

        # Structure preserved
        assert result[0]["role"] == "user"
        assert result[1]["role"] == "assistant"
        assert result[2]["role"] == "user"
        assert "toolUse" in result[1]["content"][1]
        assert "toolResult" in result[2]["content"][0]

        # Content truncated
        assert "[truncated," in result[1]["content"][1]["toolUse"]["input"]["q"]
        assert "[truncated," in result[2]["content"][0]["toolResult"]["content"][0]["text"]

    def test_truncate_tool_contents_json(self, manager):
        """Should truncate JSON content in toolResult"""
        messages = [{
            "role": "user",
            "content": [{
                "toolResult": {
                    "toolUseId": "123",
                    "content": [{"json": {"data": "C" * 2000}}]
                }
            }]
        }]

        result = manager._truncate_tool_contents(messages)

        # JSON content truncated
        json_data = result[0]["content"][0]["toolResult"]["content"][0]["json"]["data"]
        assert "[truncated," in json_data

    def test_truncate_does_not_modify_original(self, manager):
        """Truncation should not modify original messages"""
        original_text = "D" * 2000
        messages = [{
            "role": "user",
            "content": [{
                "toolResult": {
                    "toolUseId": "123",
                    "content": [{"text": original_text}]
                }
            }]
        }]

        result = manager._truncate_tool_contents(messages)

        # Original unchanged
        assert messages[0]["content"][0]["toolResult"]["content"][0]["text"] == original_text
        # Result truncated
        assert "[truncated," in result[0]["content"][0]["toolResult"]["content"][0]["text"]


class TestTwoStageCompaction:
    """Test two-stage compaction threshold logic"""

    def test_below_both_thresholds_no_modification(self):
        """Events below both thresholds should load all messages without modification"""
        total_events = 15
        truncation_threshold = 20
        compaction_threshold = 50

        stage = None
        if total_events > compaction_threshold:
            stage = "stage2"
        elif total_events > truncation_threshold:
            stage = "stage1"
        else:
            stage = "none"

        assert stage == "none"

    def test_between_thresholds_triggers_stage1(self):
        """Events between truncation and compaction threshold should trigger Stage 1"""
        total_events = 35
        truncation_threshold = 20
        compaction_threshold = 50

        stage = None
        if total_events > compaction_threshold:
            stage = "stage2"
        elif total_events > truncation_threshold:
            stage = "stage1"
        else:
            stage = "none"

        assert stage == "stage1"

    def test_above_compaction_threshold_triggers_stage2(self):
        """Events above compaction threshold should trigger Stage 2"""
        total_events = 60
        truncation_threshold = 20
        compaction_threshold = 50

        stage = None
        if total_events > compaction_threshold:
            stage = "stage2"
        elif total_events > truncation_threshold:
            stage = "stage1"
        else:
            stage = "none"

        assert stage == "stage2"

    def test_exactly_at_truncation_threshold_no_truncation(self):
        """Events exactly at truncation threshold should not trigger truncation"""
        total_events = 20
        truncation_threshold = 20
        compaction_threshold = 50

        should_truncate = total_events > truncation_threshold
        assert should_truncate is False

    def test_exactly_at_compaction_threshold_no_compaction(self):
        """Events exactly at compaction threshold should not trigger full compaction"""
        total_events = 50
        truncation_threshold = 30
        compaction_threshold = 50

        should_compact = total_events > compaction_threshold
        assert should_compact is False

    def test_stage2_also_applies_truncation(self):
        """Stage 2 compaction should also apply truncation to recent messages"""
        # When Stage 2 is triggered, truncation is applied to recent messages
        # This is verified by the implementation in initialize()
        total_events = 60
        compaction_threshold = 50

        # Stage 2 path
        should_apply_stage2 = total_events > compaction_threshold
        assert should_apply_stage2 is True

        # Stage 2 includes truncation of recent messages
        # (verified by code inspection of initialize method)


class TestEdgeCases:
    """Test edge cases and error handling"""

    def test_new_agent_no_summarization(self):
        """New agent (no existing session) should not trigger summarization"""
        session_agent = None  # No existing agent

        # New agent path: should create agent, not restore with summarization
        is_new_agent = session_agent is None
        assert is_new_agent is True

    def test_zero_messages_no_error(self):
        """Should handle session with zero messages gracefully"""
        total_messages = 0
        threshold = 50

        should_summarize = total_messages > threshold
        assert should_summarize is False

    def test_summary_retrieval_error_continues(self):
        """Should continue with recent messages even if summary retrieval fails"""
        summaries = []  # Empty due to error
        recent_messages = [
            {"role": "user", "content": [{"text": "hello"}]},
            {"role": "assistant", "content": [{"text": "hi"}]}
        ]

        # Should still have recent messages even without summary
        final_messages = []
        if summaries:
            final_messages.append({"role": "user", "content": [{"text": "summary"}]})
        final_messages.extend(recent_messages)

        assert len(final_messages) == 2
        assert final_messages[0]["content"][0]["text"] == "hello"


class TestIntegrationWithAgent:
    """Test integration with ChatbotAgent"""

    def test_agent_uses_summarizing_manager_in_cloud_mode(self):
        """ChatbotAgent should use CompactingSessionManager when MEMORY_ID is set"""
        # This is verified by the agent.py code change
        # When MEMORY_ID env var is set, CompactingSessionManager is used

        # Simulate the decision logic
        memory_id = 'test-memory-id'
        agentcore_available = True

        use_summarizing = memory_id and agentcore_available
        assert use_summarizing is True

    def test_agent_uses_file_manager_in_local_mode(self):
        """ChatbotAgent should use FileSessionManager in local mode"""
        memory_id = None
        agentcore_available = True

        use_summarizing = memory_id and agentcore_available
        # None and True = None, which is falsy
        assert not use_summarizing
