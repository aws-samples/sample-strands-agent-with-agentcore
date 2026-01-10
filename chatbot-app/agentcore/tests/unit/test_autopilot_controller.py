"""Unit tests for MissionControl

Tests the Mission Control orchestration component:
- Initialization and configuration
- Tool groups catalog
- Directive parsing
- Response JSON extraction
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import json

# Import components
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from agent.mission_control import (
    MissionControl,
    DEFAULT_TOOL_GROUPS,
    build_tool_groups_yaml,
    MISSION_CONTROL_SYSTEM_PROMPT
)
from models.autopilot_schemas import (
    ToolGroup,
    Directive,
    MissionComplete,
    ProgressReport,
    ToolCall
)


# ============================================================
# Test Fixtures
# ============================================================

@pytest.fixture
def sample_tool_groups():
    """Sample tool groups for testing"""
    return [
        ToolGroup(
            id="web_search",
            name="Web Search",
            tools=["ddg_web_search", "fetch_url_content"],
            capabilities="Search the web and extract content"
        ),
        ToolGroup(
            id="documents",
            name="Document Creation",
            tools=["create_word_document", "modify_word_document"],
            capabilities="Create and edit Word documents"
        ),
        ToolGroup(
            id="calculation",
            name="Calculation",
            tools=["calculator"],
            capabilities="Mathematical calculations"
        )
    ]


@pytest.fixture
def mission_control(sample_tool_groups):
    """Create a MissionControl instance with mocked agent"""
    with patch('agent.mission_control.MissionControl._create_agent'), \
         patch('agent.mission_control.MissionControl._create_session_manager'):
        mc = MissionControl(
            session_id="test-session-123",
            user_id="test-user-456",
            tool_groups=sample_tool_groups,
            model_id="us.anthropic.claude-haiku-4-5-20251001-v1:0"
        )
        mc.agent = MagicMock()
        return mc


# ============================================================
# Test: MissionControl Initialization
# ============================================================

class TestMissionControlInit:
    """Tests for MissionControl initialization"""

    def test_creates_with_correct_session_prefix(self, mission_control):
        """Session ID is prefixed with 'mc-' for separate namespace"""
        assert mission_control.session_id == "mc-test-session-123"

    def test_stores_user_id(self, mission_control):
        """User ID is stored correctly"""
        assert mission_control.user_id == "test-user-456"

    def test_generates_mission_id(self, mission_control):
        """Generates a unique mission ID"""
        assert mission_control.mission_id is not None
        assert mission_control.mission_id.startswith("mission-")

    def test_uses_provided_tool_groups(self, mission_control, sample_tool_groups):
        """Uses provided tool groups"""
        assert mission_control.tool_groups == sample_tool_groups

    def test_uses_default_tool_groups_when_none(self):
        """Uses DEFAULT_TOOL_GROUPS when not provided"""
        with patch('agent.mission_control.MissionControl._create_agent'), \
             patch('agent.mission_control.MissionControl._create_session_manager'):
            mc = MissionControl(
                session_id="test",
                user_id="test"
            )
            assert mc.tool_groups == DEFAULT_TOOL_GROUPS


# ============================================================
# Test: Tool Groups YAML Generation
# ============================================================

class TestToolGroupsYaml:
    """Tests for build_tool_groups_yaml function"""

    def test_builds_yaml_with_all_groups(self, sample_tool_groups):
        """Generates YAML for all tool groups"""
        yaml = build_tool_groups_yaml(sample_tool_groups)

        assert "Web Search" in yaml
        assert "Document Creation" in yaml
        assert "Calculation" in yaml

    def test_includes_tools_list(self, sample_tool_groups):
        """Includes tools list for each group"""
        yaml = build_tool_groups_yaml(sample_tool_groups)

        assert "ddg_web_search" in yaml
        assert "fetch_url_content" in yaml
        assert "calculator" in yaml

    def test_includes_capabilities(self, sample_tool_groups):
        """Includes capabilities description"""
        yaml = build_tool_groups_yaml(sample_tool_groups)

        assert "Search the web" in yaml
        assert "Mathematical calculations" in yaml


# ============================================================
# Test: JSON Response Parsing
# ============================================================

class TestResponseParsing:
    """Tests for _parse_response and _extract_first_json_object"""

    def test_parses_directive_json(self, mission_control):
        """Parses valid directive JSON"""
        json_str = json.dumps({
            "type": "directive",
            "step": 1,
            "prompt": "Search for AI trends",
            "tools": ["ddg_web_search"],
            "expected_output": "Search results"
        })

        result = mission_control._parse_response(json_str)

        assert isinstance(result, Directive)
        assert result.step == 1
        assert "ddg_web_search" in result.tools

    def test_parses_mission_complete_json(self, mission_control):
        """Parses valid mission complete JSON"""
        json_str = json.dumps({
            "type": "mission_complete",
            "total_steps": 3
        })

        result = mission_control._parse_response(json_str)

        assert isinstance(result, MissionComplete)
        assert result.total_steps == 3

    def test_handles_markdown_code_block(self, mission_control):
        """Handles JSON wrapped in markdown code block"""
        response = """```json
{
    "type": "directive",
    "step": 1,
    "prompt": "Search",
    "tools": ["tool1"],
    "expected_output": "Output"
}
```"""

        result = mission_control._parse_response(response)
        assert isinstance(result, Directive)

    def test_extracts_json_from_mixed_text(self, mission_control):
        """Extracts JSON object from text with extra content"""
        response = """Here's the next step:

