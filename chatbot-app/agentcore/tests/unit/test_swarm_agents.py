"""
Tests for Swarm Agent Creation

Tests cover:
- Tool assignment per agent (get_tools_for_agent)
- Agent configuration validation (models, temperatures)
- Responder handoff removal
- Swarm configuration parameters
"""

import pytest
from unittest.mock import Mock, MagicMock, patch
import os
import sys

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))


class TestGetToolsForAgent:
    """Test get_tools_for_agent function - tool assignment per agent."""

    def test_coordinator_has_no_tools(self):
        """Coordinator should have no tools (routing only)."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING

        assert AGENT_TOOL_MAPPING.get("coordinator") == []

    def test_web_researcher_has_search_tools(self):
        """Web researcher should have web search and URL tools."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING

        tools = AGENT_TOOL_MAPPING.get("web_researcher", [])

        assert "ddg_web_search" in tools
        assert "fetch_url_content" in tools
        assert "gateway_wikipedia_search" in tools

    def test_data_analyst_has_diagram_and_calculator(self):
        """Data analyst should have diagram and calculator tools."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING

        tools = AGENT_TOOL_MAPPING.get("data_analyst", [])

        assert "generate_diagram_and_validate" in tools
        assert "calculator" in tools
        assert len(tools) == 2  # Only these two tools

    def test_responder_has_visualization_only(self):
        """Responder should only have visualization tool."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING

        tools = AGENT_TOOL_MAPPING.get("responder", [])

        assert "create_visualization" in tools
        assert len(tools) == 1  # Only visualization

    def test_browser_agent_has_browser_tools(self):
        """Browser agent should have all browser automation tools."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING

        tools = AGENT_TOOL_MAPPING.get("browser_agent", [])

        expected_tools = [
            "browser_navigate",
            "browser_act",
            "browser_extract",
            "browser_get_page_info",
            "browser_manage_tabs",
            "browser_drag",
            "browser_save_screenshot",
        ]

        for tool in expected_tools:
            assert tool in tools

    def test_all_agents_have_tool_mappings(self):
        """All defined agents should have tool mappings."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING, AGENT_DESCRIPTIONS

        for agent_name in AGENT_DESCRIPTIONS.keys():
            assert agent_name in AGENT_TOOL_MAPPING, f"Missing tool mapping for {agent_name}"


class TestAgentToolMappingConsistency:
    """Test AGENT_TOOL_MAPPING and AGENT_DESCRIPTIONS consistency."""

    def test_all_mappings_have_descriptions(self):
        """All agents with tool mappings should have descriptions."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING, AGENT_DESCRIPTIONS

        for agent_name in AGENT_TOOL_MAPPING.keys():
            assert agent_name in AGENT_DESCRIPTIONS, f"Missing description for {agent_name}"

    def test_all_descriptions_have_mappings(self):
        """All agents with descriptions should have tool mappings."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING, AGENT_DESCRIPTIONS

        for agent_name in AGENT_DESCRIPTIONS.keys():
            assert agent_name in AGENT_TOOL_MAPPING, f"Missing tool mapping for {agent_name}"

    def test_twelve_agents_defined(self):
        """Should have exactly 12 agents defined."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING

        assert len(AGENT_TOOL_MAPPING) == 12

    def test_no_duplicate_tools_across_agents(self):
        """Each tool should be assigned to exactly one agent (except gateway tools)."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING

        tool_assignments = {}

        for agent_name, tools in AGENT_TOOL_MAPPING.items():
            for tool in tools:
                # Skip gateway tools (can be shared)
                if tool.startswith("gateway_"):
                    continue

                if tool in tool_assignments:
                    # Same tool in multiple agents
                    pytest.fail(
                        f"Tool '{tool}' assigned to both '{tool_assignments[tool]}' and '{agent_name}'"
                    )
                tool_assignments[tool] = agent_name


class TestBuildAgentSystemPrompt:
    """Test build_agent_system_prompt function."""

    def test_responder_has_no_handoff_guidelines(self):
        """Responder should not have common handoff guidelines."""
        from agent.config.swarm_config import build_agent_system_prompt, COMMON_GUIDELINES

        prompt = build_agent_system_prompt("responder")

        assert "handoff_to_agent" not in prompt
        assert COMMON_GUIDELINES not in prompt

    def test_non_responder_has_handoff_guidelines(self):
        """Non-responder agents should have common handoff guidelines."""
        from agent.config.swarm_config import build_agent_system_prompt, COMMON_GUIDELINES

        for agent_name in ["coordinator", "web_researcher", "data_analyst"]:
            prompt = build_agent_system_prompt(agent_name)
            assert "handoff_to_agent" in prompt or "handoff" in prompt.lower()

    def test_specialist_prompts_included(self):
        """Agent prompts should include specialist instructions."""
        from agent.config.swarm_config import build_agent_system_prompt

        web_prompt = build_agent_system_prompt("web_researcher")
        assert "citations" in web_prompt.lower()

        data_prompt = build_agent_system_prompt("data_analyst")
        assert "diagram" in data_prompt.lower() or "png" in data_prompt.lower()


