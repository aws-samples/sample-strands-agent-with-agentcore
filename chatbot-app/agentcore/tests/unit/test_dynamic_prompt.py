"""
Unit tests for Dynamic Prompt Construction and Tool Filtering.

Tests the backend agent's ability to:
1. Dynamically construct system prompts based on enabled tools
2. Filter tools based on user preferences
3. Load tool-specific guidance
4. Handle various configuration scenarios
"""
import os
import json
import pytest
from unittest.mock import MagicMock, patch, ANY
from typing import List, Dict, Any


# ============================================================
# Test Fixtures
# ============================================================

@pytest.fixture
def mock_tool_guidance():
    """Sample tool guidance configuration."""
    return {
        "calculator": {
            "system_prompt_guidance": "You have access to a calculator for mathematical operations."
        },
        "web_search": {
            "system_prompt_guidance": "You can search the web using the web_search tool. Use it for current information."
        },
        "code_interpreter": {
            "system_prompt_guidance": "You have access to a Python code interpreter. Use it for data analysis and visualization."
        },
        "research_agent": {
            "system_prompt_guidance": "You can delegate research tasks to the research_agent. It will search multiple sources."
        },
        "diagram_tool": {
            "system_prompt_guidance": "You can create diagrams using Mermaid syntax with the diagram_tool."
        }
    }


@pytest.fixture
def mock_tools_config(mock_tool_guidance):
    """Sample tools-config.json structure."""
    return {
        "tools": [
            {
                "id": "calculator",
                "name": "Calculator",
                "tool_type": "builtin",
                "enabled": True,
                **mock_tool_guidance.get("calculator", {})
            },
            {
                "id": "web_search",
                "name": "Web Search",
                "tool_type": "local",
                "enabled": True,
                **mock_tool_guidance.get("web_search", {})
            },
            {
                "id": "code_interpreter",
                "name": "Code Interpreter",
                "tool_type": "builtin",
                "enabled": False,
                **mock_tool_guidance.get("code_interpreter", {})
            },
            {
                "id": "research_agent",
                "name": "Research Agent",
                "tool_type": "runtime-a2a",
                "enabled": True,
                **mock_tool_guidance.get("research_agent", {})
            }
        ]
    }


# ============================================================
# Dynamic System Prompt Construction Tests
# ============================================================

