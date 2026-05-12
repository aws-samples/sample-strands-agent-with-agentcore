"""
Pytest configuration for AgentCore Gateway Lambda tests
"""
import pytest


@pytest.fixture
def mock_lambda_context():
    """Create a mock Lambda context with configurable tool name."""
    class MockClientContext:
        def __init__(self, tool_name: str = 'unknown'):
            self.custom = {'bedrockAgentCoreToolName': tool_name}

    class MockContext:
        def __init__(self, tool_name: str = 'unknown'):
            self.client_context = MockClientContext(tool_name)

    return MockContext
