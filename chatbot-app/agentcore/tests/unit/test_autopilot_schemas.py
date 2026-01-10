"""Unit tests for Autopilot Mode schemas

Tests the Application-Level Orchestration protocol schemas:
- ToolGroup (Mission Control's tool catalog)
- Directive, MissionComplete (Mission Control → Application)
- ToolCall, ProgressReport (Application → Mission Control)
- SSE event types (MissionProgressEvent, MissionCompleteEvent)
"""

import pytest
from uuid import uuid4

# Add src to path
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from models.autopilot_schemas import (
    ToolGroup,
    Directive,
    MissionComplete,
    ToolCall,
    ProgressReport,
    MissionProgressEvent,
    MissionCompleteEvent,
    MissionControlResponse,
)


class TestToolGroup:
    """Tests for tool group schema (Mission Control's catalog)"""

    def test_tool_group_creation(self):
        """Test creating a tool group"""
        group = ToolGroup(
            id="web_search",
            name="Web Search & Scraping",
            tools=["ddg_web_search", "fetch_url_content"],
            capabilities="Search web, extract article content"
        )

        assert group.id == "web_search"
        assert group.name == "Web Search & Scraping"
        assert len(group.tools) == 2
        assert "ddg_web_search" in group.tools
        assert "fetch_url_content" in group.tools
        # Capabilities should be brief
        assert len(group.capabilities) < 100

    def test_tool_group_multiple_tools(self):
        """Test tool group with multiple tools"""
        group = ToolGroup(
            id="documents",
            name="Document Creation",
            tools=["create_word_document", "modify_word_document", "list_my_word_documents", "read_word_document"],
            capabilities="Create and modify Word documents (.docx)"
        )

        assert len(group.tools) == 4
        assert "create_word_document" in group.tools

    def test_tool_group_single_tool(self):
        """Test tool group with single tool"""
        group = ToolGroup(
            id="calculation",
            name="Calculation",
            tools=["calculator"],
            capabilities="Mathematical calculations"
        )

        assert len(group.tools) == 1
        assert group.tools[0] == "calculator"


class TestDirective:
    """Tests for Directive schema (Mission Control → Application)"""

    def test_directive_creation(self):
        """Test creating a directive"""
        directive = Directive(
            step=1,
            prompt="Search for AI market trends. Focus on 2024 statistics.",
            tools=["ddg_web_search", "fetch_url_content"],
            expected_output="Key statistics with source URLs"
        )

        assert directive.step == 1
        assert "ddg_web_search" in directive.tools
        assert directive.expected_output == "Key statistics with source URLs"
        # directive_id should be auto-generated
        assert directive.directive_id is not None
        assert len(directive.directive_id) > 0

    def test_directive_with_context(self):
        """Test directive with context from previous steps"""
        directive = Directive(
            step=2,
            prompt="Create charts visualizing the market data.",
            tools=["generate_diagram_and_validate"],
            expected_output="Market trend charts as image files",
            context_summary="Found 5 sources: AI market valued at $200B, 25% YoY growth"
        )

        assert directive.step == 2
        assert directive.context_summary is not None
        assert "200B" in directive.context_summary

    def test_directive_auto_generated_id(self):
        """Test that directive_id is auto-generated if not provided"""
        directive1 = Directive(
            step=1,
            prompt="Test prompt",
            tools=["tool1"],
            expected_output="Test output"
        )
        directive2 = Directive(
            step=1,
            prompt="Test prompt",
            tools=["tool1"],
            expected_output="Test output"
        )

        # Each directive should have a unique ID
        assert directive1.directive_id != directive2.directive_id

    def test_directive_conciseness(self):
        """Test that directive fields encourage conciseness"""
        directive = Directive(
            step=1,
            prompt="Short prompt that is 2-3 sentences.",
            tools=["tool1", "tool2"],
            expected_output="Brief expected output"
        )

        # Prompt should be reasonable length
        assert len(directive.prompt) < 500
        assert len(directive.expected_output) < 200


class TestMissionComplete:
    """Tests for MissionComplete schema"""

    def test_mission_complete_creation(self):
        """Test creating a mission complete signal"""
        complete = MissionComplete(
            mission_id="mission-123",
            total_steps=3
        )

        assert complete.mission_id == "mission-123"
        assert complete.total_steps == 3

    def test_mission_complete_zero_steps(self):
        """Test mission complete with zero steps (direct response, no tools needed)"""
        complete = MissionComplete(
            mission_id="mission-456",
            total_steps=0
        )

        assert complete.total_steps == 0