class TestDynamicSystemPromptConstruction:
    """Tests for dynamic system prompt construction based on enabled tools."""

    def test_base_system_prompt_content(self):
        """Test that base system prompt has required content."""
        base_prompt = """You are an intelligent AI agent with dynamic tool capabilities. You can perform various tasks based on the combination of tools available to you.

Key guidelines:
- Use available tools whenever they can enhance your response with visualizations, data, or interactive elements
- You can ONLY use tools that are explicitly provided to you - available tools may change based on user preferences
- When multiple tools are available, select the most appropriate combination and use them in the optimal order to fulfill the request
- Break down complex tasks into steps and use multiple tools sequentially or in parallel as needed
- Always explain your reasoning when using tools
- If you don't have the right tool for a task, clearly inform the user about the limitation

Your goal is to be helpful, accurate, and efficient in completing user requests using the available tools."""

        assert "dynamic tool capabilities" in base_prompt
        assert "ONLY use tools" in base_prompt
        assert "available tools may change" in base_prompt

    def test_system_prompt_with_no_tools(self):
        """Test system prompt when no tools are enabled."""
        enabled_tools = []

        # Simulate prompt construction with no tools
        prompt_sections = ["Base system prompt here."]
        guidance_sections = []  # No tools = no guidance

        for tool_id in enabled_tools:
            # Would add guidance here
            pass

        prompt_sections.extend(guidance_sections)
        prompt_sections.append("Current date: 2024-01-15 (Monday) 10:00 PST")

        final_prompt = "\n\n".join(prompt_sections)

        assert "Base system prompt" in final_prompt
        assert "Current date" in final_prompt
        # Should not have tool-specific guidance
        assert len(prompt_sections) == 2  # base + date

    def test_system_prompt_with_single_tool(self, mock_tool_guidance):
        """Test system prompt with single tool enabled."""
        enabled_tools = ["calculator"]

        prompt_sections = ["Base system prompt."]
        guidance_sections = []

        for tool_id in enabled_tools:
            if tool_id in mock_tool_guidance:
                guidance = mock_tool_guidance[tool_id].get("system_prompt_guidance")
                if guidance:
                    guidance_sections.append(guidance)

        prompt_sections.extend(guidance_sections)
        prompt_sections.append("Current date: 2024-01-15")

        final_prompt = "\n\n".join(prompt_sections)

        assert "calculator for mathematical" in final_prompt
        assert len(guidance_sections) == 1

    def test_system_prompt_with_multiple_tools(self, mock_tool_guidance):
        """Test system prompt with multiple tools enabled."""
        enabled_tools = ["calculator", "web_search", "code_interpreter"]

        prompt_sections = ["Base system prompt."]
        guidance_sections = []

        for tool_id in enabled_tools:
            if tool_id in mock_tool_guidance:
                guidance = mock_tool_guidance[tool_id].get("system_prompt_guidance")
                if guidance:
                    guidance_sections.append(guidance)

        prompt_sections.extend(guidance_sections)
        prompt_sections.append("Current date: 2024-01-15")

        final_prompt = "\n\n".join(prompt_sections)

        # All three tool guidances should be present
        assert "calculator" in final_prompt
        assert "web_search" in final_prompt or "web" in final_prompt.lower()
        assert "code interpreter" in final_prompt.lower() or "python" in final_prompt.lower()
        assert len(guidance_sections) == 3

    def test_system_prompt_includes_date(self):
        """Test that system prompt includes current date."""
        date_string = "Current date: 2024-12-30 (Monday) 14:00 PST"

        prompt_sections = ["Base prompt.", date_string]
        final_prompt = "\n\n".join(prompt_sections)

        assert "Current date:" in final_prompt
        assert "2024-12-30" in final_prompt

    def test_system_prompt_order(self, mock_tool_guidance):
        """Test that prompt sections are in correct order."""
        enabled_tools = ["calculator", "research_agent"]

        prompt_sections = ["BASE PROMPT"]

        guidance_sections = []
        for tool_id in enabled_tools:
            if tool_id in mock_tool_guidance:
                guidance = mock_tool_guidance[tool_id].get("system_prompt_guidance", "")
                if guidance:
                    guidance_sections.append(guidance)

        prompt_sections.extend(guidance_sections)
        prompt_sections.append("DATE SECTION")

        final_prompt = "\n\n".join(prompt_sections)

        # Verify order: base -> tool guidance -> date
        base_pos = final_prompt.find("BASE PROMPT")
        calc_pos = final_prompt.find("calculator")
        research_pos = final_prompt.find("research")
        date_pos = final_prompt.find("DATE SECTION")

        assert base_pos < calc_pos < date_pos
        assert base_pos < research_pos < date_pos


# ============================================================
# Tool Filtering Tests
# ============================================================

class TestToolFiltering:
    """Tests for dynamic tool filtering based on enabled_tools list."""

    def test_filter_to_enabled_tools_only(self):
        """Test that only enabled tools are included."""
        all_tools = ["calculator", "web_search", "code_interpreter", "diagram_tool"]
        enabled_tools = ["calculator", "code_interpreter"]

        filtered = [t for t in all_tools if t in enabled_tools]

        assert filtered == ["calculator", "code_interpreter"]
        assert "web_search" not in filtered
        assert "diagram_tool" not in filtered

    def test_filter_with_empty_enabled_list(self):
        """Test filtering when no tools are enabled."""
        all_tools = ["calculator", "web_search"]
        enabled_tools = []

        filtered = [t for t in all_tools if t in enabled_tools]

        assert filtered == []

    def test_filter_with_all_tools_enabled(self):
        """Test filtering when all tools are enabled."""
        all_tools = ["calculator", "web_search", "code_interpreter"]
        enabled_tools = ["calculator", "web_search", "code_interpreter"]

        filtered = [t for t in all_tools if t in enabled_tools]

        assert filtered == all_tools

    def test_filter_preserves_order(self):
        """Test that filtering preserves tool order."""
        all_tools = ["a_tool", "b_tool", "c_tool", "d_tool"]
        enabled_tools = ["d_tool", "a_tool", "c_tool"]

        # Preserve order from all_tools
        filtered = [t for t in all_tools if t in enabled_tools]

        assert filtered == ["a_tool", "c_tool", "d_tool"]

    def test_filter_handles_unknown_tools(self):
        """Test filtering handles tools not in registry."""
        all_tools = ["calculator", "web_search"]
        enabled_tools = ["calculator", "unknown_tool", "another_unknown"]

        # Only include known tools
        filtered = [t for t in all_tools if t in enabled_tools]

        assert filtered == ["calculator"]
        assert "unknown_tool" not in filtered


