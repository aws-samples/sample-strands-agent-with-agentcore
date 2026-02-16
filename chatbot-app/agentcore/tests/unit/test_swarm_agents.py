"""
Tests for Swarm Agent Configuration and Tool Assignment

Tests cover:
- Tool assignment per agent (AGENT_TOOL_MAPPING)
- Agent configuration consistency (14 agents)
- System prompt generation
- SwarmAgent tool loading with auth_token
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

        assert "generate_chart" in tools
        assert "create_visual_design" in tools
        assert "calculator" in tools
        assert len(tools) == 3

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
            "browser_save_screenshot",
        ]

        for tool in expected_tools:
            assert tool in tools

    def test_all_agents_have_tool_mappings(self):
        """All defined agents should have tool mappings."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING, AGENT_DESCRIPTIONS

        for agent_name in AGENT_DESCRIPTIONS.keys():
            assert agent_name in AGENT_TOOL_MAPPING, f"Missing tool mapping for {agent_name}"

    def test_google_workspace_agent_has_tools(self):
        """Google workspace agent should have Gmail and Calendar tools."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING

        tools = AGENT_TOOL_MAPPING.get("google_workspace_agent", [])
        assert len(tools) > 0

    def test_notion_agent_has_tools(self):
        """Notion agent should have Notion tools."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING

        tools = AGENT_TOOL_MAPPING.get("notion_agent", [])
        assert len(tools) > 0


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

    def test_fourteen_agents_defined(self):
        """Should have exactly 14 agents defined."""
        from agent.config.swarm_config import AGENT_TOOL_MAPPING

        assert len(AGENT_TOOL_MAPPING) == 14

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


class TestGetToolsForAgentFunction:
    """Test the get_tools_for_agent function in swarm_agent module."""

    @patch('agents.swarm_agent.filter_tools')
    def test_passes_auth_token_to_filter_tools(self, mock_filter):
        """Should pass auth_token to filter_tools for OAuth tool initialization."""
        from agents.swarm_agent import get_tools_for_agent

        mock_filter.return_value = Mock(tools=[Mock()], validation_errors=[])

        get_tools_for_agent("web_researcher", auth_token="test-jwt-token")

        mock_filter.assert_called_once()
        call_kwargs = mock_filter.call_args.kwargs
        assert call_kwargs.get("auth_token") == "test-jwt-token"

    @patch('agents.swarm_agent.filter_tools')
    def test_returns_empty_for_no_tools(self, mock_filter):
        """Should return empty list for agents with no tool mapping."""
        from agents.swarm_agent import get_tools_for_agent

        result = get_tools_for_agent("coordinator")

        # filter_tools should NOT be called for coordinator (empty tool list)
        mock_filter.assert_not_called()
        assert result == []

    @patch('agents.swarm_agent.filter_tools')
    def test_logs_validation_errors(self, mock_filter):
        """Should log warnings when tool validation fails."""
        from agents.swarm_agent import get_tools_for_agent

        mock_filter.return_value = Mock(
            tools=[],
            validation_errors=["MCP auth required for gmail"]
        )

        with patch('agents.swarm_agent.logger') as mock_logger:
            get_tools_for_agent("google_workspace_agent")
            mock_logger.warning.assert_called()