class TestToolCall:
    """Tests for ToolCall schema (tracking tool invocations)"""

    def test_tool_call_creation(self):
        """Test creating a tool call record"""
        tool_call = ToolCall(
            name="ddg_web_search",
            input_summary='{"query": "AI market trends 2024"}'
        )

        assert tool_call.name == "ddg_web_search"
        assert "AI market trends" in tool_call.input_summary

    def test_tool_call_truncated_input(self):
        """Test tool call with truncated input"""
        tool_call = ToolCall(
            name="create_word_document",
            input_summary='{"filename": "report", "content": "Long content that was truncated..."}...'
        )

        assert tool_call.name == "create_word_document"
        assert "..." in tool_call.input_summary


class TestProgressReport:
    """Tests for ProgressReport schema (Application → Mission Control)"""

    def test_progress_report_with_tool_calls(self):
        """Test creating a progress report with tool calls"""
        report = ProgressReport(
            directive_id="dir-123",
            tool_calls=[
                ToolCall(name="ddg_web_search", input_summary='{"query": "AI trends"}'),
                ToolCall(name="fetch_url_content", input_summary='{"url": "https://example.com"}')
            ],
            response_text="Found 5 relevant articles about AI market trends."
        )

        assert report.directive_id == "dir-123"
        assert len(report.tool_calls) == 2
        assert report.tool_calls[0].name == "ddg_web_search"
        assert "5 relevant articles" in report.response_text

    def test_progress_report_no_tool_calls(self):
        """Test progress report with no tool calls (text-only response)"""
        report = ProgressReport(
            directive_id="dir-456",
            tool_calls=[],
            response_text="The previous data suggests a clear trend."
        )

        assert len(report.tool_calls) == 0
        assert len(report.response_text) > 0

    def test_progress_report_defaults(self):
        """Test progress report default values"""
        report = ProgressReport(directive_id="dir-789")

        assert report.tool_calls == []
        assert report.response_text == ""


class TestMissionProgressEvent:
    """Tests for MissionProgressEvent SSE schema"""

    def test_mission_progress_event_creation(self):
        """Test creating a mission progress SSE event"""
        event = MissionProgressEvent(
            step=2,
            directive_prompt="Create charts from the collected data",
            active_tools=["generate_diagram_and_validate"]
        )

        assert event.type == "mission_progress"
        assert event.step == 2
        assert "charts" in event.directive_prompt.lower()
        assert len(event.active_tools) == 1

    def test_mission_progress_event_multiple_tools(self):
        """Test progress event with multiple active tools"""
        event = MissionProgressEvent(
            step=1,
            directive_prompt="Search for AI market trends",
            active_tools=["ddg_web_search", "fetch_url_content"]
        )

        assert len(event.active_tools) == 2


class TestMissionCompleteEvent:
    """Tests for MissionCompleteEvent SSE schema"""

    def test_mission_complete_event_creation(self):
        """Test creating a mission complete SSE event"""
        event = MissionCompleteEvent(total_steps=3)

        assert event.type == "mission_complete"
        assert event.total_steps == 3

    def test_mission_complete_event_direct_response(self):
        """Test complete event for direct response (no tools needed)"""
        event = MissionCompleteEvent(total_steps=0)

        assert event.type == "mission_complete"
        assert event.total_steps == 0


class TestMissionControlResponse:
    """Tests for MissionControlResponse wrapper schema"""

    def test_response_with_directive(self):
        """Test response containing a directive"""
        directive = Directive(
            step=1,
            prompt="Search for information",
            tools=["ddg_web_search"],
            expected_output="Search results"
        )
        response = MissionControlResponse(
            response_type="directive",
            directive=directive
        )

        assert response.response_type == "directive"
        assert response.directive is not None
        assert response.mission_complete is None

    def test_response_with_mission_complete(self):
        """Test response containing mission complete"""
        complete = MissionComplete(mission_id="m1", total_steps=3)
        response = MissionControlResponse(
            response_type="mission_complete",
            mission_complete=complete
        )

        assert response.response_type == "mission_complete"
        assert response.directive is None
        assert response.mission_complete is not None


