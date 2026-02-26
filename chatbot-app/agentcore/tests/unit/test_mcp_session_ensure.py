"""
Unit tests for MCP client session ensure_session() and skill_executor MCP path.

Tests that:
1. FilteredMCPClient.ensure_session() restarts dead sessions
2. skill_executor calls ensure_session() before MCP tool invocation
3. Session that is already active is NOT restarted
"""

import os
import json
import pytest
from unittest.mock import Mock, MagicMock, patch, PropertyMock

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))


class TestFilteredMCPClientEnsureSession:
    """Tests for FilteredMCPClient.ensure_session()"""

    def _make_client(self, session_active=False):
        """Create a FilteredMCPClient with mocked internals."""
        with patch('agent.gateway.mcp_client.get_gateway_region_from_url', return_value='us-west-2'), \
             patch('agent.gateway.mcp_client.get_sigv4_auth'):
            from agent.gateway.mcp_client import FilteredMCPClient
            client = FilteredMCPClient.__new__(FilteredMCPClient)
            client.enabled_tool_ids = []
            client.prefix = "gateway"
            client._session_started = session_active
            client.api_keys = None
            # Mock the session check and start methods
            client._is_session_active = Mock(return_value=session_active)
            client.start = Mock(return_value=client)
            return client

    def test_ensure_session_restarts_when_inactive(self):
        """ensure_session() should call start() when session is not active."""
        client = self._make_client(session_active=False)

        client.ensure_session()

        client.start.assert_called_once()
        assert client._session_started is True

    def test_ensure_session_noop_when_active(self):
        """ensure_session() should NOT restart when session is already active."""
        client = self._make_client(session_active=True)

        client.ensure_session()

        client.start.assert_not_called()

    def test_ensure_session_propagates_start_error(self):
        """ensure_session() should propagate errors from start()."""
        client = self._make_client(session_active=False)
        client.start.side_effect = Exception("Connection refused")

        with pytest.raises(Exception, match="Connection refused"):
            client.ensure_session()


class TestSkillExecutorMCPPath:
    """Tests for skill_executor calling ensure_session() on MCP tools."""

    def _make_mcp_tool(self, session_active=True):
        """Create a mock MCP tool with mcp_client."""
        tool = Mock()
        tool.tool_name = "tavily_search"
        tool.mcp_client = Mock()
        tool.mcp_client.ensure_session = Mock()
        tool.mcp_client._is_session_active = Mock(return_value=session_active)
        tool.mcp_client.call_tool_sync = Mock(return_value={
            "content": [{"text": "search results"}]
        })
        tool.mcp_tool = Mock()
        tool.mcp_tool.name = "tavily_search"
        # Mark as MCP tool (not local)
        tool._tool_func = None  # local tools have this
        return tool

    def _make_tool_context(self):
        """Create a mock ToolContext."""
        ctx = Mock()
        ctx.tool_use = {"toolUseId": "test-123"}
        ctx.invocation_state = {"session_id": "session-abc"}
        return ctx

    @patch('skill.skill_tools._registry')
    def test_execute_tool_calls_ensure_session_for_mcp(self, mock_registry):
        """_execute_tool should call ensure_session() before MCP tool invocation."""
        from skill.skill_tools import _execute_tool

        tool = self._make_mcp_tool()
        mock_registry.get_tools.return_value = [tool]
        ctx = self._make_tool_context()

        result = _execute_tool(
            tool_context=ctx,
            skill_name="tavily-search",
            tool_name="tavily_search",
            tool_input={"query": "test"},
        )

        tool.mcp_client.ensure_session.assert_called_once()
        tool.mcp_client.call_tool_sync.assert_called_once()

    @patch('skill.skill_tools._registry')
    def test_execute_tool_skips_ensure_for_local_tools(self, mock_registry):
        """_execute_tool should NOT call ensure_session for local (non-MCP) tools."""
        from skill.skill_tools import _execute_tool

        # Create a local tool (no mcp_client attribute)
        tool = Mock()
        tool.tool_name = "web_search"
        tool._tool_func = Mock(return_value="local result")
        tool._metadata = Mock()
        tool._metadata._context_param = None
        # Ensure it's NOT detected as MCP
        del tool.mcp_client
        mock_registry.get_tools.return_value = [tool]
        ctx = self._make_tool_context()

        result = _execute_tool(
            tool_context=ctx,
            skill_name="web-search",
            tool_name="web_search",
            tool_input={"query": "test"},
        )

        # Should call the local function, not mcp_client
        tool._tool_func.assert_called_once()

    @patch('skill.skill_tools._registry')
    def test_execute_tool_handles_ensure_session_failure(self, mock_registry):
        """If ensure_session fails, _execute_tool should return an error."""
        from skill.skill_tools import _execute_tool

        tool = self._make_mcp_tool()
        tool.mcp_client.ensure_session.side_effect = Exception("Cannot reconnect")
        mock_registry.get_tools.return_value = [tool]
        ctx = self._make_tool_context()

        result = _execute_tool(
            tool_context=ctx,
            skill_name="tavily-search",
            tool_name="tavily_search",
            tool_input={"query": "test"},
        )

        parsed = json.loads(result)
        assert parsed["status"] == "error"
        assert "Cannot reconnect" in parsed["error"]
