"""
Local Session Buffer Manager
Wraps FileSessionManager with buffering support for local development.
"""

import logging
import base64
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)


def encode_bytes_for_json(obj: Any) -> Any:
    """Recursively encode any bytes values in an object to base64.

    Compatible with Strands SDK's encode_bytes_values format.
    """
    if isinstance(obj, bytes):
        return {"__bytes_encoded__": True, "data": base64.b64encode(obj).decode()}
    elif isinstance(obj, dict):
        return {k: encode_bytes_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [encode_bytes_for_json(item) for item in obj]
    else:
        return obj


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
        logger.debug(f"📝 Buffered message (role={message_dict['role']}, total={len(self.pending_messages)})")

        # Periodic flush to prevent data loss
        if len(self.pending_messages) >= self.batch_size:
            logger.info(f"⏰ Batch size ({self.batch_size}) reached, flushing buffer")
            self.flush()

    def flush(self):
        """Force flush pending messages to FileSessionManager"""
        if not self.pending_messages:
            return

        logger.info(f"💾 Flushing {len(self.pending_messages)} messages to FileSessionManager")

        # Write each pending message directly to file storage
        # We bypass the base_manager.append_message() to avoid double-wrapping issues
        import os
        import json
        from datetime import datetime, timezone

        for message_dict in self.pending_messages:
            try:
                # Get the next message index
                session_dir = os.path.join(
                    self.base_manager.storage_dir,
                    f"session_{self.session_id}"
                )
                messages_dir = os.path.join(session_dir, "agents", "agent_default", "messages")
                os.makedirs(messages_dir, exist_ok=True)

                # Find next message index
                existing_files = [f for f in os.listdir(messages_dir) if f.startswith("message_") and f.endswith(".json")]
                next_index = len(existing_files)

                # Create SessionMessage-compatible structure (single wrap)
                now = datetime.now(timezone.utc).isoformat()
                session_message_dict = {
                    "message": {
                        "role": message_dict["role"],
                        "content": message_dict["content"]
                    },
                    "message_id": next_index,
                    "redact_message": None,
                    "created_at": now,
                    "updated_at": now
                }

                # Encode bytes to base64 for JSON serialization
                # (compatible with Strands SDK's encode_bytes_values format)
                encoded_message = encode_bytes_for_json(session_message_dict)

                # Write to file
                message_path = os.path.join(messages_dir, f"message_{next_index}.json")
                with open(message_path, 'w', encoding='utf-8') as f:
                    json.dump(encoded_message, f, indent=2, ensure_ascii=False)

                logger.debug(f" Written message_{next_index}.json (role={message_dict['role']})")

            except Exception as e:
                logger.error(f"Failed to write message to file: {e}")

        # Clear buffer
        self.pending_messages = []
        logger.debug(f" Buffer flushed")

    # Delegate all other methods to base manager
    def __getattr__(self, name):
        """Delegate unknown methods to base FileSessionManager"""
        return getattr(self.base_manager, name)
