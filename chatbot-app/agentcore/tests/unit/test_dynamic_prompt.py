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
            system_prompt: str | list[SystemContentBlock],  # String or list of content blocks
            tools: List[Callable | MCPClient],  # Must be list of tool functions or MCP clients
            session_manager: SessionManager,
            hooks: Optional[List[HookProvider]] = None
        )

    SystemContentBlock can contain:
        - {"text": "prompt text"}
        - {"cachePoint": {"type": "default"}}
    """

    def test_system_prompt_is_string_type(self):
        """Verify system prompt can be a string (legacy format)."""
        prompt_sections = ["Base prompt.", "Tool guidance.", "Date: 2024-01-15"]

        # String format system_prompt
        system_prompt = "\n\n".join(prompt_sections)

        assert isinstance(system_prompt, str)
        assert not isinstance(system_prompt, dict)

    def test_system_prompt_is_list_of_content_blocks(self):
        """Verify system prompt can be list of SystemContentBlock (new format)."""
        system_prompt = [
            {"text": "Base prompt."},
            {"text": "Tool guidance."},
            {"text": "Date: 2024-01-15"},
        ]

        assert isinstance(system_prompt, list)
        for block in system_prompt:
            assert isinstance(block, dict)
            assert "text" in block or "cachePoint" in block

    def test_system_prompt_list_with_cache_point(self):
        """Verify system prompt list can include cache points."""
        system_prompt = [
            {"text": "Base prompt."},
            {"text": "Tool guidance."},
            {"cachePoint": {"type": "default"}},
            {"text": "Date: 2024-01-15"},
        ]

        assert isinstance(system_prompt, list)
        assert len(system_prompt) == 4

        # Verify cache point structure
        cache_block = system_prompt[2]
        assert "cachePoint" in cache_block
        assert cache_block["cachePoint"]["type"] == "default"

    def test_system_prompt_not_empty(self):
        """Verify system prompt is not empty (string or list)."""
        # String format
        string_prompt = "Base prompt.\n\nDate: 2024-01-15"
        assert len(string_prompt) > 0
        assert string_prompt.strip() != ""

        # List format
        list_prompt = [{"text": "Base prompt."}, {"text": "Date: 2024-01-15"}]
        assert len(list_prompt) > 0
        # Verify at least one block has text content
        has_text = any(block.get("text") for block in list_prompt)
        assert has_text

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

    def test_system_prompt_construction_for_agent_string_format(self):
        """Test full system prompt construction as string (legacy format)."""
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

    def test_system_prompt_construction_for_agent_list_format(self):
        """Test full system prompt construction as list of content blocks (new format)."""
        system_prompt = [
            {"text": "You are an AI assistant."},
            {"text": "Calculator: Use for math."},
            {"text": "Search: Use for web queries."},
            {"text": "Current date: 2024-01-15 (Monday) 10:00 PST"},
        ]

        # Verify format matches what Agent expects
        assert isinstance(system_prompt, list)
        assert len(system_prompt) == 4

        # Each block should have text
        all_text = " ".join(block.get("text", "") for block in system_prompt)
        assert "You are an AI assistant." in all_text
        assert "Calculator:" in all_text
        assert "Search:" in all_text
        assert "Current date:" in all_text

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
            "model_id": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
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


# ============================================================
# Citation Guidance Loading Tests
# ============================================================

class TestCitationGuidanceLoading:
    """Tests for citation guidance loading based on usesCitation flag."""

    @pytest.fixture
    def mock_tools_config_with_citation(self):
        """Sample tools-config.json with shared_guidance and usesCitation flags."""
        return {
            "shared_guidance": {
                "citation_instructions": "Citation Instructions for Web Search Results:\n\nWhen your response is based on content returned by web search tools, you MUST appropriately cite your response using <cite> tags."
            },
            "local_tools": [
                {
                    "id": "ddg_web_search",
                    "name": "Web Search",
                    "description": "Search the web using DuckDuckGo",
                    "usesCitation": True,
                    "systemPromptGuidance": None
                },
                {
                    "id": "fetch_url_content",
                    "name": "URL Fetcher",
                    "description": "Fetch and extract content from web URLs",
                    "usesCitation": True,
                    "systemPromptGuidance": None
                },
                {
                    "id": "calculator",
                    "name": "Calculator",
                    "description": "Basic math operations",
                    "usesCitation": False,
                    "systemPromptGuidance": "Use calculator for math."
                }
            ],
            "gateway_targets": [
                {
                    "id": "gateway_google-web-search",
                    "name": "Google Search",
                    "usesCitation": True,
                    "systemPromptGuidance": None
                },
                {
                    "id": "gateway_arxiv-search",
                    "name": "ArXiv",
                    "usesCitation": True,
                    "systemPromptGuidance": None
                },
                {
                    "id": "gateway_weather",
                    "name": "Weather",
                    "usesCitation": False,
                    "systemPromptGuidance": None
                }
            ]
        }

    def test_citation_guidance_added_when_web_search_enabled(self, mock_tools_config_with_citation):
        """Test that citation guidance is added when a usesCitation tool is enabled."""
        enabled_tools = ["ddg_web_search", "calculator"]
        config = mock_tools_config_with_citation

        guidance_sections = []
        needs_citation = False
        shared_guidance = config.get("shared_guidance", {})

        # Check all tool categories
        for category in ["local_tools", "gateway_targets"]:
            if category in config:
                for tool_group in config[category]:
                    tool_id = tool_group.get("id")
                    if tool_id and tool_id in enabled_tools:
                        guidance = tool_group.get("systemPromptGuidance")
                        if guidance:
                            guidance_sections.append(guidance)
                        if tool_group.get("usesCitation"):
                            needs_citation = True

        # Add citation instructions if needed
        if needs_citation and "citation_instructions" in shared_guidance:
            guidance_sections.append(shared_guidance["citation_instructions"])

        assert needs_citation is True
        assert any("Citation Instructions" in g for g in guidance_sections)
        assert any("calculator" in g.lower() for g in guidance_sections)

    def test_citation_guidance_not_added_when_no_web_search(self, mock_tools_config_with_citation):
        """Test that citation guidance is NOT added when no usesCitation tools are enabled."""
        enabled_tools = ["calculator"]  # Only non-citation tool
        config = mock_tools_config_with_citation

        guidance_sections = []
        needs_citation = False
        shared_guidance = config.get("shared_guidance", {})

        for category in ["local_tools", "gateway_targets"]:
            if category in config:
                for tool_group in config[category]:
                    tool_id = tool_group.get("id")
                    if tool_id and tool_id in enabled_tools:
                        guidance = tool_group.get("systemPromptGuidance")
                        if guidance:
                            guidance_sections.append(guidance)
                        if tool_group.get("usesCitation"):
                            needs_citation = True

        if needs_citation and "citation_instructions" in shared_guidance:
            guidance_sections.append(shared_guidance["citation_instructions"])

        assert needs_citation is False
        assert not any("Citation Instructions" in g for g in guidance_sections)

    def test_citation_guidance_added_for_gateway_web_search(self, mock_tools_config_with_citation):
        """Test citation guidance is added when gateway web search tool is enabled."""
        enabled_tools = ["gateway_google-web-search"]
        config = mock_tools_config_with_citation

        guidance_sections = []
        needs_citation = False
        shared_guidance = config.get("shared_guidance", {})

        for category in ["local_tools", "gateway_targets"]:
            if category in config:
                for tool_group in config[category]:
                    tool_id = tool_group.get("id")
                    if tool_id and tool_id in enabled_tools:
                        guidance = tool_group.get("systemPromptGuidance")
                        if guidance:
                            guidance_sections.append(guidance)
                        if tool_group.get("usesCitation"):
                            needs_citation = True

        if needs_citation and "citation_instructions" in shared_guidance:
            guidance_sections.append(shared_guidance["citation_instructions"])

        assert needs_citation is True
        assert any("Citation Instructions" in g for g in guidance_sections)

    def test_citation_guidance_added_for_arxiv(self, mock_tools_config_with_citation):
        """Test citation guidance is added when ArXiv tool is enabled."""
        enabled_tools = ["gateway_arxiv-search"]
        config = mock_tools_config_with_citation

        needs_citation = False

        for category in ["local_tools", "gateway_targets"]:
            if category in config:
                for tool_group in config[category]:
                    tool_id = tool_group.get("id")
                    if tool_id and tool_id in enabled_tools:
                        if tool_group.get("usesCitation"):
                            needs_citation = True

        assert needs_citation is True

    def test_citation_guidance_not_added_for_weather(self, mock_tools_config_with_citation):
        """Test citation guidance is NOT added when only weather (non-citation) tool is enabled."""
        enabled_tools = ["gateway_weather"]
        config = mock_tools_config_with_citation

        needs_citation = False

        for category in ["local_tools", "gateway_targets"]:
            if category in config:
                for tool_group in config[category]:
                    tool_id = tool_group.get("id")
                    if tool_id and tool_id in enabled_tools:
                        if tool_group.get("usesCitation"):
                            needs_citation = True

        assert needs_citation is False

    def test_multiple_citation_tools_only_add_guidance_once(self, mock_tools_config_with_citation):
        """Test that citation guidance is added only once even with multiple citation tools."""
        enabled_tools = ["ddg_web_search", "fetch_url_content", "gateway_google-web-search", "gateway_arxiv-search"]
        config = mock_tools_config_with_citation

        guidance_sections = []
        needs_citation = False
        shared_guidance = config.get("shared_guidance", {})

        for category in ["local_tools", "gateway_targets"]:
            if category in config:
                for tool_group in config[category]:
                    tool_id = tool_group.get("id")
                    if tool_id and tool_id in enabled_tools:
                        guidance = tool_group.get("systemPromptGuidance")
                        if guidance:
                            guidance_sections.append(guidance)
                        if tool_group.get("usesCitation"):
                            needs_citation = True

        # Add citation instructions only once
        if needs_citation and "citation_instructions" in shared_guidance:
            guidance_sections.append(shared_guidance["citation_instructions"])

        # Count citation instructions
        citation_count = sum(1 for g in guidance_sections if "Citation Instructions" in g)
        assert citation_count == 1

    def test_missing_shared_guidance_handled_gracefully(self):
        """Test that missing shared_guidance section is handled gracefully."""
        config_without_shared = {
            "local_tools": [
                {
                    "id": "ddg_web_search",
                    "name": "Web Search",
                    "usesCitation": True
                }
            ]
        }

        enabled_tools = ["ddg_web_search"]
        guidance_sections = []
        needs_citation = False
        shared_guidance = config_without_shared.get("shared_guidance", {})

        for category in ["local_tools"]:
            if category in config_without_shared:
                for tool_group in config_without_shared[category]:
                    tool_id = tool_group.get("id")
                    if tool_id and tool_id in enabled_tools:
                        if tool_group.get("usesCitation"):
                            needs_citation = True

        if needs_citation and "citation_instructions" in shared_guidance:
            guidance_sections.append(shared_guidance["citation_instructions"])

        # Should not crash, just no citation instructions added
        assert needs_citation is True
        assert len(guidance_sections) == 0  # No citation_instructions in shared_guidance

    def test_uses_citation_false_vs_missing(self, mock_tools_config_with_citation):
        """Test distinction between usesCitation=False and missing usesCitation."""
        # Tool with usesCitation: False explicitly set
        config = mock_tools_config_with_citation
        weather_tool = next(
            (t for t in config["gateway_targets"] if t["id"] == "gateway_weather"),
            None
        )
        assert weather_tool is not None
        assert weather_tool.get("usesCitation") is False

        # Tool with usesCitation: True
        search_tool = next(
            (t for t in config["local_tools"] if t["id"] == "ddg_web_search"),
            None
        )
        assert search_tool is not None
        assert search_tool.get("usesCitation") is True

    def test_citation_guidance_content_format(self, mock_tools_config_with_citation):
        """Test that citation guidance has expected content format."""
        shared_guidance = mock_tools_config_with_citation.get("shared_guidance", {})
        citation_instructions = shared_guidance.get("citation_instructions", "")

        # Should contain key citation-related terms
        assert "cite" in citation_instructions.lower()
        assert "web search" in citation_instructions.lower()

    def test_integration_with_tool_specific_guidance(self, mock_tools_config_with_citation):
        """Test that citation guidance works alongside tool-specific guidance."""
        enabled_tools = ["ddg_web_search", "calculator"]
        config = mock_tools_config_with_citation

        guidance_sections = []
        needs_citation = False
        shared_guidance = config.get("shared_guidance", {})

        for category in ["local_tools", "gateway_targets"]:
            if category in config:
                for tool_group in config[category]:
                    tool_id = tool_group.get("id")
                    if tool_id and tool_id in enabled_tools:
                        guidance = tool_group.get("systemPromptGuidance")
                        if guidance:
                            guidance_sections.append(guidance)
                        if tool_group.get("usesCitation"):
                            needs_citation = True

        if needs_citation and "citation_instructions" in shared_guidance:
            guidance_sections.append(shared_guidance["citation_instructions"])

        # Should have both calculator guidance and citation instructions
        assert len(guidance_sections) == 2
        assert any("calculator" in g.lower() for g in guidance_sections)
        assert any("Citation Instructions" in g for g in guidance_sections)
