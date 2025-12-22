"""
Turn-based Session Manager Wrapper
Buffers messages within a turn and writes to AgentCore Memory only once per turn.
Reduces API calls by 75% (4 calls → 1 call per turn).
"""

import logging
from typing import Optional, Dict, Any, List
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig

logger = logging.getLogger(__name__)


class TurnBasedSessionManager:
    """
    Wrapper around AgentCoreMemorySessionManager that buffers messages
    within a turn and writes them as a single merged message.

    A "turn" consists of:
    1. User message
    2. Assistant response (text + toolUse)
    3. Tool results (toolResult)

    Instead of creating 3-4 events, we create 1 merged event per turn.
    """

    def __init__(
        self,
        agentcore_memory_config: AgentCoreMemoryConfig,
        region_name: str = "us-west-2",
        batch_size: int = 5  # Flush every N messages to prevent data loss
    ):
        self.base_manager = AgentCoreMemorySessionManager(
            agentcore_memory_config=agentcore_memory_config,
            region_name=region_name
        )

        # Turn buffer
        self.pending_messages: List[Dict[str, Any]] = []
        self.last_message_role: Optional[str] = None
        self.batch_size = batch_size
        self.cancelled = False  # Flag to stop accepting new messages

        logger.info(f"✅ TurnBasedSessionManager initialized (buffering enabled, batch_size={batch_size})")

    def _should_flush_turn(self, message: Dict[str, Any]) -> bool:
        """
        Determine if we should flush the current turn.

        Flush when:
        1. New user TEXT message arrives (not toolResult) - previous turn is complete
        2. Assistant message has only text (no toolUse) - turn is complete
        """
        role = message.get("role", "")
        content = message.get("content", [])

        # Case 1: New user TEXT message (not toolResult) starts a new turn
        if role == "user" and self.last_message_role == "assistant":
            # Check if this is a toolResult (part of current assistant turn)
            is_tool_result = any(
                isinstance(item, dict) and "toolResult" in item
                for item in content
            )
            # Only flush if this is NOT a toolResult
            if not is_tool_result:
                return True

        # Case 2: Assistant message with no toolUse means turn is complete
        if role == "assistant":
            has_tool_use = any(
                isinstance(item, dict) and "toolUse" in item
                for item in content
            )
            if not has_tool_use:
                return True

        return False

    def _merge_turn_messages(self) -> Optional[Dict[str, Any]]:
        """
        Merge all messages in the current turn into a single message.

        Returns:
            Merged message with all content blocks combined
        """
        if not self.pending_messages:
            return None

        # If only 1 message, return as-is
        if len(self.pending_messages) == 1:
            return self.pending_messages[0]

        # Safety check: ensure all messages have the same role
        roles = {msg.get("role") for msg in self.pending_messages}
        if len(roles) > 1:
            logger.error(f"⚠️  Cannot merge messages with different roles: {roles}")
            logger.error(f"   Pending messages: {[m.get('role') for m in self.pending_messages]}")
            # Return first message only to avoid corruption
            return self.pending_messages[0]

        # Merge all content blocks
        merged_content = []
        merged_role = self.pending_messages[0].get("role", "assistant")

        for msg in self.pending_messages:
            content = msg.get("content", [])
            if isinstance(content, list):
                merged_content.extend(content)

        return {
            "role": merged_role,
            "content": merged_content
        }

    def _flush_turn(self):
        """Flush pending messages as a single merged message to AgentCore Memory"""
        if not self.pending_messages:
            return

        merged_message = self._merge_turn_messages()
        if merged_message:
            # Write merged message to AgentCore Memory
            logger.info(f"💾 Flushing turn: {len(self.pending_messages)} messages → 1 merged event")

            # Call base manager's create_message directly to persist
            # We need to convert to SessionMessage format first
            from strands.types.session import SessionMessage
            from strands.types.content import Message

            # Convert merged message to Message type for base manager
            strands_message: Message = {
                "role": merged_message["role"],
                "content": merged_message["content"]
            }

            # Create a SessionMessage and persist it
            session_message = SessionMessage.from_message(strands_message, 0)
            self.base_manager.create_message(
                self.base_manager.config.session_id,
                "default",  # agent_id (not used in AgentCore Memory)
                session_message
            )

        # Clear buffer
        self.pending_messages = []

    def add_message(self, message: Dict[str, Any]):
        """
        Add a message to the turn buffer.
        Automatically flushes when turn is complete or batch size is reached.

        User text messages (not toolResults) are flushed immediately to prevent role mixing.
        """
        role = message.get("role", "")
        content = message.get("content", [])

        # Detect if this is a user text message vs toolResult
        is_tool_result = role == "user" and any(
            isinstance(item, dict) and "toolResult" in item
            for item in content
        )
        is_user_text = role == "user" and not is_tool_result

        # Check if we should flush previous turn
        if self._should_flush_turn(message):
            self._flush_turn()

        # Add message to buffer
        self.pending_messages.append(message)
        self.last_message_role = role

        logger.debug(f"📝 Buffered message (role={role}, is_tool_result={is_tool_result}, total={len(self.pending_messages)})")

        # IMPORTANT: User TEXT messages (not toolResults) are flushed immediately
        # This prevents role mixing and ensures proper conversation structure
        # toolResults are part of the assistant's turn and should be buffered
        if is_user_text:
            logger.info(f"💾 Flushing user text message immediately")
            self._flush_turn()
            return

        # Periodic flush: if buffer reaches batch_size, flush to prevent data loss
        if len(self.pending_messages) >= self.batch_size:
            logger.info(f"⏰ Batch size ({self.batch_size}) reached, flushing buffer")
            self._flush_turn()

    def flush(self):
        """Force flush any pending messages (e.g., at end of stream)"""
        self._flush_turn()

    def append_message(self, message, agent, **kwargs):
        """
        Override append_message to buffer messages instead of immediately persisting.

        This is the key method that Strands framework calls to persist messages.
        We intercept it to implement turn-based buffering.
        """
        # If cancelled, don't accept new messages
        if self.cancelled:
            logger.warning(f"🚫 Session cancelled, ignoring message (role={message.get('role')})")
            return

        from strands.types.session import SessionMessage

        # Convert Message to dict format for buffering
        message_dict = {
            "role": message.get("role"),
            "content": message.get("content", [])
        }

        # Add to buffer and check if we should flush
        self.add_message(message_dict)

        logger.debug(f"🔄 Intercepted append_message (role={message_dict['role']}, buffered={len(self.pending_messages)})")

    # Delegate all other methods to base manager
    def __getattr__(self, name):
        """Delegate unknown methods to base AgentCore session manager"""
        return getattr(self.base_manager, name)
