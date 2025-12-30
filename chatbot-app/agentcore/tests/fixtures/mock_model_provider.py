"""
Mock Model Provider for testing without real Bedrock API calls.
Simulates Bedrock streaming responses.
"""
import json
from typing import Any, AsyncGenerator, Dict, List, Optional, Sequence, Union


class MockModelProvider:
    """
    Mock implementation of a model provider for testing.

    Simulates Bedrock/Claude streaming responses without actual API calls.
    Useful for testing agent behavior, event processing, and error handling.
    """

    def __init__(self, responses: Sequence[Dict[str, Any]]):
        """
        Initialize with predefined responses.

        Args:
            responses: List of response sequences. Each response is a list of
                      streaming events that will be yielded in order.
        """
        self.responses = list(responses)
        self.index = 0
        self.call_count = 0
        self.last_messages = None
        self.last_system_prompt = None

    async def stream(
        self,
        messages: List[Dict[str, Any]],
        tool_specs: Optional[List[Dict]] = None,
        system_prompt: Optional[str] = None,
        **kwargs: Any,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Stream mock response events.

        Args:
            messages: Input messages
            tool_specs: Tool specifications (ignored in mock)
            system_prompt: System prompt (stored for verification)

        Yields:
            Streaming events matching Bedrock response format
        """
        self.call_count += 1
        self.last_messages = messages
        self.last_system_prompt = system_prompt

        if self.index >= len(self.responses):
            raise IndexError(f"No more mock responses available (called {self.call_count} times)")

        response_events = self.responses[self.index]
        for event in response_events:
            yield event

        self.index += 1

    def reset(self):
        """Reset the mock to initial state."""
        self.index = 0
        self.call_count = 0
        self.last_messages = None
        self.last_system_prompt = None

    @staticmethod
    def create_text_response(text: str) -> List[Dict[str, Any]]:
        """
        Helper to create a simple text response event sequence.

        Args:
            text: The text content to return

        Returns:
            List of events simulating a text response
        """
        return [
            {"messageStart": {"role": "assistant"}},
            {"contentBlockStart": {"start": {}}},
            {"contentBlockDelta": {"delta": {"text": text}}},
            {"contentBlockStop": {}},
            {"messageStop": {"stopReason": "end_turn"}},
        ]

    @staticmethod
    def create_tool_use_response(
        tool_name: str,
        tool_use_id: str,
        tool_input: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Helper to create a tool use response event sequence.

        Args:
            tool_name: Name of the tool to call
            tool_use_id: Unique ID for this tool use
            tool_input: Input parameters for the tool

        Returns:
            List of events simulating a tool use response
        """
        return [
            {"messageStart": {"role": "assistant"}},
            {
                "contentBlockStart": {
                    "start": {
                        "toolUse": {
                            "name": tool_name,
                            "toolUseId": tool_use_id,
                        }
                    }
                }
            },
            {
                "contentBlockDelta": {
                    "delta": {
                        "toolUse": {"input": json.dumps(tool_input)}
                    }
                }
            },
            {"contentBlockStop": {}},
            {"messageStop": {"stopReason": "tool_use"}},
        ]

    @staticmethod
    def create_streaming_text_response(chunks: List[str]) -> List[Dict[str, Any]]:
        """
        Helper to create a streaming text response with multiple chunks.

        Args:
            chunks: List of text chunks to stream

        Returns:
            List of events simulating chunked streaming
        """
        events = [
            {"messageStart": {"role": "assistant"}},
            {"contentBlockStart": {"start": {}}},
        ]
        for chunk in chunks:
            events.append({"contentBlockDelta": {"delta": {"text": chunk}}})
        events.extend([
            {"contentBlockStop": {}},
            {"messageStop": {"stopReason": "end_turn"}},
        ])
        return events

    @staticmethod
    def create_interrupted_response(partial_chunks: List[str]) -> List[Dict[str, Any]]:
        """
        Helper to create a partial response (simulating interruption).

        Args:
            partial_chunks: Text chunks before interruption

        Returns:
            List of events without completion (no messageStop)
        """
        events = [
            {"messageStart": {"role": "assistant"}},
            {"contentBlockStart": {"start": {}}},
        ]
        for chunk in partial_chunks:
            events.append({"contentBlockDelta": {"delta": {"text": chunk}}})
        # No contentBlockStop or messageStop - simulating interruption
        return events
