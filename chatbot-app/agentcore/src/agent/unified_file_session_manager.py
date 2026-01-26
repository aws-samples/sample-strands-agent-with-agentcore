"""
Unified File Session Manager for cross-agent message sharing.

Wraps FileSessionManager to share messages across all agents while
keeping agent states separate - matching the behavior of AgentCore Memory
in cloud mode.

Storage structure (unchanged):
  session_<id>/
  └── agents/
      ├── agent_default/   (text messages + state)
      └── agent_voice/     (voice messages + state)

Behavior changes:
  - list_messages: Returns ALL messages from ALL agents (sorted by timestamp)
  - create_message: Saves to the calling agent's folder (unchanged)
  - Agent state: Stays separate per agent_id (unchanged)
"""

import json
import logging
import os
from pathlib import Path
from typing import Any, List, Optional

from strands.session.file_session_manager import FileSessionManager
from strands.types.session import SessionMessage

logger = logging.getLogger(__name__)

# File prefixes (matching FileSessionManager)
SESSION_PREFIX = "session_"
AGENT_PREFIX = "agent_"
MESSAGE_PREFIX = "message_"


class UnifiedFileSessionManager(FileSessionManager):
    """
    File session manager that shares messages across all agents.

    Overrides list_messages to return messages from ALL agents in the session,
    enabling voice-text conversation continuity in local development mode.
    """

    def list_messages(
        self,
        session_id: str,
        agent_id: str,
        limit: Optional[int] = None,
        offset: int = 0,
        **kwargs: Any
    ) -> List[SessionMessage]:
        """
        List messages from ALL agents, sorted by timestamp.

        Unlike the base FileSessionManager which only reads from the specific
        agent's folder, this returns messages from all agents to enable
        cross-agent conversation continuity.

        Args:
            session_id: Session identifier
            agent_id: Agent ID (used for logging only - all agents' messages are returned)
            limit: Maximum number of messages to return
            offset: Number of messages to skip

        Returns:
            List of SessionMessage from all agents, sorted by created_at
        """
        session_path = self._get_session_path(session_id)
        agents_path = os.path.join(session_path, "agents")

        if not os.path.exists(agents_path):
            logger.debug(f"[UnifiedFSM] No agents directory found: {agents_path}")
            return []

        all_messages: List[tuple[str, SessionMessage]] = []  # (timestamp, message)

        # Iterate through all agent directories
        for agent_dir_name in os.listdir(agents_path):
            if not agent_dir_name.startswith(AGENT_PREFIX):
                continue

            current_agent_id = agent_dir_name[len(AGENT_PREFIX):]
            messages_dir = os.path.join(agents_path, agent_dir_name, "messages")

            if not os.path.exists(messages_dir):
                continue

            # Load messages from this agent
            for filename in os.listdir(messages_dir):
                if not filename.startswith(MESSAGE_PREFIX) or not filename.endswith(".json"):
                    continue

                file_path = os.path.join(messages_dir, filename)
                try:
                    message_data = self._read_file(file_path)
                    session_message = SessionMessage.from_dict(message_data)

                    # Use created_at for sorting
                    timestamp = message_data.get("created_at", "")
                    all_messages.append((timestamp, session_message))

                except Exception as e:
                    logger.warning(f"[UnifiedFSM] Failed to read {file_path}: {e}")
                    continue

        # Sort by timestamp
        all_messages.sort(key=lambda x: x[0])

        # Extract just the messages
        sorted_messages = [msg for _, msg in all_messages]

        # Apply pagination
        if limit is not None:
            sorted_messages = sorted_messages[offset:offset + limit]
        else:
            sorted_messages = sorted_messages[offset:]

        logger.debug(f"[UnifiedFSM] Loaded {len(sorted_messages)} messages from all agents "
                    f"(requested by agent '{agent_id}')")

        return sorted_messages
