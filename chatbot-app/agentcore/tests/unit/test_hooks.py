"""
Unit tests for Strands Agent Hooks

Tests:
- ResearchApprovalHook (Strands Interrupts)
- ConversationCachingHook (prompt caching)
"""
import pytest
from unittest.mock import MagicMock
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../src'))


class TestResearchApprovalHook:
    """Tests for ResearchApprovalHook using Strands Interrupts."""

    @pytest.fixture
    def mock_event(self):
        """Create mock BeforeToolCallEvent."""
        event = MagicMock(spec=['tool_use', 'interrupt', 'cancel_tool'])
        event.tool_use = {}
        event.cancel_tool = None
        return event

    def test_hook_initialization_default_app_name(self):
        """Test hook initializes with default app name."""
        from agent.hooks import ResearchApprovalHook
        hook = ResearchApprovalHook()
        assert hook.app_name == "chatbot"

    def test_hook_initialization_custom_app_name(self):
        """Test hook initializes with custom app name."""
        from agent.hooks import ResearchApprovalHook
        hook = ResearchApprovalHook(app_name="my_app")
        assert hook.app_name == "my_app"

    def test_ignores_non_a2a_tools(self, mock_event):
        """Test hook ignores non-A2A tools."""
        from agent.hooks import ResearchApprovalHook
        hook = ResearchApprovalHook()

        mock_event.tool_use = {"name": "calculator", "input": {}}
        hook.request_approval(mock_event)

        # interrupt should not be called
        mock_event.interrupt.assert_not_called()

    def test_interrupts_research_agent(self, mock_event):
        """Test hook interrupts research_agent tool."""
        from agent.hooks import ResearchApprovalHook
        hook = ResearchApprovalHook()

        mock_event.tool_use = {
            "name": "research_agent",
            "input": {"plan": "Step 1: Search\nStep 2: Analyze"}
        }
        mock_event.interrupt.return_value = "approved"

        hook.request_approval(mock_event)

        mock_event.interrupt.assert_called_once()
        call_args = mock_event.interrupt.call_args
        assert "chatbot-research-approval" in call_args[0][0]

    def test_interrupts_browser_use_agent(self, mock_event):
        """Test hook interrupts browser_use_agent tool."""
        from agent.hooks import ResearchApprovalHook
        hook = ResearchApprovalHook()

        mock_event.tool_use = {
            "name": "browser_use_agent",
            "input": {"task": "Navigate to Amazon"}
        }
        mock_event.interrupt.return_value = "approved"

        hook.request_approval(mock_event)

        mock_event.interrupt.assert_called_once()
        call_args = mock_event.interrupt.call_args
        assert "chatbot-browser-approval" in call_args[0][0]

    def test_approved_response_continues(self, mock_event):
        """Test approved response allows tool execution."""
        from agent.hooks import ResearchApprovalHook
        hook = ResearchApprovalHook()

        mock_event.tool_use = {
            "name": "research_agent",
            "input": {"plan": "Research plan"}
        }
        mock_event.interrupt.return_value = "approved"

        hook.request_approval(mock_event)

        # cancel_tool should not be set
        assert mock_event.cancel_tool is None

    def test_yes_response_continues(self, mock_event):
        """Test 'yes' response allows tool execution."""
        from agent.hooks import ResearchApprovalHook
        hook = ResearchApprovalHook()

        mock_event.tool_use = {
            "name": "research_agent",
            "input": {"plan": "Research plan"}
        }
        mock_event.interrupt.return_value = "yes"

        hook.request_approval(mock_event)

        assert mock_event.cancel_tool is None

    def test_declined_response_cancels_tool(self, mock_event):
        """Test declined response cancels tool execution."""
        from agent.hooks import ResearchApprovalHook
        hook = ResearchApprovalHook()

        mock_event.tool_use = {
            "name": "research_agent",
            "input": {"plan": "Research plan"}
        }
        mock_event.interrupt.return_value = "no"

        hook.request_approval(mock_event)

        assert mock_event.cancel_tool is not None
        assert "declined" in mock_event.cancel_tool

    def test_register_hooks_method(self):
        """Test register_hooks registers BeforeToolCallEvent callback."""
        from agent.hooks import ResearchApprovalHook
        hook = ResearchApprovalHook()

        mock_registry = MagicMock()
        hook.register_hooks(mock_registry)

        mock_registry.add_callback.assert_called_once()
        call_args = mock_registry.add_callback.call_args
        assert call_args[0][1] == hook.request_approval

    def test_interrupt_reason_contains_plan(self, mock_event):
        """Test interrupt reason includes research plan."""
        from agent.hooks import ResearchApprovalHook
        hook = ResearchApprovalHook()

        plan = "Step 1: Search\nStep 2: Analyze\nStep 3: Report"
        mock_event.tool_use = {
            "name": "research_agent",
            "input": {"plan": plan}
        }
        mock_event.interrupt.return_value = "approved"

        hook.request_approval(mock_event)

        call_args = mock_event.interrupt.call_args
        reason = call_args[1]["reason"]
        assert reason["plan"] == plan

    def test_interrupt_reason_contains_task(self, mock_event):
        """Test interrupt reason includes browser task."""
        from agent.hooks import ResearchApprovalHook
        hook = ResearchApprovalHook()

        task = "Navigate to Amazon and search for headphones"
        mock_event.tool_use = {
            "name": "browser_use_agent",
            "input": {"task": task}
        }
        mock_event.interrupt.return_value = "approved"

        hook.request_approval(mock_event)

        call_args = mock_event.interrupt.call_args
        reason = call_args[1]["reason"]
        assert reason["task"] == task
