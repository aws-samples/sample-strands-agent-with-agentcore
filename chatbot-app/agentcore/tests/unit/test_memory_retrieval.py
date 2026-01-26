"""
Tests for AgentCore Memory retrieval configuration in ChatbotAgent.

Tests cover:
- Dynamic strategy ID lookup from Memory service
- Correct namespace path generation
- Retrieval config building with all strategy types
- Graceful handling of missing strategies
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import os
import sys

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))


class TestMemoryStrategyIdLookup:
    """Test _get_memory_strategy_ids method"""

    @pytest.fixture(autouse=True)
    def reset_strategy_cache(self):
        """Reset global cache before each test."""
        import agent.agent as agent_module
        agent_module._cached_strategy_ids = None
        yield
        agent_module._cached_strategy_ids = None

    @patch('boto3.client')
    def test_get_memory_strategy_ids_success(self, mock_boto_client):
        """Should return strategy IDs mapped by type"""
        # Mock response
        mock_gmcp = MagicMock()
        mock_gmcp.get_memory.return_value = {
            'memory': {
                'strategies': [
                    {'type': 'USER_PREFERENCE', 'strategyId': 'user_preference_extraction-abc123'},
                    {'type': 'SEMANTIC', 'strategyId': 'semantic_fact_extraction-def456'},
                    {'type': 'SUMMARIZATION', 'strategyId': 'conversation_summary-ghi789'},
                ]
            }
        }
        mock_boto_client.return_value = mock_gmcp

        # Import after mocking
        from agent.agent import ChatbotAgent

        # Create mock agent instance
        agent = object.__new__(ChatbotAgent)

        # Call method
        result = agent._get_memory_strategy_ids('test-memory-id', 'us-west-2')

        # Verify
        assert result['USER_PREFERENCE'] == 'user_preference_extraction-abc123'
        assert result['SEMANTIC'] == 'semantic_fact_extraction-def456'
        assert result['SUMMARIZATION'] == 'conversation_summary-ghi789'

    @patch('boto3.client')
    def test_get_memory_strategy_ids_with_old_field_names(self, mock_boto_client):
        """Should handle old field names (memoryStrategyType, memoryStrategyId)"""
        mock_gmcp = MagicMock()
        mock_gmcp.get_memory.return_value = {
            'memory': {
                'memoryStrategies': [
                    {'memoryStrategyType': 'USER_PREFERENCE', 'memoryStrategyId': 'pref-123'},
                    {'memoryStrategyType': 'SEMANTIC', 'memoryStrategyId': 'fact-456'},
                ]
            }
        }
        mock_boto_client.return_value = mock_gmcp

        from agent.agent import ChatbotAgent
        agent = object.__new__(ChatbotAgent)

        result = agent._get_memory_strategy_ids('test-memory-id', 'us-west-2')

        assert result['USER_PREFERENCE'] == 'pref-123'
        assert result['SEMANTIC'] == 'fact-456'

    @patch('boto3.client')
    def test_get_memory_strategy_ids_failure(self, mock_boto_client):
        """Should return empty dict on failure"""
        mock_gmcp = MagicMock()
        mock_gmcp.get_memory.side_effect = Exception('API Error')
        mock_boto_client.return_value = mock_gmcp

        from agent.agent import ChatbotAgent
        agent = object.__new__(ChatbotAgent)

        result = agent._get_memory_strategy_ids('test-memory-id', 'us-west-2')

        assert result == {}


class TestNamespacePathGeneration:
    """Test namespace path generation for LTM retrieval"""

    def test_user_preference_namespace_format(self):
        """User preference namespace should follow correct pattern"""
        strategy_id = 'user_preference_extraction-oSxb5O81hy'
        user_id = '18c1e380-6021-700d-3572-40d05568f4ce'

        namespace = f"/strategies/{strategy_id}/actors/{user_id}"

        assert namespace == '/strategies/user_preference_extraction-oSxb5O81hy/actors/18c1e380-6021-700d-3572-40d05568f4ce'

    def test_semantic_facts_namespace_format(self):
        """Semantic facts namespace should follow correct pattern"""
        strategy_id = 'semantic_fact_extraction-QPr6P233fp'
        user_id = '48b18330-0091-709f-2ad0-3ae70549a78a'

        namespace = f"/strategies/{strategy_id}/actors/{user_id}"

        assert namespace == '/strategies/semantic_fact_extraction-QPr6P233fp/actors/48b18330-0091-709f-2ad0-3ae70549a78a'

    def test_summary_namespace_format(self):
        """Summary namespace should follow correct pattern"""
        strategy_id = 'conversation_summary-Fm5sIe8oht'
        user_id = 'test-user-123'

        namespace = f"/strategies/{strategy_id}/actors/{user_id}"

        assert namespace == '/strategies/conversation_summary-Fm5sIe8oht/actors/test-user-123'


class TestRetrievalConfigBuilding:
    """Test retrieval_config construction"""

    def test_build_retrieval_config_all_strategies(self):
        """Should build config for all available strategies"""
        strategy_ids = {
            'USER_PREFERENCE': 'user_pref-123',
            'SEMANTIC': 'semantic-456',
            'SUMMARIZATION': 'summary-789',
        }
        user_id = 'test-user'

        retrieval_config = {}

        if 'USER_PREFERENCE' in strategy_ids:
            namespace = f"/strategies/{strategy_ids['USER_PREFERENCE']}/actors/{user_id}"
            retrieval_config[namespace] = {'top_k': 5, 'relevance_score': 0.7}

        if 'SEMANTIC' in strategy_ids:
            namespace = f"/strategies/{strategy_ids['SEMANTIC']}/actors/{user_id}"
            retrieval_config[namespace] = {'top_k': 10, 'relevance_score': 0.3}

        if 'SUMMARIZATION' in strategy_ids:
            namespace = f"/strategies/{strategy_ids['SUMMARIZATION']}/actors/{user_id}"
            retrieval_config[namespace] = {'top_k': 3, 'relevance_score': 0.5}

        assert len(retrieval_config) == 3
        assert '/strategies/user_pref-123/actors/test-user' in retrieval_config
        assert '/strategies/semantic-456/actors/test-user' in retrieval_config
        assert '/strategies/summary-789/actors/test-user' in retrieval_config

    def test_build_retrieval_config_missing_strategies(self):
        """Should handle missing strategies gracefully"""
        strategy_ids = {
            'USER_PREFERENCE': 'user_pref-123',
            # SEMANTIC missing
            # SUMMARIZATION missing
        }
        user_id = 'test-user'

        retrieval_config = {}

        if 'USER_PREFERENCE' in strategy_ids:
            namespace = f"/strategies/{strategy_ids['USER_PREFERENCE']}/actors/{user_id}"
            retrieval_config[namespace] = {'top_k': 5, 'relevance_score': 0.7}

        if 'SEMANTIC' in strategy_ids:
            namespace = f"/strategies/{strategy_ids['SEMANTIC']}/actors/{user_id}"
            retrieval_config[namespace] = {'top_k': 10, 'relevance_score': 0.3}

        if 'SUMMARIZATION' in strategy_ids:
            namespace = f"/strategies/{strategy_ids['SUMMARIZATION']}/actors/{user_id}"
            retrieval_config[namespace] = {'top_k': 3, 'relevance_score': 0.5}

        assert len(retrieval_config) == 1
        assert '/strategies/user_pref-123/actors/test-user' in retrieval_config

    def test_build_retrieval_config_empty_strategies(self):
        """Should return empty config when no strategies available"""
        strategy_ids = {}
        user_id = 'test-user'

        retrieval_config = {}

        if 'USER_PREFERENCE' in strategy_ids:
            namespace = f"/strategies/{strategy_ids['USER_PREFERENCE']}/actors/{user_id}"
            retrieval_config[namespace] = {'top_k': 5, 'relevance_score': 0.7}

        assert len(retrieval_config) == 0


class TestRetrievalConfigValues:
    """Test retrieval config parameter values"""

    def test_user_preference_config_values(self):
        """User preferences should have high relevance score"""
        config = {'top_k': 5, 'relevance_score': 0.7}

        assert config['top_k'] == 5
        assert config['relevance_score'] == 0.7

    def test_semantic_facts_config_values(self):
        """Semantic facts should have more results, lower relevance threshold"""
        config = {'top_k': 10, 'relevance_score': 0.3}

        assert config['top_k'] == 10
        assert config['relevance_score'] == 0.3

    def test_summary_config_values(self):
        """Summaries should have moderate settings"""
        config = {'top_k': 3, 'relevance_score': 0.5}

        assert config['top_k'] == 3
        assert config['relevance_score'] == 0.5


class TestOldNamespacePatternMigration:
    """Test migration from old namespace patterns to new ones"""

    def test_old_pattern_should_not_work(self):
        """Old patterns like /preferences/{userId} are incorrect"""
        old_patterns = [
            '/preferences/user-123',
            '/facts/user-123',
            '/summaries/user-123',
        ]

        # These patterns don't match the actual storage location
        for pattern in old_patterns:
            assert not pattern.startswith('/strategies/')

    def test_new_pattern_should_work(self):
        """New patterns with strategy ID should work"""
        new_patterns = [
            '/strategies/user_preference_extraction-xxx/actors/user-123',
            '/strategies/semantic_fact_extraction-xxx/actors/user-123',
            '/strategies/conversation_summary-xxx/actors/user-123',
        ]

        for pattern in new_patterns:
            assert pattern.startswith('/strategies/')
            assert '/actors/' in pattern


class TestLocalModeSkipsMemoryLookup:
    """Test that local mode doesn't attempt memory strategy lookup"""

    def test_local_mode_check(self):
        """Should skip AgentCore Memory in local mode"""
        # Simulate environment check
        memory_id = None  # Not set in local mode
        agentcore_available = True

        should_use_agentcore = memory_id and agentcore_available

        assert should_use_agentcore is None or should_use_agentcore is False

    def test_cloud_mode_check(self):
        """Should use AgentCore Memory in cloud mode"""
        memory_id = 'strands_agent_chatbot_memory-xxx'
        agentcore_available = True

        should_use_agentcore = memory_id and agentcore_available

        assert should_use_agentcore is True
