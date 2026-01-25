"""Swarm Message Store

Adapter for storing Swarm conversation turns using existing session managers
(FileSessionManager for local, CompactingSessionManager for cloud).

Uses a fixed agent_id to store user/assistant messages in the same format
as the normal agent, enabling unified session storage.
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional

from strands.types.session import Session, SessionAgent, SessionMessage
from strands.types.exceptions import SessionException

logger = logging.getLogger(__name__)

# Use default agent_id for swarm conversation storage (same as normal text messages)
SWARM_AGENT_ID = "default"


class SwarmMessageStore:
    """
    Adapter for storing Swarm messages using existing session managers.

    Reuses FileSessionManager (local) or CompactingSessionManager (cloud)
    with a fixed agent_id for unified storage.
    """

    def __init__(
        self,
        session_id: str,
        user_id: str,
        memory_id: Optional[str] = None,
        region_name: str = "us-west-2"
    ):
        """
        Initialize SwarmMessageStore with existing session manager.

        Args:
            session_id: Session identifier
            user_id: User identifier
            memory_id: AgentCore Memory ID (None for local mode)
            region_name: AWS region for cloud mode
        """
        self.session_id = session_id
        self.user_id = user_id
        self.memory_id = memory_id or os.environ.get("MEMORY_ID")
        self.region_name = region_name

        # Create session manager (reusing existing infrastructure)
        self.session_manager = self._create_session_manager()

        # Track message index for sequential storage
        self._message_index = self._get_next_message_index()

        mode = "cloud" if self.memory_id else "local"
        logger.debug(f"SwarmMessageStore: mode={mode}, session={session_id}, agent_id={SWARM_AGENT_ID}")

    def _create_session_manager(self):
        """Create appropriate session manager based on environment."""
        from pathlib import Path

        if self.memory_id:
            # Cloud mode: Use CompactingSessionManager (or AgentCoreMemorySessionManager)
            try:
                from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
                from agent.compacting_session_manager import CompactingSessionManager

                config = AgentCoreMemoryConfig(
                    memory_id=self.memory_id,
                    session_id=self.session_id,
                    actor_id=self.user_id,
                    enable_prompt_caching=False,
                    retrieval_config=None
                )

                manager = CompactingSessionManager(
                    agentcore_memory_config=config,
                    region_name=self.region_name,
                    user_id=self.user_id,
                    metrics_only=True  # No compaction for swarm messages
                )

                logger.debug(f"Using CompactingSessionManager for swarm storage")
                return manager

            except ImportError:
                logger.warning("AgentCore Memory not available, falling back to local storage")

        # Local mode: Use FileSessionManager
        from strands.session.file_session_manager import FileSessionManager

        sessions_dir = Path(__file__).parent.parent.parent / "sessions"
        sessions_dir.mkdir(exist_ok=True)

        manager = FileSessionManager(
            session_id=self.session_id,
            storage_dir=str(sessions_dir)
        )

        logger.debug(f"Using FileSessionManager for swarm storage: {sessions_dir}")
        return manager

    def _get_next_message_index(self) -> int:
        """Get the next message index by checking existing messages."""
        # For cloud mode, use session repository API
        if self.memory_id:
            try:
                existing = self.session_manager.session_repository.list_messages(
                    session_id=self.session_id,
                    agent_id=SWARM_AGENT_ID
                )
                return len(existing)
            except SessionException:
                return 0
            except Exception:
                return 0

        # For local mode, count message files directly
        from pathlib import Path

        try:
            sessions_dir = Path(__file__).parent.parent.parent / "sessions"
            messages_dir = sessions_dir / f"session_{self.session_id}" / "agents" / f"agent_{SWARM_AGENT_ID}" / "messages"

            if not messages_dir.exists():
                return 0

            # Count message_*.json files
            message_files = list(messages_dir.glob("message_*.json"))
            return len(message_files)
        except Exception:
            return 0

    def _ensure_session_and_agent_exist(self) -> None:
        """Ensure session and agent exist before saving messages.

        For local mode, writes files directly to match LocalSessionBuffer format.
        This ensures Normal mode can read Swarm messages and vice versa.
        """
        from datetime import datetime, timezone
        from pathlib import Path

        # For cloud mode, use the session repository API
        if self.memory_id:
            repo = self.session_manager.session_repository
            try:
                existing_session = repo.read_session(self.session_id)
                if existing_session is None:
                    session = Session(session_id=self.session_id)
                    repo.create_session(session)
                    logger.debug(f"[Swarm] Created session: {self.session_id}")
            except Exception as e:
                logger.debug(f"[Swarm] Session check/create: {e}")

            try:
                existing_agent = repo.read_agent(self.session_id, SWARM_AGENT_ID)
                if existing_agent is None:
                    agent = SessionAgent(agent_id=SWARM_AGENT_ID)
                    repo.create_agent(self.session_id, agent)
                    logger.debug(f"[Swarm] Created agent: {SWARM_AGENT_ID}")
            except Exception as e:
                logger.debug(f"[Swarm] Agent check/create: {e}")
            return

        # For local mode, write files directly (same as LocalSessionBuffer)
        # This ensures compatibility with Normal mode's FileSessionManager
        sessions_dir = Path(__file__).parent.parent.parent / "sessions"
        session_dir = sessions_dir / f"session_{self.session_id}"
        agent_dir = session_dir / "agents" / f"agent_{SWARM_AGENT_ID}"
        messages_dir = agent_dir / "messages"

        # Create directories
        messages_dir.mkdir(parents=True, exist_ok=True)

        now = datetime.now(timezone.utc).isoformat()

        # Create session.json if it doesn't exist
        session_file = session_dir / "session.json"
        if not session_file.exists():
            session_data = {
                "session_id": self.session_id,
                "session_type": "AGENT",
                "created_at": now,
                "updated_at": now
            }
            with open(session_file, 'w', encoding='utf-8') as f:
                json.dump(session_data, f, indent=2, ensure_ascii=False)
            logger.debug(f"[Swarm] Created session.json: {self.session_id}")

        # Create agent.json if it doesn't exist
        # Format must match what Strands SDK's FileSessionManager expects
        agent_file = agent_dir / "agent.json"
        if not agent_file.exists():
            agent_data = {
                "agent_id": SWARM_AGENT_ID,
                "state": {},
                "conversation_manager_state": {
                    "__name__": "SlidingWindowConversationManager",
                    "removed_message_count": 0,
                    "model_call_count": 0
                },
                "_internal_state": {
                    "interrupt_state": {
                        "interrupts": {},
                        "context": {},
                        "activated": False
                    }
                },
                "created_at": now,
                "updated_at": now
            }
            with open(agent_file, 'w', encoding='utf-8') as f:
                json.dump(agent_data, f, indent=2, ensure_ascii=False)
            logger.debug(f"[Swarm] Created agent.json: {SWARM_AGENT_ID}")

    def save_turn(
        self,
        user_message: str,
        content_blocks: Optional[List[Dict[str, Any]]] = None,
        swarm_state: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Save a swarm turn as properly formatted message sequence.

        Bedrock/Claude API requires:
        - toolUse blocks in assistant messages
        - toolResult blocks in user messages (separate from toolUse)

        Args:
            user_message: User's input message
            content_blocks: Ordered content blocks [text, toolUse, toolResult, text, ...]
                           Preserves exact order from streaming for proper session restore
            swarm_state: Swarm execution state (node_history, shared_context, etc.)
        """
        # Ensure session and agent exist before saving
        self._ensure_session_and_agent_exist()

        # Build message sequence from content_blocks
        # Bedrock API format:
        #   user: [text]
        #   assistant: [text, toolUse]
        #   user: [toolResult]
        #   assistant: [text, toolUse]
        #   user: [toolResult]
        #   assistant: [text]
        messages_to_save: List[Dict[str, Any]] = []

        # First user message (original query)
        messages_to_save.append({
            "role": "user",
            "content": [{"text": user_message}]
        })

        # Process content_blocks into properly formatted messages
        current_assistant_content: List[Dict[str, Any]] = []

        if content_blocks:
            for block in content_blocks:
                if "toolResult" in block:
                    # toolResult must go in a user message
                    # First, flush current assistant content if any
                    if current_assistant_content:
                        messages_to_save.append({
                            "role": "assistant",
                            "content": current_assistant_content
                        })
                        current_assistant_content = []

                    # Add toolResult as user message
                    messages_to_save.append({
                        "role": "user",
                        "content": [block]
                    })
                else:
                    # text or toolUse goes in assistant message
                    current_assistant_content.append(block)

        # Add swarm_context at the end of final assistant content
        if swarm_state:
            swarm_context = self._build_swarm_context(swarm_state)
            if swarm_context:
                current_assistant_content.append({"text": swarm_context})

        # Flush remaining assistant content
        if current_assistant_content:
            messages_to_save.append({
                "role": "assistant",
                "content": current_assistant_content
            })

        # Ensure we have more than just the user message
        if len(messages_to_save) <= 1:
            logger.warning(f"[Swarm] No assistant content to save for session={self.session_id}")
            return

        # For cloud mode, use session repository API
        if self.memory_id:
            try:
                for msg in messages_to_save:
                    session_msg = SessionMessage.from_message(msg, self._message_index)
                    self.session_manager.session_repository.create_message(
                        session_id=self.session_id,
                        agent_id=SWARM_AGENT_ID,
                        session_message=session_msg
                    )
                    self._message_index += 1

                logger.info(f"[Swarm] Saved {len(messages_to_save)} messages to cloud: session={self.session_id}")
            except Exception as e:
                logger.error(f"[Swarm] Failed to save turn to cloud: {e}", exc_info=True)
            return

        # For local mode, write files directly (same format as LocalSessionBuffer)
        # This ensures compatibility with Normal mode's FileSessionManager
        from datetime import datetime, timezone
        from pathlib import Path

        try:
            sessions_dir = Path(__file__).parent.parent.parent / "sessions"
            messages_dir = sessions_dir / f"session_{self.session_id}" / "agents" / f"agent_{SWARM_AGENT_ID}" / "messages"
            messages_dir.mkdir(parents=True, exist_ok=True)

            now = datetime.now(timezone.utc).isoformat()

            # Save all messages in sequence
            for msg in messages_to_save:
                session_dict = {
                    "message": msg,
                    "message_id": self._message_index,
                    "redact_message": None,
                    "created_at": now,
                    "updated_at": now
                }
                msg_file = messages_dir / f"message_{self._message_index}.json"
                with open(msg_file, 'w', encoding='utf-8') as f:
                    json.dump(session_dict, f, indent=2, ensure_ascii=False)
                self._message_index += 1

            logger.info(f"[Swarm] Saved {len(messages_to_save)} messages to local: session={self.session_id}")

        except Exception as e:
            logger.error(f"[Swarm] Failed to save turn to local: {e}", exc_info=True)

    def _build_swarm_context(self, swarm_state: Dict[str, Any]) -> Optional[str]:
        """Build swarm_context block from swarm execution state."""
        context_parts = []

        # Agents used (excluding coordinator/responder)
        node_history = swarm_state.get("node_history", [])
        agents_used = [n for n in node_history if n not in ("coordinator", "responder")]
        if agents_used:
            context_parts.append(f"agents_used: {agents_used}")

        # Shared context from each agent (full data for history display)
        shared_context = swarm_state.get("shared_context", {})
        for agent, data in shared_context.items():
            if agent not in ("coordinator", "responder") and data:
                data_str = json.dumps(data, ensure_ascii=False)
                context_parts.append(f"{agent}: {data_str}")

        if not context_parts:
            return None

        return "<swarm_context>\n" + "\n".join(context_parts) + "\n</swarm_context>"

    def get_history_messages(self, max_turns: int = 10) -> List[Dict[str, Any]]:
        """
        Get conversation history as Messages array for Coordinator injection.

        Args:
            max_turns: Maximum number of turns to retrieve

        Returns:
            List of message dicts for injection into coordinator.executor.messages
        """
        # For cloud mode, use session repository API
        if self.memory_id:
            try:
                session_messages = self.session_manager.session_repository.list_messages(
                    session_id=self.session_id,
                    agent_id=SWARM_AGENT_ID
                )

                if not session_messages:
                    logger.debug(f"[Swarm] No history found for session={self.session_id}")
                    return []

                messages = [sm.to_message() for sm in session_messages]

                max_messages = max_turns * 2
                if len(messages) > max_messages:
                    messages = messages[-max_messages:]

                logger.info(f"[Swarm] Loaded {len(messages)} history messages for session={self.session_id}")
                return messages

            except SessionException:
                logger.debug(f"[Swarm] No history (session/agent not created yet): session={self.session_id}")
                return []
            except Exception as e:
                logger.error(f"[Swarm] Failed to get history: {e}", exc_info=True)
                return []

        # For local mode, read files directly
        from pathlib import Path

        try:
            sessions_dir = Path(__file__).parent.parent.parent / "sessions"
            messages_dir = sessions_dir / f"session_{self.session_id}" / "agents" / f"agent_{SWARM_AGENT_ID}" / "messages"

            if not messages_dir.exists():
                logger.debug(f"[Swarm] No history found for session={self.session_id}")
                return []

            # Read all message files and sort by index
            message_files = sorted(messages_dir.glob("message_*.json"), key=lambda p: int(p.stem.split("_")[1]))

            if not message_files:
                logger.debug(f"[Swarm] No history found for session={self.session_id}")
                return []

            messages = []
            for msg_file in message_files:
                with open(msg_file, 'r', encoding='utf-8') as f:
                    msg_data = json.load(f)
                    # Extract the message dict from SessionMessage format
                    messages.append(msg_data.get("message", msg_data))

            # Limit to max_turns (each turn = user + assistant = 2 messages)
            max_messages = max_turns * 2
            if len(messages) > max_messages:
                messages = messages[-max_messages:]

            logger.info(f"[Swarm] Loaded {len(messages)} history messages for session={self.session_id}")
            return messages

        except Exception as e:
            logger.error(f"[Swarm] Failed to get history: {e}", exc_info=True)
            return []

    def has_previous_turns(self) -> bool:
        """Check if there are previous turns in this session."""
        # For cloud mode, use session repository API
        if self.memory_id:
            try:
                messages = self.session_manager.session_repository.list_messages(
                    session_id=self.session_id,
                    agent_id=SWARM_AGENT_ID,
                    limit=1
                )
                return len(messages) > 0
            except SessionException:
                return False
            except Exception:
                return False

        # For local mode, check if message files exist
        from pathlib import Path

        try:
            sessions_dir = Path(__file__).parent.parent.parent / "sessions"
            messages_dir = sessions_dir / f"session_{self.session_id}" / "agents" / f"agent_{SWARM_AGENT_ID}" / "messages"

            if not messages_dir.exists():
                return False

            # Check if any message files exist
            message_files = list(messages_dir.glob("message_*.json"))
            return len(message_files) > 0
        except Exception:
            return False


def get_swarm_message_store(
    session_id: str,
    user_id: str,
    memory_id: Optional[str] = None
) -> SwarmMessageStore:
    """
    Factory function to create SwarmMessageStore.

    Args:
        session_id: Session identifier
        user_id: User identifier
        memory_id: Optional AgentCore Memory ID

    Returns:
        Configured SwarmMessageStore instance
    """
    return SwarmMessageStore(
        session_id=session_id,
        user_id=user_id,
        memory_id=memory_id or os.environ.get("MEMORY_ID"),
        region_name=os.environ.get("AWS_REGION", "us-west-2")
    )