{
    "type": "directive",
    "step": 2,
    "prompt": "Create chart",
    "tools": ["generate_diagram"],
    "expected_output": "Chart image"
}

This will help visualize the data."""

        result = mission_control._parse_response(response)
        assert isinstance(result, Directive)
        assert result.step == 2

    def test_handles_nested_braces(self, mission_control):
        """Handles nested braces in JSON"""
        response = json.dumps({
            "type": "directive",
            "step": 1,
            "prompt": "Test with nested {braces}",
            "tools": ["tool1"],
            "expected_output": "Output"
        })

        result = mission_control._parse_response(response)
        assert isinstance(result, Directive)
        assert "{braces}" in result.prompt

    def test_raises_on_invalid_json(self, mission_control):
        """Raises ValueError on invalid JSON"""
        with pytest.raises(ValueError) as exc_info:
            mission_control._parse_response("not valid json at all")

        assert "Invalid JSON" in str(exc_info.value) or "No valid JSON" in str(exc_info.value)

    def test_raises_on_unknown_type(self, mission_control):
        """Raises ValueError on unknown response type"""
        with pytest.raises(ValueError) as exc_info:
            mission_control._parse_response('{"type": "unknown"}')

        assert "Unknown response type" in str(exc_info.value)


# ============================================================
# Test: Get Available Tools
# ============================================================

class TestGetAvailableTools:
    """Tests for get_all_available_tools method"""

    def test_returns_flat_list(self, mission_control):
        """Returns flat list of all tool IDs"""
        tools = mission_control.get_all_available_tools()

        assert isinstance(tools, list)
        assert "ddg_web_search" in tools
        assert "fetch_url_content" in tools
        assert "create_word_document" in tools
        assert "calculator" in tools

    def test_includes_all_tools_from_groups(self, mission_control):
        """Includes all tools from all groups"""
        tools = mission_control.get_all_available_tools()

        # Should have 5 tools total from our sample groups
        assert len(tools) == 5


# ============================================================
# Test: System Prompt
# ============================================================

class TestSystemPrompt:
    """Tests for system prompt generation"""

    def test_includes_tool_groups(self, mission_control):
        """System prompt includes tool groups YAML"""
        prompt = mission_control.system_prompt

        assert "Web Search" in prompt
        assert "ddg_web_search" in prompt

    def test_includes_response_format(self, mission_control):
        """System prompt includes response format instructions"""
        prompt = mission_control.system_prompt

        assert "directive" in prompt
        assert "mission_complete" in prompt

    def test_includes_current_date(self, mission_control):
        """System prompt includes current date"""
        prompt = mission_control.system_prompt

        assert "Current date:" in prompt

    def test_base_prompt_structure(self):
        """Base prompt has expected structure"""
        assert "Mission Control" in MISSION_CONTROL_SYSTEM_PROMPT
        assert "Directive" in MISSION_CONTROL_SYSTEM_PROMPT
        assert "Tool Groups" in MISSION_CONTROL_SYSTEM_PROMPT


# ============================================================
# Test: DEFAULT_TOOL_GROUPS Configuration
# ============================================================

class TestDefaultToolGroups:
    """Tests for DEFAULT_TOOL_GROUPS configuration"""

    def test_has_expected_groups(self):
        """Default config has expected tool groups"""
        group_ids = [g.id for g in DEFAULT_TOOL_GROUPS]

        # Check key groups exist
        assert "basic_web_search" in group_ids
        assert "word_documents" in group_ids
        assert "excel_spreadsheets" in group_ids
        assert "calculation" in group_ids

    def test_all_groups_have_required_fields(self):
        """All groups have required fields"""
        for group in DEFAULT_TOOL_GROUPS:
            assert group.id is not None
            assert group.name is not None
            assert group.tools is not None
            assert len(group.tools) > 0
            assert group.capabilities is not None

    def test_simple_charts_marked_for_ui_only(self):
        """Simple charts group is clearly marked as web UI only"""
        simple_charts = next(g for g in DEFAULT_TOOL_GROUPS if g.id == "simple_charts")

        assert "UI Only" in simple_charts.name or "Web UI" in simple_charts.capabilities
        assert "NOT for documents" in simple_charts.capabilities

    def test_complex_diagrams_marked_for_documents(self):
        """Complex diagrams group is marked for document embedding"""
        complex_diagrams = next(g for g in DEFAULT_TOOL_GROUPS if g.id == "complex_diagrams")

        assert "Documents" in complex_diagrams.name or "embedded" in complex_diagrams.capabilities.lower()


# ============================================================
# Test: Progress Report Processing
# ============================================================

class TestProgressReportProcessing:
    """Tests for processing progress reports"""

    @pytest.mark.asyncio
    async def test_process_report_returns_directive(self, mission_control):
        """process_report returns next directive"""
        report = ProgressReport(
            directive_id="dir-123",
            tool_calls=[
                ToolCall(name="ddg_web_search", input_summary='{"query": "AI"}')
            ],
            response_text="Found 5 sources about AI trends."
        )

        # Mock agent response
        mock_response = json.dumps({
            "type": "directive",
            "step": 2,
            "prompt": "Create charts",
            "tools": ["generate_diagram_and_validate"],
            "expected_output": "Chart images"
        })
        mission_control.agent = MagicMock(return_value=mock_response)

        result = await mission_control.process_report(report)

        assert isinstance(result, Directive)
        assert result.step == 2

    @pytest.mark.asyncio
    async def test_process_report_returns_mission_complete(self, mission_control):
        """process_report returns MissionComplete when done"""
        report = ProgressReport(
            directive_id="dir-456",
            tool_calls=[],
            response_text="Charts created successfully."
        )

        # Mock agent response
        mock_response = json.dumps({
            "type": "mission_complete",
            "total_steps": 2
        })
        mission_control.agent = MagicMock(return_value=mock_response)

        result = await mission_control.process_report(report)

        assert isinstance(result, MissionComplete)
        assert result.total_steps == 2


# ============================================================
# Test: Get First Directive
# ============================================================

class TestGetFirstDirective:
    """Tests for get_first_directive method"""

    @pytest.mark.asyncio
    async def test_returns_directive_for_complex_query(self, mission_control):
        """Returns Directive for query needing tools"""
        mock_response = json.dumps({
            "type": "directive",
            "step": 1,
            "prompt": "Search for AI market trends",
            "tools": ["ddg_web_search"],
            "expected_output": "Market statistics"
        })
        mission_control.agent = MagicMock(return_value=mock_response)

        result = await mission_control.get_first_directive("Research AI market trends and create a report")

        assert isinstance(result, Directive)
        assert result.step == 1

    @pytest.mark.asyncio
    async def test_returns_mission_complete_for_simple_query(self, mission_control):
        """Returns MissionComplete for simple query (no tools needed)"""
        mock_response = json.dumps({
            "type": "mission_complete",
            "total_steps": 0
        })
        mission_control.agent = MagicMock(return_value=mock_response)

        result = await mission_control.get_first_directive("Hello, how are you?")

        assert isinstance(result, MissionComplete)
        assert result.total_steps == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
