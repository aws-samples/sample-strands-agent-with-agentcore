"""
Pytest configuration for AgentCore Gateway Lambda tests
"""
import pytest
import sys
from pathlib import Path

# Add lambda functions to path
lambda_functions_path = Path(__file__).parent.parent / "lambda-functions"
sys.path.insert(0, str(lambda_functions_path))


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
