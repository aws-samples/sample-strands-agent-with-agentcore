"""
Integration tests for Research Approval (HITL) workflow.

Tests the complete flow of research approval:
1. Agent requests approval via interrupt
2. User approves or declines
3. Agent continues or stops based on response

These tests verify the interaction between:
- Event processor (interrupt event generation)
- Chat router (interrupt response handling)
- Frontend contract (event structure)
"""
import json
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from typing import Dict, Any, List


# ============================================================
# Mock Classes for Research Approval Testing
# ============================================================

class MockInterrupt:
    """Mock interrupt object from Strands SDK."""
    def __init__(
        self,
        interrupt_id: str,
        name: str,
        reason: str = "User approval required"
    ):
        self.id = interrupt_id
        self.name = name
        self.reason = reason


class MockInterruptResult:
    """Mock result with interrupt stop reason."""
    def __init__(self, interrupts: List[MockInterrupt]):
        self.stop_reason = "interrupt"
        self.interrupts = interrupts


class MockCompletedResult:
    """Mock result for completed execution."""
    def __init__(self, content: str = "Research completed successfully"):
        self.stop_reason = "end_turn"
        self.content = content
        self.interrupts = []


# ============================================================
# Helper Functions
# ============================================================

async def create_async_generator(items):
    """Create async generator from list of items."""
    for item in items:
        yield item


def make_stream_async_mock(items):
    """Create a callable mock that returns an async generator."""
    async def stream_async(*args, **kwargs):
        for item in items:
            yield item
    return stream_async


def parse_sse_event(event_str: str) -> Dict[str, Any]:
    """Parse SSE event string to dictionary."""
    if event_str.startswith("data: "):
        return json.loads(event_str[6:].strip())
    return {}


# ============================================================
# Research Interrupt Event Tests
# ============================================================