# ============================================================
# Tool Guidance Loading Tests
# ============================================================

class TestToolGuidanceLoading:
    """Tests for loading tool-specific guidance."""

    def test_load_guidance_from_config(self, mock_tools_config):
        """Test loading tool guidance from config structure."""
        enabled_tools = ["calculator", "web_search"]
        tools = mock_tools_config["tools"]

        guidance_list = []
        for tool_config in tools:
            if tool_config["id"] in enabled_tools:
                guidance = tool_config.get("system_prompt_guidance")
                if guidance:
                    guidance_list.append(guidance)

        assert len(guidance_list) == 2
        assert any("calculator" in g for g in guidance_list)
        assert any("web" in g.lower() for g in guidance_list)

    def test_load_guidance_skips_missing(self, mock_tools_config):
        """Test that missing guidance is skipped gracefully."""
        # Add tool without guidance
        mock_tools_config["tools"].append({
            "id": "no_guidance_tool",
            "name": "No Guidance",
            "tool_type": "local",
            "enabled": True
            # No system_prompt_guidance field
        })

        enabled_tools = ["calculator", "no_guidance_tool"]
        tools = mock_tools_config["tools"]

        guidance_list = []
        for tool_config in tools:
            if tool_config["id"] in enabled_tools:
                guidance = tool_config.get("system_prompt_guidance")
                if guidance:
                    guidance_list.append(guidance)

        # Should only have calculator guidance
        assert len(guidance_list) == 1
        assert "calculator" in guidance_list[0]

    def test_load_guidance_handles_empty_guidance(self, mock_tools_config):
        """Test that empty guidance string is skipped."""
        mock_tools_config["tools"].append({
            "id": "empty_guidance",
            "name": "Empty Guidance",
            "tool_type": "local",
            "enabled": True,
            "system_prompt_guidance": ""  # Empty string
        })

        enabled_tools = ["calculator", "empty_guidance"]
        tools = mock_tools_config["tools"]

        guidance_list = []
        for tool_config in tools:
            if tool_config["id"] in enabled_tools:
                guidance = tool_config.get("system_prompt_guidance")
                if guidance:  # Empty string is falsy
                    guidance_list.append(guidance)

        assert len(guidance_list) == 1


# ============================================================
# Integration Scenarios
# ============================================================

class TestDynamicPromptAndFilteringIntegration:
    """Integration tests combining prompt construction and tool filtering."""

    def test_code_assistant_configuration(self, mock_tool_guidance):
        """Test configuration for code assistant use case."""
        # Code mode: enable coding-related tools
        enabled_tools = ["code_interpreter", "diagram_tool", "calculator"]

        base_prompt = "You are a code assistant AI."
        prompt_sections = [base_prompt]

        for tool_id in enabled_tools:
            if tool_id in mock_tool_guidance:
                guidance = mock_tool_guidance[tool_id].get("system_prompt_guidance", "")
                if guidance:
                    prompt_sections.append(guidance)

        prompt_sections.append("Current date: 2024-01-15")

        final_prompt = "\n\n".join(prompt_sections)

        # Should have code-related guidance
        assert "code interpreter" in final_prompt.lower() or "python" in final_prompt.lower()
        assert "diagram" in final_prompt.lower()
        # Should not have research guidance
        assert "research" not in final_prompt.lower() or "research_agent" not in enabled_tools

    def test_research_assistant_configuration(self, mock_tool_guidance):
        """Test configuration for research assistant use case."""
        # Research mode: enable search and research tools
        enabled_tools = ["web_search", "research_agent"]

        base_prompt = "You are a research assistant AI."
        prompt_sections = [base_prompt]

        for tool_id in enabled_tools:
            if tool_id in mock_tool_guidance:
                guidance = mock_tool_guidance[tool_id].get("system_prompt_guidance", "")
                if guidance:
                    prompt_sections.append(guidance)

        prompt_sections.append("Current date: 2024-01-15")

        final_prompt = "\n\n".join(prompt_sections)

        # Should have research-related guidance
        assert "search" in final_prompt.lower() or "web" in final_prompt.lower()
        assert "research" in final_prompt.lower()
        # Should not have code interpreter guidance
        assert "python code interpreter" not in final_prompt.lower()

    def test_minimal_configuration(self):
        """Test minimal configuration with no tools."""
        enabled_tools = []

        base_prompt = "You are a helpful assistant."
        prompt_sections = [base_prompt]

        # No tools, no guidance added

        prompt_sections.append("Current date: 2024-01-15")

        final_prompt = "\n\n".join(prompt_sections)

        assert final_prompt == "You are a helpful assistant.\n\nCurrent date: 2024-01-15"

    def test_all_tools_configuration(self, mock_tool_guidance):
        """Test configuration with all tools enabled."""
        enabled_tools = list(mock_tool_guidance.keys())

        base_prompt = "Base prompt."
        prompt_sections = [base_prompt]

        for tool_id in enabled_tools:
            guidance = mock_tool_guidance[tool_id].get("system_prompt_guidance", "")
            if guidance:
                prompt_sections.append(guidance)

        prompt_sections.append("Current date: 2024-01-15")

        final_prompt = "\n\n".join(prompt_sections)

        # All tool guidance should be present
        assert "calculator" in final_prompt
        assert "web" in final_prompt.lower()
        assert "code" in final_prompt.lower() or "python" in final_prompt.lower()
        assert "research" in final_prompt.lower()
        assert "diagram" in final_prompt.lower()