class TestProtocolFlow:
    """Integration-style tests for the full protocol flow"""

    def test_complete_mission_flow(self):
        """Test a complete mission flow through all stages"""
        mission_id = f"mission-{uuid4().hex[:8]}"

        # === Step 1: First directive from Mission Control ===
        directive1 = Directive(
            step=1,
            prompt="Search for AI market trends and statistics.",
            tools=["ddg_web_search", "fetch_url_content"],
            expected_output="Key findings with sources"
        )

        # Step 1: Progress event sent to frontend
        progress_event1 = MissionProgressEvent(
            step=1,
            directive_prompt=directive1.prompt,
            active_tools=directive1.tools
        )
        assert progress_event1.step == 1

        # Step 1: Report back to Mission Control
        report1 = ProgressReport(
            directive_id=directive1.directive_id,
            tool_calls=[
                ToolCall(name="ddg_web_search", input_summary='{"query": "AI market"}'),
                ToolCall(name="fetch_url_content", input_summary='{"url": "..."}')
            ],
            response_text="Found 5 sources. Market valued at $200B."
        )

        # === Step 2: Second directive ===
        directive2 = Directive(
            step=2,
            prompt="Create charts visualizing the market data.",
            tools=["generate_diagram_and_validate"],
            expected_output="Market trend charts",
            context_summary="Found 5 sources. Market valued at $200B."
        )

        progress_event2 = MissionProgressEvent(
            step=2,
            directive_prompt=directive2.prompt,
            active_tools=directive2.tools
        )
        assert progress_event2.step == 2

        report2 = ProgressReport(
            directive_id=directive2.directive_id,
            tool_calls=[
                ToolCall(name="generate_diagram_and_validate", input_summary='{"title": "Market Growth"}')
            ],
            response_text="Created 2 charts showing growth trends."
        )

        # === Mission Complete ===
        complete = MissionComplete(
            mission_id=mission_id,
            total_steps=2
        )

        complete_event = MissionCompleteEvent(total_steps=2)

        # Verify flow
        assert directive1.step == 1
        assert directive2.step == 2
        assert directive2.context_summary is not None
        assert complete.total_steps == 2
        assert complete_event.type == "mission_complete"

    def test_direct_response_flow(self):
        """Test flow when no tools are needed (direct response)"""
        mission_id = f"mission-{uuid4().hex[:8]}"

        # Mission Control determines no tools needed
        complete = MissionComplete(
            mission_id=mission_id,
            total_steps=0
        )

        complete_event = MissionCompleteEvent(total_steps=0)

        assert complete.total_steps == 0
        assert complete_event.total_steps == 0


class TestCommunicationEfficiency:
    """Tests to ensure messages stay concise"""

    def test_directive_token_budget(self):
        """Test that directive stays within reasonable size"""
        directive = Directive(
            step=1,
            prompt="Search for AI market trends. Focus on 2024 growth statistics.",
            tools=["ddg_web_search", "fetch_url_content"],
            expected_output="Key statistics and source URLs",
            context_summary="Previous step found general AI information."
        )

        # Rough estimate: 1 token ~ 4 characters
        total_chars = (
            len(directive.prompt) +
            len(directive.expected_output) +
            len(directive.context_summary or "") +
            len(str(directive.tools))
        )
        estimated_tokens = total_chars / 4

        # Should be reasonable size
        assert estimated_tokens < 400, f"Directive too verbose: ~{estimated_tokens} tokens"

    def test_progress_report_token_budget(self):
        """Test that progress report stays within reasonable size"""
        report = ProgressReport(
            directive_id="d1",
            tool_calls=[
                ToolCall(name="ddg_web_search", input_summary='{"query": "AI"}'),
                ToolCall(name="fetch_url_content", input_summary='{"url": "..."}')
            ],
            response_text="Found 5 sources. Key insight: 25% YoY growth projected."
        )

        total_chars = (
            len(report.response_text) +
            sum(len(tc.name) + len(tc.input_summary) for tc in report.tool_calls)
        )
        estimated_tokens = total_chars / 4

        # Should be reasonable size
        assert estimated_tokens < 500, f"Report too verbose: ~{estimated_tokens} tokens"
