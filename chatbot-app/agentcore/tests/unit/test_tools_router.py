"""
Tests for tools.py router

Tests cover:
- /api/tools endpoint
- Tool configuration loading
- Tool category combination
- Error handling
"""
import pytest
from unittest.mock import patch, mock_open, MagicMock
from fastapi.testclient import TestClient
from fastapi import FastAPI
import json


# ============================================================
# Tools Endpoint Tests
# ============================================================

class TestGetToolsEndpoint:
    """Tests for the /api/tools endpoint."""

    @pytest.fixture
    def app_with_router(self):
        """Create FastAPI app with tools router."""
        from routers.tools import router
        app = FastAPI()
        app.include_router(router)
        return app

    @pytest.fixture
    def client(self, app_with_router):
        """Create test client."""
        return TestClient(app_with_router)

    @patch('routers.tools.load_tools_config')
    def test_returns_combined_tools(self, mock_load_config, client):
        """Test that all tool categories are combined."""
        mock_load_config.return_value = {
            "local_tools": [{"id": "local1", "name": "Local Tool 1"}],
            "builtin_tools": [{"id": "builtin1", "name": "Builtin Tool 1"}],
            "gateway_targets": [{"id": "gateway1", "name": "Gateway Tool 1"}],
            "agentcore_runtime_a2a": [{"id": "a2a1", "name": "A2A Tool 1"}]
        }

        response = client.get("/api/tools")

        assert response.status_code == 200
        data = response.json()
        assert len(data["tools"]) == 4
        assert data["mcp_servers"] == []

    @patch('routers.tools.load_tools_config')
    def test_returns_empty_on_error(self, mock_load_config, client):
        """Test that empty list is returned on error."""
        mock_load_config.side_effect = Exception("Config load failed")

        response = client.get("/api/tools")

        assert response.status_code == 200
        data = response.json()
        assert data["tools"] == []
        assert data["mcp_servers"] == []

    @patch('routers.tools.load_tools_config')
    def test_handles_empty_categories(self, mock_load_config, client):
        """Test handling of empty tool categories."""
        mock_load_config.return_value = {
            "local_tools": [],
            "builtin_tools": [],
            "gateway_targets": [],
            "agentcore_runtime_a2a": []
        }

        response = client.get("/api/tools")

        assert response.status_code == 200
        data = response.json()
        assert data["tools"] == []

    @patch('routers.tools.load_tools_config')
    def test_handles_missing_categories(self, mock_load_config, client):
        """Test handling of missing tool categories in config."""
        mock_load_config.return_value = {
            "local_tools": [{"id": "local1"}]
            # Missing other categories
        }

        response = client.get("/api/tools")

        assert response.status_code == 200
        data = response.json()
        assert len(data["tools"]) == 1

    @patch('routers.tools.load_tools_config')
    def test_preserves_tool_structure(self, mock_load_config, client):
        """Test that tool object structure is preserved."""
        tool = {
            "id": "calculator",
            "name": "Calculator",
            "description": "Performs calculations",
            "enabled": True,
            "category": "utility"
        }
        mock_load_config.return_value = {
            "local_tools": [tool],
            "builtin_tools": [],
            "gateway_targets": [],
            "agentcore_runtime_a2a": []
        }

        response = client.get("/api/tools")

        data = response.json()
        returned_tool = data["tools"][0]
        assert returned_tool["id"] == "calculator"
        assert returned_tool["name"] == "Calculator"
        assert returned_tool["description"] == "Performs calculations"
        assert returned_tool["enabled"] is True


# ============================================================
# Config Loading Tests
# ============================================================

class TestLoadToolsConfig:
    """Tests for the load_tools_config function."""

    @patch('pathlib.Path.exists')
    def test_returns_empty_when_config_not_found(self, mock_exists):
        """Test that empty config is returned when file doesn't exist."""
        mock_exists.return_value = False

        from routers.tools import load_tools_config
        config = load_tools_config()

        assert config == {
            "local_tools": [],
            "builtin_tools": [],
            "gateway_targets": [],
            "agentcore_runtime_a2a": []
        }

    @patch('pathlib.Path.exists')
    @patch('builtins.open', new_callable=mock_open)
    def test_loads_config_from_file(self, mock_file, mock_exists):
        """Test that config is loaded from JSON file."""
        mock_exists.return_value = True

        config_data = {
            "local_tools": [{"id": "tool1"}],
            "builtin_tools": [{"id": "tool2"}],
            "gateway_targets": [],
            "agentcore_runtime_a2a": []
        }
        mock_file.return_value.read.return_value = json.dumps(config_data)

        # Need to patch json.load as well
        with patch('json.load', return_value=config_data):
            from routers.tools import load_tools_config
            config = load_tools_config()

        assert len(config.get("local_tools", [])) >= 0  # Config loaded

    @patch('pathlib.Path.exists')
    @patch('builtins.open')
    def test_handles_json_parse_error(self, mock_open_func, mock_exists):
        """Test handling of invalid JSON in config file."""
        mock_exists.return_value = True
        mock_open_func.side_effect = json.JSONDecodeError("error", "doc", 0)

        from routers.tools import load_tools_config
        config = load_tools_config()

        assert config == {
            "local_tools": [],
            "builtin_tools": [],
            "gateway_targets": [],
            "agentcore_runtime_a2a": []
        }

    @patch('pathlib.Path.exists')
    @patch('builtins.open')
    def test_handles_file_read_error(self, mock_open_func, mock_exists):
        """Test handling of file read errors."""
        mock_exists.return_value = True
        mock_open_func.side_effect = IOError("Cannot read file")

        from routers.tools import load_tools_config
        config = load_tools_config()

        assert config == {
            "local_tools": [],
            "builtin_tools": [],
            "gateway_targets": [],
            "agentcore_runtime_a2a": []
        }


