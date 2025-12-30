"""
Mock Session Manager for testing without real storage.
"""
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone


class MockSessionManager:
    """
    Mock implementation of a session manager for testing.

    Stores messages in memory instead of real storage (file or AgentCore Memory).
    Tracks all operations for test verification.
    """

    def __init__(self, session_id: str = "test_session"):
        self.session_id = session_id
        self.messages: List[Dict[str, Any]] = []
        self.flush_count = 0
        self.append_count = 0
        self._pending_messages: List[Dict[str, Any]] = []

    def append_message(self, message: Dict[str, Any], agent: Any = None, **kwargs):
        """
        Append a message to the session.

        Args:
            message: Message dict with 'role' and 'content'
            agent: Agent instance (stored for verification)
        """
        self.append_count += 1

        # Normalize message format
        if isinstance(message, dict):
            if "message" in message and "role" not in message:
                # SessionMessage format - extract inner message
                actual_message = message["message"]
            else:
                actual_message = message
        else:
            # Object with .message attribute
            actual_message = getattr(message, "message", message)

        stored_message = {
            "role": actual_message.get("role"),
            "content": actual_message.get("content", []),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "agent_id": getattr(agent, "agent_id", None) if agent else None
        }

        self._pending_messages.append(stored_message)

    def flush(self):
        """Flush pending messages to storage (in-memory for mock)."""
        self.flush_count += 1
        self.messages.extend(self._pending_messages)
        self._pending_messages = []

    def get_messages(self) -> List[Dict[str, Any]]:
        """Get all stored messages (including pending)."""
        return self.messages + self._pending_messages

    def get_last_message(self) -> Optional[Dict[str, Any]]:
        """Get the most recent message."""
        all_messages = self.get_messages()
        return all_messages[-1] if all_messages else None

    def clear(self):
        """Clear all messages and reset counters."""
        self.messages = []
        self._pending_messages = []
        self.flush_count = 0
        self.append_count = 0

    def assert_message_saved(self, role: str, content_contains: str):
        """
        Assert that a message with given role and content was saved.

        Args:
            role: Expected message role ('user' or 'assistant')
            content_contains: String that should be in the message content

        Raises:
            AssertionError: If no matching message found
        """
        for msg in self.get_messages():
            if msg["role"] == role:
                content = msg.get("content", [])
                for item in content:
                    if isinstance(item, dict) and "text" in item:
                        if content_contains in item["text"]:
                            return True
        raise AssertionError(
            f"No {role} message containing '{content_contains}' found. "
            f"Messages: {self.get_messages()}"
        )

    def assert_flush_called(self, times: Optional[int] = None):
        """
        Assert that flush was called.

        Args:
            times: If provided, assert exact number of flush calls
        """
        if times is not None:
            assert self.flush_count == times, \
                f"Expected flush to be called {times} times, but was called {self.flush_count} times"
        else:
            assert self.flush_count > 0, "Expected flush to be called at least once"


class MockAgentCoreMemorySessionManager(MockSessionManager):
    """
    Mock for AgentCoreMemorySessionManager (remote/cloud mode).

    Simulates immediate persistence (no explicit flush needed).
    """

    def append_message(self, message: Dict[str, Any], agent: Any = None, **kwargs):
        """Append and immediately persist (no buffering)."""
        super().append_message(message, agent, **kwargs)
        # Immediately move to persisted messages (simulating instant save)
        self.messages.extend(self._pending_messages)
        self._pending_messages = []

    def flush(self):
        """No-op for AgentCoreMemorySessionManager (already persisted)."""
        self.flush_count += 1
        # Messages already persisted in append_message
        pass

    # Note: No 'flush' method exists on real AgentCoreMemorySessionManager
    # This mock includes it to track if code incorrectly tries to call it