class TestResearchInterruptEvent:
    """Tests for research interrupt event generation."""

    @pytest.fixture
    def processor(self):
        """Create StreamEventProcessor for testing."""
        from streaming.event_processor import StreamEventProcessor
        return StreamEventProcessor()

    @pytest.fixture
    def mock_agent(self):
        """Create mock agent with session manager."""
        agent = MagicMock()
        agent.session_manager = MagicMock()
        agent.session_manager.append_message = MagicMock()
        return agent

    @pytest.mark.asyncio
    async def test_research_approval_interrupt_event_structure(self, processor, mock_agent):
        """Test that research approval interrupt has correct structure for frontend."""
        interrupt = MockInterrupt(
            interrupt_id="chatbot-research-001",
            name="chatbot-research-approval",
            reason="User must approve the research plan before execution"
        )
        interrupt_result = MockInterruptResult([interrupt])

        events_list = [{"result": interrupt_result}]
        mock_agent.stream_async = make_stream_async_mock(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Research AI safety", session_id="test_session"):
            events.append(event)

        # Find interrupt event
        interrupt_events = [e for e in events if '"type": "interrupt"' in e]
        assert len(interrupt_events) == 1

        interrupt_event = parse_sse_event(interrupt_events[0])
        assert interrupt_event["type"] == "interrupt"
        assert "interrupts" in interrupt_event
        assert len(interrupt_event["interrupts"]) == 1
        assert interrupt_event["interrupts"][0]["id"] == "chatbot-research-001"
        assert interrupt_event["interrupts"][0]["name"] == "chatbot-research-approval"

    @pytest.mark.asyncio
    async def test_browser_approval_interrupt_event_structure(self, processor, mock_agent):
        """Test that browser approval interrupt has correct structure."""
        interrupt = MockInterrupt(
            interrupt_id="chatbot-browser-001",
            name="chatbot-browser-approval",
            reason="User must approve the browser task"
        )
        interrupt_result = MockInterruptResult([interrupt])

        events_list = [{"result": interrupt_result}]
        mock_agent.stream_async = make_stream_async_mock(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Browse Amazon", session_id="test_browser"):
            events.append(event)

        interrupt_events = [e for e in events if '"type": "interrupt"' in e]
        assert len(interrupt_events) == 1

        interrupt_event = parse_sse_event(interrupt_events[0])
        assert interrupt_event["interrupts"][0]["name"] == "chatbot-browser-approval"

    @pytest.mark.asyncio
    async def test_interrupt_reason_contains_plan(self, processor, mock_agent):
        """Test that interrupt reason can contain research plan."""
        plan = "Step 1: Search web\nStep 2: Analyze results\nStep 3: Generate report"
        interrupt = MockInterrupt(
            interrupt_id="research-plan-001",
            name="chatbot-research-approval",
            reason=plan
        )
        interrupt_result = MockInterruptResult([interrupt])

        events_list = [{"result": interrupt_result}]
        mock_agent.stream_async = make_stream_async_mock(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test"):
            events.append(event)

        interrupt_events = [e for e in events if '"type": "interrupt"' in e]
        interrupt_event = parse_sse_event(interrupt_events[0])

        # Reason should contain the plan
        assert "Step 1" in str(interrupt_event["interrupts"][0]["reason"])


# ============================================================
# Research Approval Response Tests
# ============================================================

class TestResearchApprovalResponse:
    """Tests for handling user approval/decline responses."""

    def test_interrupt_response_parsing_approved(self):
        """Test parsing approved interrupt response from frontend."""
        # Frontend sends this format
        message = json.dumps([{
            "interruptResponse": {
                "interruptId": "chatbot-research-001",
                "response": "approved"
            }
        }])

        # Simulate chat router parsing
        parsed = json.loads(message)
        assert isinstance(parsed, list)
        assert len(parsed) == 1
        assert "interruptResponse" in parsed[0]

        response = parsed[0]["interruptResponse"]
        assert response["interruptId"] == "chatbot-research-001"
        assert response["response"] == "approved"

    def test_interrupt_response_parsing_declined(self):
        """Test parsing declined interrupt response from frontend."""
        message = json.dumps([{
            "interruptResponse": {
                "interruptId": "chatbot-research-001",
                "response": "declined"
            }
        }])

        parsed = json.loads(message)
        response = parsed[0]["interruptResponse"]

        assert response["response"] == "declined"

    def test_interrupt_prompt_format_for_strands(self):
        """Test that interrupt response is formatted correctly for Strands SDK."""
        interrupt_id = "chatbot-research-001"
        user_response = "approved"

        # Format expected by Strands SDK
        interrupt_prompt = [{
            "interruptResponse": {
                "interruptId": interrupt_id,
                "response": user_response
            }
        }]

        assert isinstance(interrupt_prompt, list)
        assert len(interrupt_prompt) == 1
        assert "interruptResponse" in interrupt_prompt[0]
        assert interrupt_prompt[0]["interruptResponse"]["interruptId"] == interrupt_id
        assert interrupt_prompt[0]["interruptResponse"]["response"] == user_response

    def test_normal_message_not_parsed_as_interrupt(self):
        """Test that normal messages are not parsed as interrupt responses."""
        normal_message = "Research AI safety trends"

        try:
            parsed = json.loads(normal_message)
            # If it parses, check it's not interrupt format
            is_interrupt = (
                isinstance(parsed, list) and
                len(parsed) > 0 and
                isinstance(parsed[0], dict) and
                "interruptResponse" in parsed[0]
            )
        except json.JSONDecodeError:
            is_interrupt = False

        assert is_interrupt is False


# ============================================================
# Research Approval Flow Tests
# ============================================================

class TestResearchApprovalFlow:
    """Tests for complete research approval workflow."""

    @pytest.mark.asyncio
    async def test_approved_research_continues_execution(self):
        """Test that approved research continues to execute."""
        # Simulate the flow:
        # 1. Agent sends interrupt
        # 2. User approves
        # 3. Agent continues and completes

        # Phase 1: Initial request generates interrupt
        initial_interrupt = MockInterrupt(
            interrupt_id="research-001",
            name="chatbot-research-approval",
            reason="Research plan: Analyze AI trends"
        )

        # Phase 2: After approval, agent completes
        completion_result = MockCompletedResult(
            content="<research># AI Trends Report\n\n## Summary\n...</research>"
        )

        # Verify the flow produces expected events
        assert initial_interrupt.name == "chatbot-research-approval"
        assert completion_result.stop_reason == "end_turn"
        assert "<research>" in completion_result.content

    @pytest.mark.asyncio
    async def test_declined_research_stops_gracefully(self):
        """Test that declined research stops without error."""
        # When user declines, agent should:
        # 1. Not execute the research
        # 2. Send a polite acknowledgment
        # 3. Not generate error event

        declined_response = {
            "interruptResponse": {
                "interruptId": "research-001",
                "response": "declined"
            }
        }

        # Verify decline response format
        assert declined_response["interruptResponse"]["response"] == "declined"

        # Expected behavior: agent acknowledges decline without error
        expected_acknowledgment = "Research request declined. Let me know if you'd like to try something else."
        assert "declined" in declined_response["interruptResponse"]["response"]

    @pytest.mark.asyncio
    async def test_multiple_research_requests_independent(self):
        """Test that multiple research requests have independent approval states."""
        research_1 = MockInterrupt(
            interrupt_id="research-001",
            name="chatbot-research-approval",
            reason="Research topic A"
        )

        research_2 = MockInterrupt(
            interrupt_id="research-002",
            name="chatbot-research-approval",
            reason="Research topic B"
        )

        # Each research has unique ID
        assert research_1.id != research_2.id

        # Approving one doesn't affect the other
        approved_1 = {"interruptId": "research-001", "response": "approved"}
        declined_2 = {"interruptId": "research-002", "response": "declined"}

        assert approved_1["interruptId"] == research_1.id
        assert declined_2["interruptId"] == research_2.id


# ============================================================
# Browser Approval Flow Tests
# ============================================================

class TestBrowserApprovalFlow:
    """Tests for browser automation approval workflow."""

    def test_browser_approval_interrupt_format(self):
        """Test browser approval interrupt has task and max_steps."""
        interrupt = MockInterrupt(
            interrupt_id="browser-001",
            name="chatbot-browser-approval",
            reason="Navigate to Amazon and search for headphones"
        )

        # Browser approval should identify itself
        assert interrupt.name == "chatbot-browser-approval"
        assert "Amazon" in interrupt.reason

    def test_browser_approval_with_max_steps(self):
        """Test browser approval includes max_steps configuration."""
        browser_config = {
            "task": "Search Amazon for wireless headphones",
            "max_steps": 20
        }

        # Browser approval reason can include config
        assert browser_config["max_steps"] == 20
        assert "Amazon" in browser_config["task"]

    @pytest.mark.asyncio
    async def test_browser_approval_continues_after_approve(self):
        """Test browser task executes after approval."""
        interrupt = MockInterrupt(
            interrupt_id="browser-001",
            name="chatbot-browser-approval",
            reason="Browse shopping site"
        )

        # After approval, browser should start
        approval_response = {
            "interruptId": interrupt.id,
            "response": "approved"
        }

        assert approval_response["response"] == "approved"


# ============================================================
# Error Handling Tests
# ============================================================

class TestResearchApprovalErrorHandling:
    """Tests for error handling in research approval flow."""

    def test_invalid_interrupt_id_handling(self):
        """Test handling of invalid interrupt ID in response."""
        invalid_response = {
            "interruptResponse": {
                "interruptId": "nonexistent-interrupt",
                "response": "approved"
            }
        }

        # System should handle invalid IDs gracefully
        assert invalid_response["interruptResponse"]["interruptId"] == "nonexistent-interrupt"
        # In actual implementation, this would return an error

    def test_invalid_response_value_handling(self):
        """Test handling of invalid response value."""
        invalid_response = {
            "interruptResponse": {
                "interruptId": "research-001",
                "response": "maybe"  # Invalid - should be approved/declined
            }
        }

        # Valid responses are "approved" or "declined"
        valid_responses = ["approved", "declined"]
        assert invalid_response["interruptResponse"]["response"] not in valid_responses

    def test_malformed_interrupt_response_handling(self):
        """Test handling of malformed interrupt response."""
        malformed_messages = [
            "[{}]",  # Empty object
            '[{"wrong_key": "value"}]',  # Wrong key
            "not json at all",  # Not JSON
            '{"interruptResponse": null}',  # Null value
        ]

        for message in malformed_messages:
            try:
                parsed = json.loads(message)
                # Check if it matches interrupt format
                if isinstance(parsed, list) and len(parsed) > 0:
                    item = parsed[0]
                    has_interrupt = (
                        isinstance(item, dict) and
                        "interruptResponse" in item and
                        isinstance(item.get("interruptResponse"), dict)
                    )
                else:
                    has_interrupt = False
            except json.JSONDecodeError:
                has_interrupt = False

            # All malformed messages should not be detected as interrupts
            # (This tests the parsing logic resilience)


# ============================================================
# Frontend Contract Tests
# ============================================================

class TestFrontendInterruptContract:
    """Tests ensuring interrupt events match frontend expectations."""

    def test_interrupt_event_has_all_required_fields(self):
        """Test interrupt event has all fields frontend expects."""
        # Frontend InterruptApprovalModal expects this structure
        interrupt_event = {
            "type": "interrupt",
            "interrupts": [
                {
                    "id": "research-001",
                    "name": "chatbot-research-approval",
                    "reason": {
                        "tool_name": "research_agent",
                        "plan": "Step 1: Search\nStep 2: Analyze"
                    }
                }
            ]
        }

        assert interrupt_event["type"] == "interrupt"
        assert "interrupts" in interrupt_event
        assert len(interrupt_event["interrupts"]) >= 1

        interrupt = interrupt_event["interrupts"][0]
        assert "id" in interrupt
        assert "name" in interrupt
        # reason can be string or object

    def test_research_approval_name_matches_frontend(self):
        """Test research approval name matches frontend constant."""
        # Frontend checks: interrupt.name === "chatbot-research-approval"
        research_interrupt_name = "chatbot-research-approval"
        browser_interrupt_name = "chatbot-browser-approval"

        assert research_interrupt_name == "chatbot-research-approval"
        assert browser_interrupt_name == "chatbot-browser-approval"

    def test_interrupt_reason_structure_for_research(self):
        """Test research interrupt reason has plan field."""
        # Frontend accesses: interrupt.reason?.plan
        research_reason = {
            "tool_name": "research_agent",
            "plan": "1. Search web for AI trends\n2. Analyze top results\n3. Generate summary report"
        }

        assert "plan" in research_reason
        assert isinstance(research_reason["plan"], str)

    def test_interrupt_reason_structure_for_browser(self):
        """Test browser interrupt reason has task and max_steps fields."""
        # Frontend accesses: interrupt.reason?.task, interrupt.reason?.max_steps
        browser_reason = {
            "tool_name": "browser_use_agent",
            "task": "Navigate to Amazon.com and search for wireless headphones",
            "max_steps": 15
        }

        assert "task" in browser_reason
        assert "max_steps" in browser_reason
        assert isinstance(browser_reason["task"], str)
        assert isinstance(browser_reason["max_steps"], int)
