"""
Local Session Buffer Manager
Wraps FileSessionManager with buffering support for local development.
"""

import logging
import os
from typing import Dict, Any, List

from strands.types.session import SessionMessage

logger = logging.getLogger(__name__)


class LocalSessionBuffer:
    """
    Wrapper around FileSessionManager that adds buffering for batch writes.
    For local development only.
    """

    def __init__(
        self,
        base_manager,
        session_id: str,
        batch_size: int = 5
    ):
        self.base_manager = base_manager
        self.session_id = session_id
        self.batch_size = batch_size
        self.pending_messages: List[Dict[str, Any]] = []
        self._last_agent = None  # Store agent reference for flush

        logger.debug(f" LocalSessionBuffer initialized (batch_size={batch_size})")

    def append_message(self, message, agent, **kwargs):
        """
        Override append_message to buffer messages.
        """
        # Store agent reference for flush
        if agent:
            self._last_agent = agent

        # Extract actual message content
        # Handle different message formats:
        # 1. Plain dict: {"role": "...", "content": [...]}
        # 2. SessionMessage object: has .message attribute containing the actual message
        # 3. Dict with message key: {"message": {"role": "...", "content": [...]}}
        actual_message = message

        # If it's a SessionMessage object, extract the message
        if hasattr(message, 'message'):
            actual_message = message.message
        # If it's a dict with 'message' key, extract it
        elif isinstance(message, dict) and 'message' in message and 'role' not in message:
            actual_message = message['message']

        # Get role - try both dict access and attribute access
        if isinstance(actual_message, dict):
            role = actual_message.get('role')
        else:
            role = getattr(actual_message, 'role', None)

        # Convert Message to dict format for buffering
        content = actual_message.get('content', []) if isinstance(actual_message, dict) else getattr(actual_message, 'content', [])
        message_dict = {
            "role": role,
            "content": content
        }

        # Add to buffer
        self.pending_messages.append(message_dict)
        logger.debug(f"Buffered message (role={message_dict['role']}, total={len(self.pending_messages)})")

        # Periodic flush to prevent data loss
        if len(self.pending_messages) >= self.batch_size:
            logger.info(f"Batch size ({self.batch_size}) reached, flushing buffer")
            self.flush()

    def flush(self):
        """Force flush pending messages to FileSessionManager."""
        if not self.pending_messages:
            return

        logger.info(f"Flushing {len(self.pending_messages)} messages to FileSessionManager")

        agent_id = getattr(self._last_agent, 'agent_id', None)
        if not isinstance(agent_id, str):
            agent_id = "default"

        # Count existing messages for next index
        messages_dir = os.path.join(
            self.base_manager.storage_dir,
            f"session_{self.session_id}",
            "agents", f"agent_{agent_id}", "messages"
        )
        if os.path.exists(messages_dir):
            existing_files = [f for f in os.listdir(messages_dir) if f.startswith("message_") and f.endswith(".json")]
            next_index = len(existing_files)
        else:
            next_index = 0

        for message_dict in self.pending_messages:
            try:
                session_message = SessionMessage.from_message(message_dict, next_index)
                self.base_manager.create_message(self.session_id, agent_id, session_message)
                logger.debug(f"Written message_{next_index} (role={message_dict['role']})")
                next_index += 1
            except Exception as e:
                logger.error(f"Failed to write message: {e}")

        self.pending_messages = []
        logger.debug("Buffer flushed")

    # Delegate all other methods to base manager
    def __getattr__(self, name):
        """Delegate unknown methods to base FileSessionManager"""
        return getattr(self.base_manager, name)
