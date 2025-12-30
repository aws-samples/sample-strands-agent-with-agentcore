"""
Mock Tools for testing tool execution without real implementations.
"""
from typing import Any, Dict, Generator, List, Optional


class MockTool:
    """
    Mock tool implementation for testing.

    Returns predefined results without executing real logic.
    """

    def __init__(
        self,
        name: str,
        description: str = "Mock tool for testing",
        result: Any = None,
        should_fail: bool = False,
        error_message: str = "Mock tool error"
    ):
        self.name = name
        self.description = description
        self._result = result or f"Mock result from {name}"
        self.should_fail = should_fail
        self.error_message = error_message
        self.call_count = 0
        self.last_input = None

    @property
    def tool_name(self) -> str:
        return self.name

    @property
    def tool_spec(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }

    def __call__(self, **kwargs) -> Any:
        """Execute the tool (function-style call)."""
        self.call_count += 1
        self.last_input = kwargs

        if self.should_fail:
            raise Exception(self.error_message)

        return self._result

    def stream(
        self,
        tool_use: Dict[str, Any],
        invocation_state: Dict[str, Any],
        **kwargs
    ) -> Generator[str, None, None]:
        """Stream tool execution results."""
        self.call_count += 1
        self.last_input = tool_use.get("input", {})

        if self.should_fail:
            raise Exception(self.error_message)

        yield self._result


class MockStreamingTool(MockTool):
    """
    Mock tool that streams results in chunks.
    """

    def __init__(
        self,
        name: str,
        chunks: List[str],
        delay_between_chunks: float = 0,
        **kwargs
    ):
        super().__init__(name, **kwargs)
        self.chunks = chunks
        self.delay = delay_between_chunks

    def stream(
        self,
        tool_use: Dict[str, Any],
        invocation_state: Dict[str, Any],
        **kwargs
    ) -> Generator[str, None, None]:
        """Stream results in chunks."""
        self.call_count += 1
        self.last_input = tool_use.get("input", {})

        if self.should_fail:
            raise Exception(self.error_message)

        for chunk in self.chunks:
            yield chunk


class MockBrowserTool(MockTool):
    """
    Mock browser automation tool for testing browser-related flows.
    """

    def __init__(
        self,
        browser_session_id: str = "mock-browser-session-123",
        browser_id: str = "mock-browser-456",
        **kwargs
    ):
        super().__init__(name="browser_use_agent", **kwargs)
        self.browser_session_id = browser_session_id
        self.browser_id = browser_id

    def stream(
        self,
        tool_use: Dict[str, Any],
        invocation_state: Dict[str, Any],
        **kwargs
    ) -> Generator[Dict[str, Any], None, None]:
        """Stream browser tool events including session info."""
        self.call_count += 1
        self.last_input = tool_use.get("input", {})

        # Emit browser session detected event
        yield {
            "type": "browser_session_detected",
            "browserSessionId": self.browser_session_id,
            "browserId": self.browser_id,
            "message": "Browser session started"
        }

        # Emit some browser steps
        for i in range(3):
            yield {
                "type": "browser_step",
                "stepNumber": i + 1,
                "content": f"Step {i + 1}: Mock browser action"
            }

        # Final result
        yield f"Browser task completed: {tool_use.get('input', {}).get('task', 'unknown task')}"


class MockResearchTool(MockTool):
    """
    Mock research agent tool for testing HITL approval flows.
    """

    def __init__(self, **kwargs):
        super().__init__(name="research_agent", **kwargs)
        self.approval_requested = False
        self.approval_response = None

    def stream(
        self,
        tool_use: Dict[str, Any],
        invocation_state: Dict[str, Any],
        **kwargs
    ) -> Generator[str, None, None]:
        """Stream research results."""
        self.call_count += 1
        self.last_input = tool_use.get("input", {})

        plan = self.last_input.get("plan", "No plan provided")

        # Simulate research steps
        yield f"Starting research with plan: {plan[:50]}..."
        yield "Searching for relevant information..."
        yield "Analyzing results..."
        yield f"Research complete. Found information related to: {plan[:30]}"


def create_tool_registry(tools: List[MockTool]) -> Dict[str, MockTool]:
    """
    Create a tool registry from a list of mock tools.

    Args:
        tools: List of MockTool instances

    Returns:
        Dictionary mapping tool names to tool instances
    """
    return {tool.name: tool for tool in tools}