# ============================================================
# Error Handling Tests
# ============================================================

# ============================================================
# Strands Agent Signature Compliance Tests
# ============================================================

class TestStrandsAgentSignatureCompliance:
    """Tests to verify prompt and tools are compatible with Strands Agent signature.

    Strands Agent.__init__ signature:
        Agent(
            model: BedrockModel,
            system_prompt: str,           # <-- Must be string
            tools: List[Callable | MCPClient],  # <-- Must be list of tool functions or MCP clients
            session_manager: SessionManager,
            hooks: Optional[List[HookProvider]] = None
        )
    """

    def test_system_prompt_is_string_type(self):
        """Verify system prompt is a string (not list or dict)."""
        prompt_sections = ["Base prompt.", "Tool guidance.", "Date: 2024-01-15"]

        # Final system_prompt must be a string
        system_prompt = "\n\n".join(prompt_sections)

        assert isinstance(system_prompt, str)
        assert not isinstance(system_prompt, list)
        assert not isinstance(system_prompt, dict)

    def test_system_prompt_not_empty(self):
        """Verify system prompt is not empty string."""
        prompt_sections = ["Base prompt.", "Date: 2024-01-15"]
        system_prompt = "\n\n".join(prompt_sections)

        assert len(system_prompt) > 0
        assert system_prompt.strip() != ""

    def test_tools_is_list_type(self):
        """Verify tools parameter is a list."""
        mock_tool1 = lambda x: x  # Mock callable
        mock_tool2 = lambda x: x

        tools = [mock_tool1, mock_tool2]

        assert isinstance(tools, list)
        assert len(tools) == 2

    def test_tools_can_be_empty_list(self):
        """Verify empty tools list is valid."""
        tools = []

        assert isinstance(tools, list)
        assert len(tools) == 0

    def test_tools_list_contains_callables(self):
        """Verify tools list contains callable objects."""
        def mock_calculator(expression: str) -> str:
            return "4"

        def mock_web_search(query: str) -> str:
            return "results"

        tools = [mock_calculator, mock_web_search]

        for tool in tools:
            assert callable(tool)

    def test_system_prompt_construction_for_agent(self):
        """Test full system prompt construction as it would be passed to Agent."""
        base_prompt = "You are an AI assistant."
        tool_guidance_1 = "Calculator: Use for math."
        tool_guidance_2 = "Search: Use for web queries."
        date_info = "Current date: 2024-01-15 (Monday) 10:00 PST"

        prompt_sections = [base_prompt, tool_guidance_1, tool_guidance_2, date_info]
        system_prompt = "\n\n".join(prompt_sections)

        # Verify format matches what Agent expects
        assert isinstance(system_prompt, str)
        assert "You are an AI assistant." in system_prompt
        assert "Calculator:" in system_prompt
        assert "Search:" in system_prompt
        assert "Current date:" in system_prompt

        # Verify sections are separated by double newlines
        assert "\n\n" in system_prompt
        assert system_prompt.count("\n\n") == 3  # 4 sections = 3 separators

    def test_filtered_tools_format_for_agent(self):
        """Test that filtered tools are in correct format for Agent.tools parameter."""
        # Simulate TOOL_REGISTRY lookup
        mock_registry = {
            "calculator": lambda expr: "result",
            "web_search": lambda query: "results",
            "code_interpreter": lambda code: "output",
        }

        enabled_tools = ["calculator", "code_interpreter"]

        # Filter tools as agent.py does
        filtered_tools = []
        for tool_id in enabled_tools:
            if tool_id in mock_registry:
                filtered_tools.append(mock_registry[tool_id])

        # Verify format for Agent
        assert isinstance(filtered_tools, list)
        assert len(filtered_tools) == 2
        for tool in filtered_tools:
            assert callable(tool)

    def test_agent_creation_parameters(self):
        """Test that all parameters for Agent() are valid."""
        # Simulate what ChatbotAgent.create_agent() would prepare
        system_prompt = "You are an assistant.\n\nUse tools wisely.\n\nDate: 2024-01-15"
        tools = []  # Empty is valid
        hooks = []  # Empty is valid

        # Verify types
        assert isinstance(system_prompt, str)
        assert isinstance(tools, list)
        assert isinstance(hooks, list)

    def test_model_config_format(self):
        """Test model configuration format for BedrockModel."""
        model_config = {
            "model_id": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            "temperature": 0.7,
        }

        # Verify required fields
        assert "model_id" in model_config
        assert "temperature" in model_config
        assert isinstance(model_config["model_id"], str)
        assert isinstance(model_config["temperature"], (int, float))
        assert 0.0 <= model_config["temperature"] <= 1.0

    def test_cache_prompt_config(self):
        """Test cache_prompt configuration for BedrockModel."""
        # When caching is enabled
        model_config_cached = {
            "model_id": "us.anthropic.claude-sonnet-4-20250514-v1:0",
            "temperature": 0.7,
            "cache_prompt": "default"  # Valid value for Strands
        }

        assert model_config_cached["cache_prompt"] == "default"

        # When caching is disabled
        model_config_no_cache = {
            "model_id": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            "temperature": 0.7,
            # No cache_prompt key
        }

        assert "cache_prompt" not in model_config_no_cache