class TestCreateSwarmAgents:
    """Test create_swarm_agents function."""

    @patch('agent.swarm_agents.filter_tools')
    @patch('agent.swarm_agents.BedrockModel')
    @patch('agent.swarm_agents.Agent')
    def test_creates_twelve_agents(self, mock_agent, mock_model, mock_filter):
        """Should create exactly 12 agents."""
        from agent.swarm_agents import create_swarm_agents

        mock_filter.return_value = Mock(tools=[])
        mock_model.return_value = Mock()
        mock_agent.return_value = Mock()

        agents = create_swarm_agents(
            session_id="test-session",
            user_id="test-user"
        )

        assert len(agents) == 12

    @patch('agent.swarm_agents.filter_tools')
    @patch('agent.swarm_agents.BedrockModel')
    @patch('agent.swarm_agents.Agent')
    def test_coordinator_uses_haiku_model(self, mock_agent, mock_model, mock_filter):
        """Coordinator should use Haiku model (faster for routing)."""
        from agent.swarm_agents import create_swarm_agents

        mock_filter.return_value = Mock(tools=[])
        model_instances = []

        def capture_model(*args, **kwargs):
            instance = Mock()
            instance.model_id = kwargs.get('model_id', args[0] if args else None)
            instance.temperature = kwargs.get('temperature')
            model_instances.append(instance)
            return instance

        mock_model.side_effect = capture_model
        mock_agent.return_value = Mock()

        create_swarm_agents(
            session_id="test-session",
            user_id="test-user"
        )

        # Find coordinator model (Haiku with low temperature)
        coordinator_model = next(
            (m for m in model_instances if m.temperature == 0.3),
            None
        )
        assert coordinator_model is not None
        assert "haiku" in coordinator_model.model_id.lower()

    @patch('agent.swarm_agents.filter_tools')
    @patch('agent.swarm_agents.BedrockModel')
    @patch('agent.swarm_agents.Agent')
    def test_coordinator_has_no_tools(self, mock_agent, mock_model, mock_filter):
        """Coordinator should be created without tools."""
        from agent.swarm_agents import create_swarm_agents

        mock_filter.return_value = Mock(tools=[Mock()])
        mock_model.return_value = Mock()

        agent_calls = []
        def capture_agent(*args, **kwargs):
            agent_calls.append(kwargs)
            return Mock()

        mock_agent.side_effect = capture_agent

        create_swarm_agents(
            session_id="test-session",
            user_id="test-user"
        )

        # Find coordinator agent call
        coordinator_call = next(
            (c for c in agent_calls if c.get('name') == 'coordinator'),
            None
        )
        assert coordinator_call is not None
        assert coordinator_call.get('tools') == []


class TestCreateChatbotSwarm:
    """Test create_chatbot_swarm function."""

    @patch('agent.swarm_agents.create_swarm_agents')
    @patch('agent.swarm_agents.Swarm')
    def test_swarm_created_with_correct_config(self, mock_swarm, mock_create_agents):
        """Should create Swarm with correct configuration parameters."""
        from agent.swarm_agents import create_chatbot_swarm

        # Mock agents
        mock_agents = {
            "coordinator": Mock(),
            "responder": Mock(executor=Mock(tool_registry=Mock(registry={}))),
        }
        mock_create_agents.return_value = mock_agents
        mock_swarm.return_value = Mock(nodes=Mock(get=lambda x: mock_agents.get(x)))

        create_chatbot_swarm(
            session_id="test-session",
            user_id="test-user"
        )

        # Verify Swarm was called with expected parameters
        mock_swarm.assert_called_once()
        call_kwargs = mock_swarm.call_args.kwargs

        assert call_kwargs["entry_point"] == mock_agents["coordinator"]
        assert call_kwargs["session_manager"] is None  # Disabled for state persistence bugs
        assert call_kwargs["max_handoffs"] == 15
        assert call_kwargs["max_iterations"] == 15
        assert call_kwargs["execution_timeout"] == 600.0
        assert call_kwargs["node_timeout"] == 180.0

    @patch('agent.swarm_agents.create_swarm_agents')
    @patch('agent.swarm_agents.Swarm')
    def test_responder_handoff_removed(self, mock_swarm, mock_create_agents):
        """Should remove handoff_to_agent from responder's tool registry."""
        from agent.swarm_agents import create_chatbot_swarm

        # Mock responder with handoff tool
        mock_registry = Mock()
        mock_registry.registry = {"handoff_to_agent": Mock(), "create_visualization": Mock()}

        mock_responder = Mock()
        mock_responder.executor.tool_registry = mock_registry

        mock_agents = {
            "coordinator": Mock(),
            "responder": mock_responder,
        }
        mock_create_agents.return_value = mock_agents

        mock_swarm_instance = Mock()
        mock_swarm_instance.nodes.get.return_value = mock_responder
        mock_swarm.return_value = mock_swarm_instance

        create_chatbot_swarm(
            session_id="test-session",
            user_id="test-user"
        )

        # Verify handoff_to_agent was removed
        assert "handoff_to_agent" not in mock_registry.registry

    @patch('agent.swarm_agents.create_swarm_agents')
    @patch('agent.swarm_agents.Swarm')
    def test_repetitive_handoff_detection_configured(self, mock_swarm, mock_create_agents):
        """Should configure ping-pong detection parameters."""
        from agent.swarm_agents import create_chatbot_swarm

        mock_agents = {
            "coordinator": Mock(),
            "responder": Mock(executor=Mock(tool_registry=Mock(registry={}))),
        }
        mock_create_agents.return_value = mock_agents
        mock_swarm.return_value = Mock(nodes=Mock(get=lambda x: mock_agents.get(x)))

        create_chatbot_swarm(
            session_id="test-session",
            user_id="test-user"
        )

        call_kwargs = mock_swarm.call_args.kwargs

        # Verify ping-pong detection parameters
        assert call_kwargs["repetitive_handoff_detection_window"] == 6
        assert call_kwargs["repetitive_handoff_min_unique_agents"] == 2