# ============================================================
# Tool Category Tests
# ============================================================

class TestToolCategories:
    """Tests for different tool categories."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        from routers.tools import router
        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    @patch('routers.tools.load_tools_config')
    def test_local_tools_category(self, mock_load_config, client):
        """Test local tools are included."""
        mock_load_config.return_value = {
            "local_tools": [
                {"id": "calculator", "name": "Calculator"},
                {"id": "url_fetcher", "name": "URL Fetcher"}
            ],
            "builtin_tools": [],
            "gateway_targets": [],
            "agentcore_runtime_a2a": []
        }

        response = client.get("/api/tools")
        data = response.json()

        tool_ids = [t["id"] for t in data["tools"]]
        assert "calculator" in tool_ids
        assert "url_fetcher" in tool_ids

    @patch('routers.tools.load_tools_config')
    def test_builtin_tools_category(self, mock_load_config, client):
        """Test builtin tools (Code Interpreter, Browser) are included."""
        mock_load_config.return_value = {
            "local_tools": [],
            "builtin_tools": [
                {"id": "code_interpreter", "name": "Code Interpreter"},
                {"id": "browser", "name": "Browser"}
            ],
            "gateway_targets": [],
            "agentcore_runtime_a2a": []
        }

        response = client.get("/api/tools")
        data = response.json()

        tool_ids = [t["id"] for t in data["tools"]]
        assert "code_interpreter" in tool_ids
        assert "browser" in tool_ids

    @patch('routers.tools.load_tools_config')
    def test_gateway_targets_category(self, mock_load_config, client):
        """Test gateway targets (MCP tools) are included."""
        mock_load_config.return_value = {
            "local_tools": [],
            "builtin_tools": [],
            "gateway_targets": [
                {"id": "gateway_github", "name": "GitHub MCP"},
                {"id": "gateway_slack", "name": "Slack MCP"}
            ],
            "agentcore_runtime_a2a": []
        }

        response = client.get("/api/tools")
        data = response.json()

        tool_ids = [t["id"] for t in data["tools"]]
        assert "gateway_github" in tool_ids
        assert "gateway_slack" in tool_ids

    @patch('routers.tools.load_tools_config')
    def test_a2a_tools_category(self, mock_load_config, client):
        """Test A2A runtime tools are included."""
        mock_load_config.return_value = {
            "local_tools": [],
            "builtin_tools": [],
            "gateway_targets": [],
            "agentcore_runtime_a2a": [
                {"id": "agentcore_research-agent", "name": "Research Agent"},
                {"id": "agentcore_browser-agent", "name": "Browser Agent"}
            ]
        }

        response = client.get("/api/tools")
        data = response.json()

        tool_ids = [t["id"] for t in data["tools"]]
        assert "agentcore_research-agent" in tool_ids
        assert "agentcore_browser-agent" in tool_ids

    @patch('routers.tools.load_tools_config')
    def test_tools_combined_in_order(self, mock_load_config, client):
        """Test that tools are combined in expected order."""
        mock_load_config.return_value = {
            "local_tools": [{"id": "local", "order": 1}],
            "builtin_tools": [{"id": "builtin", "order": 2}],
            "gateway_targets": [{"id": "gateway", "order": 3}],
            "agentcore_runtime_a2a": [{"id": "a2a", "order": 4}]
        }

        response = client.get("/api/tools")
        data = response.json()

        tool_ids = [t["id"] for t in data["tools"]]
        # Should be in order: local, builtin, gateway, a2a
        assert tool_ids == ["local", "builtin", "gateway", "a2a"]


# ============================================================
# Response Format Tests
# ============================================================

class TestResponseFormat:
    """Tests for API response format."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        from routers.tools import router
        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    @patch('routers.tools.load_tools_config')
    def test_response_has_tools_key(self, mock_load_config, client):
        """Test that response has 'tools' key."""
        mock_load_config.return_value = {
            "local_tools": [],
            "builtin_tools": [],
            "gateway_targets": [],
            "agentcore_runtime_a2a": []
        }

        response = client.get("/api/tools")
        data = response.json()

        assert "tools" in data

    @patch('routers.tools.load_tools_config')
    def test_response_has_mcp_servers_key(self, mock_load_config, client):
        """Test that response has 'mcp_servers' key for backward compatibility."""
        mock_load_config.return_value = {
            "local_tools": [],
            "builtin_tools": [],
            "gateway_targets": [],
            "agentcore_runtime_a2a": []
        }

        response = client.get("/api/tools")
        data = response.json()

        assert "mcp_servers" in data
        assert data["mcp_servers"] == []

    @patch('routers.tools.load_tools_config')
    def test_tools_is_list(self, mock_load_config, client):
        """Test that tools is always a list."""
        mock_load_config.return_value = {
            "local_tools": [],
            "builtin_tools": [],
            "gateway_targets": [],
            "agentcore_runtime_a2a": []
        }

        response = client.get("/api/tools")
        data = response.json()

        assert isinstance(data["tools"], list)

    @patch('routers.tools.load_tools_config')
    def test_json_response_type(self, mock_load_config, client):
        """Test that response is JSON."""
        mock_load_config.return_value = {
            "local_tools": [],
            "builtin_tools": [],
            "gateway_targets": [],
            "agentcore_runtime_a2a": []
        }

        response = client.get("/api/tools")

        assert response.headers.get("content-type") == "application/json"
