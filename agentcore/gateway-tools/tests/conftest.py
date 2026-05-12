"""
Pytest configuration for AgentCore Gateway Lambda tests
"""
import importlib.util
import sys
import pytest
from pathlib import Path

LAMBDA_BASE = Path(__file__).parent.parent / "lambda-functions"


def load_lambda(name: str):
    """Load a lambda_function module by function name, bypassing sys.modules cache."""
    path = LAMBDA_BASE / name / "lambda_function.py"
    spec = importlib.util.spec_from_file_location(f"lambda_function_{name}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(autouse=True)
def clear_lambda_function_cache():
    """Remove cached lambda_function from sys.modules before each test so that
    each test file can load the correct lambda independently."""
    sys.modules.pop("lambda_function", None)
    yield
    sys.modules.pop("lambda_function", None)


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
