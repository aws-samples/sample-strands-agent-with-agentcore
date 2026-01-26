"""
Unit tests for the prompt_builder module.

Tests cover:
- build_text_system_prompt() - returns list of SystemContentBlock
- build_voice_system_prompt() - returns string
- system_prompt_to_string() - converts list to string
- load_tool_guidance() - loads tool guidance from config
"""
import os
import sys
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../src'))


# ============================================================
# build_text_system_prompt Tests
# ============================================================

class TestBuildTextSystemPrompt:
    """Tests for build_text_system_prompt function."""

    def test_returns_list_of_content_blocks(self):
        """Verify return type is list of SystemContentBlock."""
        from agent.config.prompt_builder import build_text_system_prompt

        result = build_text_system_prompt(enabled_tools=[])

        assert isinstance(result, list)
        assert len(result) >= 2  # At least base prompt + date

    def test_each_block_has_text_key(self):
        """Verify each block has 'text' key."""
        from agent.config.prompt_builder import build_text_system_prompt

        result = build_text_system_prompt(enabled_tools=[])

        for block in result:
            assert isinstance(block, dict)
            assert "text" in block or "cachePoint" in block

    def test_base_prompt_is_first_block(self):
        """Verify base prompt is the first content block."""
        from agent.config.prompt_builder import build_text_system_prompt

        result = build_text_system_prompt(enabled_tools=[])

        first_block = result[0]
        assert "text" in first_block
        assert "intelligent AI agent" in first_block["text"]

    def test_date_is_last_block(self):
        """Verify current date is the last content block."""
        from agent.config.prompt_builder import build_text_system_prompt

        result = build_text_system_prompt(enabled_tools=[])

        last_block = result[-1]
        assert "text" in last_block
        assert "Current date:" in last_block["text"]

    def test_base_prompt_and_date_only_without_tools(self):
        """Verify base prompt and date blocks when no tools provided."""
        from agent.config.prompt_builder import build_text_system_prompt

        result = build_text_system_prompt(enabled_tools=[])

        # Should only have base prompt + date (no tool guidance with empty tools)
        assert len(result) == 2

    def test_tool_guidance_blocks_added(self):
        """Verify tool guidance adds content blocks."""
        from agent.config.prompt_builder import build_text_system_prompt

        # Mock load_tool_guidance to return test guidance
        with patch('agent.config.prompt_builder.load_tool_guidance') as mock_load:
            mock_load.return_value = [
                "Calculator guidance text",
                "Web search guidance text"
            ]

            result = build_text_system_prompt(enabled_tools=["calculator", "web_search"])

            # Should have: base + 2 tool guidance + date = 4 blocks
            assert len(result) == 4
            assert "Calculator guidance" in result[1]["text"]
            assert "Web search guidance" in result[2]["text"]


# ============================================================
# build_voice_system_prompt Tests
# ============================================================

class TestBuildVoiceSystemPrompt:
    """Tests for build_voice_system_prompt function."""

    def test_returns_string(self):
        """Verify return type is string."""
        from agent.config.prompt_builder import build_voice_system_prompt

        result = build_voice_system_prompt(enabled_tools=[])

        assert isinstance(result, str)

    def test_contains_voice_specific_guidelines(self):
        """Verify voice-specific guidelines are included."""
        from agent.config.prompt_builder import build_voice_system_prompt

        result = build_voice_system_prompt(enabled_tools=[])

        assert "voice assistant" in result
        assert "1-3 short sentences" in result
        assert "no markdown" in result

    def test_contains_current_date(self):
        """Verify current date is included."""
        from agent.config.prompt_builder import build_voice_system_prompt

        result = build_voice_system_prompt(enabled_tools=[])

        assert "Current date:" in result

    def test_tool_guidance_included_when_tools_enabled(self):
        """Verify tool guidance is included when tools are enabled."""
        from agent.config.prompt_builder import build_voice_system_prompt

        with patch('agent.config.prompt_builder.load_tool_guidance') as mock_load:
            mock_load.return_value = ["Calculator: Use for math operations"]

            result = build_voice_system_prompt(enabled_tools=["calculator"])

            assert "Tools available:" in result
            assert "Calculator:" in result


# ============================================================
# system_prompt_to_string Tests
# ============================================================

