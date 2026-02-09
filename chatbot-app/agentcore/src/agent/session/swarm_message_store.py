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

from strands.types.session import Session, SessionAgent, SessionMessage, SessionType
from strands.types.exceptions import SessionException

logger = logging.getLogger(__name__)

# Use default agent_id for swarm conversation storage (same as normal text messages)
SWARM_AGENT_ID = "default"


class SwarmMessageStore:
    """
    Adapter for storing Swarm messages using existing session managers.

    Reuses FileSessionManager (local) or CompactingSessionManager (cloud)
    with a fixed agent_id for unified storage.

    Both modes use the same session_repository API for consistency.
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
            # Cloud mode: Use CompactingSessionManager
            try:
                from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
                from agent.session.compacting_session_manager import CompactingSessionManager

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

                logger.debug("Using CompactingSessionManager for swarm storage")
                return manager

            except ImportError:
                logger.warning("AgentCore Memory not available, falling back to local storage")

        # Local mode: Use FileSessionManager
        from strands.session.file_session_manager import FileSessionManager

        sessions_dir = Path(__file__).parent.parent.parent.parent / "sessions"
        sessions_dir.mkdir(exist_ok=True)

        manager = FileSessionManager(
            session_id=self.session_id,
            storage_dir=str(sessions_dir)
        )

        logger.debug(f"Using FileSessionManager for swarm storage: {sessions_dir}")
        return manager

    @property
    def _repo(self):
        """Get session repository (works for both local and cloud modes)."""
        return self.session_manager.session_repository

    def _get_next_message_index(self) -> int:
        """Get the next message index by checking existing messages."""
        try:
            existing = self._repo.list_messages(
                session_id=self.session_id,
                agent_id=SWARM_AGENT_ID
            )
            return len(existing)
        except SessionException:
            return 0
        except Exception:
            return 0

    def _ensure_session_and_agent_exist(self) -> None:
        """Ensure session and agent exist before saving messages."""
        repo = self._repo

        # Create session if not exists
        try:
            existing_session = repo.read_session(self.session_id)
            if existing_session is None:
                session = Session(session_id=self.session_id, session_type=SessionType.AGENT)
                repo.create_session(session)
                logger.debug(f"[Swarm] Created session: {self.session_id}")
        except Exception as e:
            logger.debug(f"[Swarm] Session check/create: {e}")

        # Create agent if not exists
        try:
            existing_agent = repo.read_agent(self.session_id, SWARM_AGENT_ID)
            if existing_agent is None:
                agent = SessionAgent(agent_id=SWARM_AGENT_ID, state={}, conversation_manager_state={})
                repo.create_agent(self.session_id, agent)
                logger.debug(f"[Swarm] Created agent: {SWARM_AGENT_ID}")
        except Exception as e:
            logger.debug(f"[Swarm] Agent check/create: {e}")

    def save_artifacts(self, artifacts: Dict[str, Any]) -> None:
        """Save artifacts to agent state for history reload."""
        try:
            self._ensure_session_and_agent_exist()

            agent = self._repo.read_agent(self.session_id, SWARM_AGENT_ID)
            if agent:
                if not hasattr(agent, 'state') or agent.state is None:
                    agent.state = {}
                agent.state['artifacts'] = artifacts
                self._repo.update_agent(self.session_id, agent)
                logger.info(f"[Swarm] Saved {len(artifacts)} artifacts")
        except Exception as e:
            logger.error(f"[Swarm] Failed to save artifacts: {e}")

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
        messages_to_save = self._build_messages_to_save(user_message, content_blocks, swarm_state)

        # Ensure we have more than just the user message
        if len(messages_to_save) <= 1:
            logger.warning(f"[Swarm] No assistant content to save for session={self.session_id}")
            return

        # Save messages using session repository API (unified for local/cloud)
        try:
            for msg in messages_to_save:
                session_msg = SessionMessage.from_message(msg, self._message_index)
                self._repo.create_message(
                    session_id=self.session_id,
                    agent_id=SWARM_AGENT_ID,
                    session_message=session_msg
                )
                self._message_index += 1

            mode = "cloud" if self.memory_id else "local"
            logger.info(f"[Swarm] Saved {len(messages_to_save)} messages to {mode}: session={self.session_id}")

        except Exception as e:
            logger.error(f"[Swarm] Failed to save turn: {e}", exc_info=True)

    def _build_messages_to_save(
        self,
        user_message: str,
        content_blocks: Optional[List[Dict[str, Any]]],
        swarm_state: Optional[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Build properly formatted message sequence from content blocks.

        Bedrock API format:
          user: [text]
          assistant: [text, toolUse]
          user: [toolResult]
          assistant: [text, toolUse]
          user: [toolResult]
          assistant: [text]
        """
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

        return messages_to_save

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
        try:
            session_messages = self._repo.list_messages(
                session_id=self.session_id,
                agent_id=SWARM_AGENT_ID
            )

            if not session_messages:
                logger.debug(f"[Swarm] No history found for session={self.session_id}")
                return []

            messages = [sm.to_message() for sm in session_messages]

            # Limit to max_turns (each turn can have multiple messages)
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

    def has_previous_turns(self) -> bool:
        """Check if there are previous turns in this session."""
        try:
            messages = self._repo.list_messages(
                session_id=self.session_id,
                agent_id=SWARM_AGENT_ID,
                limit=1
            )
            return len(messages) > 0
        except SessionException:
            return False
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
