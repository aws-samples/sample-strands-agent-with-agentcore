"""
Shared pytest fixtures for agentcore tests.

Provides common mocks and utilities used across unit and integration tests.
"""
import os
import sys
import pytest
from unittest.mock import MagicMock, AsyncMock

# Add src to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../src'))


@pytest.fixture
def mock_aws_env(monkeypatch):
    """Set up mock AWS environment variables."""
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SECURITY_TOKEN", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")


@pytest.fixture
def mock_session_manager():
    """Create a mock session manager for testing."""
    from tests.fixtures.mock_session_manager import MockSessionManager
    return MockSessionManager()


@pytest.fixture
def mock_agentcore_session_manager():
    """Create a mock AgentCore Memory session manager."""
    from tests.fixtures.mock_session_manager import MockAgentCoreMemorySessionManager
    return MockAgentCoreMemorySessionManager()


@pytest.fixture
def mock_agent():
    """Create a mock agent for testing."""
    agent = MagicMock()
    agent.agent_id = "test_agent"
    agent.session_manager = MagicMock()
    agent.session_manager.append_message = MagicMock()
    agent.session_manager.flush = MagicMock()
    return agent


@pytest.fixture
def mock_strands_agent():
    """Create a mock Strands SDK agent (uses _session_manager)."""
    agent = MagicMock(spec=[])
    agent._session_manager = MagicMock()
    agent._session_manager.append_message = MagicMock()
    return agent


@pytest.fixture
def async_generator():
    """Helper to create async generators for testing."""
    async def create_generator(items):
        for item in items:
            yield item
    return create_generator


@pytest.fixture
def mock_tool():
    """Create a basic mock tool."""
    from tests.fixtures.mock_tools import MockTool
    return MockTool(name="test_tool")


@pytest.fixture
def mock_streaming_tool():
    """Create a mock streaming tool."""
    from tests.fixtures.mock_tools import MockStreamingTool
    return MockStreamingTool(
        name="streaming_tool",
        chunks=["chunk1", "chunk2", "chunk3"]
    )


@pytest.fixture
def mock_browser_tool():
    """Create a mock browser tool."""
    from tests.fixtures.mock_tools import MockBrowserTool
    return MockBrowserTool()


@pytest.fixture
def sample_assistant_message():
    """Sample assistant message for testing."""
    return {
        "role": "assistant",
        "content": [{"text": "Hello, I'm here to help!"}]
    }


@pytest.fixture
def sample_user_message():
    """Sample user message for testing."""
    return {
        "role": "user",
        "content": [{"text": "Hello, can you help me?"}]
    }


@pytest.fixture
def sample_tool_use_message():
    """Sample tool use message for testing."""
    return {
        "role": "assistant",
        "content": [
            {"text": "Let me search for that."},
            {
                "toolUse": {
                    "toolUseId": "tool_123",
                    "name": "search_tool",
                    "input": {"query": "test query"}
                }
            }
        ]
    }


@pytest.fixture
def sample_tool_result_message():
    """Sample tool result message for testing."""
    return {
        "role": "user",
        "content": [
            {
                "toolResult": {
                    "toolUseId": "tool_123",
                    "content": [{"text": "Search results: found 3 items"}],
                    "status": "success"
                }
            }
        ]
    }