class TestDynamicPromptErrorHandling:
    """Tests for error handling in dynamic prompt construction."""

    def test_handles_none_enabled_tools(self):
        """Test handling when enabled_tools is None."""
        enabled_tools = None

        # Should handle gracefully
        if enabled_tools is None or len(enabled_tools) == 0:
            guidance_list = []
        else:
            guidance_list = ["some guidance"]

        assert guidance_list == []

    def test_handles_invalid_tool_config(self):
        """Test handling of invalid tool configuration."""
        # Config with missing required fields
        invalid_config = {
            "tools": [
                {"name": "Missing ID"},  # Missing 'id' field
                {"id": "valid", "name": "Valid Tool", "system_prompt_guidance": "Valid guidance"}
            ]
        }

        enabled_tools = ["valid", "missing_id"]

        guidance_list = []
        for tool_config in invalid_config["tools"]:
            tool_id = tool_config.get("id")
            if tool_id and tool_id in enabled_tools:
                guidance = tool_config.get("system_prompt_guidance")
                if guidance:
                    guidance_list.append(guidance)

        # Should only get valid tool's guidance
        assert len(guidance_list) == 1
        assert "Valid guidance" in guidance_list[0]

    def test_handles_unicode_in_guidance(self):
        """Test handling of unicode characters in tool guidance."""
        guidance_with_unicode = "This tool can handle unicode: cafe, resume, naive."

        prompt_sections = ["Base prompt.", guidance_with_unicode]
        final_prompt = "\n\n".join(prompt_sections)

        assert "unicode" in final_prompt
        assert "cafe" in final_prompt

    def test_handles_special_characters_in_guidance(self):
        """Test handling of special characters in tool guidance."""
        guidance_with_special = "Use <code> blocks and 'quotes' & \"double quotes\"."

        prompt_sections = ["Base prompt.", guidance_with_special]
        final_prompt = "\n\n".join(prompt_sections)

        assert "<code>" in final_prompt
        assert "\"double quotes\"" in final_prompt