class TestSystemPromptToString:
    """Tests for system_prompt_to_string function."""

    def test_converts_list_to_string(self):
        """Verify list of content blocks is converted to string."""
        from agent.config.prompt_builder import system_prompt_to_string

        blocks = [
            {"text": "First section"},
            {"text": "Second section"},
            {"text": "Third section"}
        ]

        result = system_prompt_to_string(blocks)

        assert isinstance(result, str)
        assert "First section" in result
        assert "Second section" in result
        assert "Third section" in result

    def test_sections_separated_by_double_newlines(self):
        """Verify sections are joined with double newlines."""
        from agent.config.prompt_builder import system_prompt_to_string

        blocks = [
            {"text": "Section A"},
            {"text": "Section B"}
        ]

        result = system_prompt_to_string(blocks)

        assert result == "Section A\n\nSection B"

    def test_ignores_cache_point_blocks(self):
        """Verify cachePoint blocks are ignored in string conversion."""
        from agent.config.prompt_builder import system_prompt_to_string

        blocks = [
            {"text": "Text content"},
            {"cachePoint": {"type": "default"}},
            {"text": "More text"}
        ]

        result = system_prompt_to_string(blocks)

        assert "Text content" in result
        assert "More text" in result
        assert "cachePoint" not in result

    def test_handles_string_input(self):
        """Verify string input is returned as-is."""
        from agent.config.prompt_builder import system_prompt_to_string

        input_str = "Already a string"
        result = system_prompt_to_string(input_str)

        assert result == input_str

    def test_handles_empty_list(self):
        """Verify empty list returns empty string."""
        from agent.config.prompt_builder import system_prompt_to_string

        result = system_prompt_to_string([])

        assert result == ""


# ============================================================
# load_tool_guidance Tests
# ============================================================

class TestLoadToolGuidance:
    """Tests for load_tool_guidance function."""

    def test_returns_empty_list_when_no_tools_enabled(self):
        """Verify empty list when enabled_tools is empty."""
        from agent.config.prompt_builder import load_tool_guidance

        result = load_tool_guidance(enabled_tools=[])

        assert result == []

    def test_returns_empty_list_when_tools_is_none(self):
        """Verify empty list when enabled_tools is None."""
        from agent.config.prompt_builder import load_tool_guidance

        result = load_tool_guidance(enabled_tools=None)

        assert result == []

    def test_returns_list_of_strings(self):
        """Verify return type is list of strings."""
        from agent.config.prompt_builder import load_tool_guidance

        # Mock the file reading to avoid actual file dependency
        mock_config = {
            "local_tools": [
                {
                    "id": "calculator",
                    "systemPromptGuidance": "Use calculator for math"
                }
            ]
        }

        with patch('builtins.open', MagicMock()), \
             patch('json.load', return_value=mock_config), \
             patch('pathlib.Path.exists', return_value=True):

            result = load_tool_guidance(enabled_tools=["calculator"])

            assert isinstance(result, list)
            for item in result:
                assert isinstance(item, str)


# ============================================================
# get_current_date_pacific Tests
# ============================================================

class TestGetCurrentDatePacific:
    """Tests for get_current_date_pacific function."""

    def test_returns_string(self):
        """Verify return type is string."""
        from agent.config.prompt_builder import get_current_date_pacific

        result = get_current_date_pacific()

        assert isinstance(result, str)

    def test_contains_date_format(self):
        """Verify date format includes year, month, day."""
        from agent.config.prompt_builder import get_current_date_pacific

        result = get_current_date_pacific()

        # Should match format like "2024-01-15 (Monday) 10:00 PST"
        assert "-" in result  # Date separator
        assert "(" in result  # Day name in parentheses
        assert ":" in result  # Time separator

    def test_contains_timezone(self):
        """Verify timezone abbreviation is included."""
        from agent.config.prompt_builder import get_current_date_pacific

        result = get_current_date_pacific()

        # Should have timezone (PST/PDT or UTC as fallback)
        assert "PST" in result or "PDT" in result or "UTC" in result


# ============================================================
# Integration Tests
# ============================================================

class TestPromptBuilderIntegration:
    """Integration tests for prompt_builder module."""

    def test_text_prompt_blocks_can_be_converted_to_string(self):
        """Verify text prompt blocks can be converted back to string."""
        from agent.config.prompt_builder import build_text_system_prompt, system_prompt_to_string

        blocks = build_text_system_prompt(enabled_tools=[])
        string_version = system_prompt_to_string(blocks)

        # String should contain content from all text blocks
        assert "intelligent AI agent" in string_version
        assert "Current date:" in string_version

    def test_voice_and_text_prompts_have_consistent_date(self):
        """Verify both prompt types include current date."""
        from agent.config.prompt_builder import build_text_system_prompt, build_voice_system_prompt

        text_prompt = build_text_system_prompt(enabled_tools=[])
        voice_prompt = build_voice_system_prompt(enabled_tools=[])

        # Both should have "Current date:"
        text_string = " ".join(block.get("text", "") for block in text_prompt)
        assert "Current date:" in text_string
        assert "Current date:" in voice_prompt

    def test_both_prompts_support_same_tools(self):
        """Verify both prompt types load guidance for same tools."""
        from agent.config.prompt_builder import build_text_system_prompt, build_voice_system_prompt

        with patch('agent.config.prompt_builder.load_tool_guidance') as mock_load:
            mock_load.return_value = ["Calculator guidance"]

            text_prompt = build_text_system_prompt(enabled_tools=["calculator"])
            voice_prompt = build_voice_system_prompt(enabled_tools=["calculator"])

            # Both should call load_tool_guidance with same args
            assert mock_load.call_count == 2
