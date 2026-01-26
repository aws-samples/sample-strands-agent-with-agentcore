"""Memory utilities for direct message storage without agent invocation.

Provides a unified interface to save messages directly to AgentCore Memory (cloud)
or FileSessionManager (local) without triggering agent responses.
"""

import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# AgentCore Memory integration (optional, only for cloud deployment)
try:
    from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
    from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
    AGENTCORE_MEMORY_AVAILABLE = True
except ImportError:
    AGENTCORE_MEMORY_AVAILABLE = False

# Strands types (always available)
from strands.session.file_session_manager import FileSessionManager
from strands.types.session import SessionMessage


def save_user_message(
    session_id: str,
    user_id: str,
    message_text: str,
    agent_id: str = "default"
) -> bool:
    """
    Save a user message directly to memory without agent invocation.

    Automatically detects cloud vs local mode and uses appropriate storage:
    - Cloud: AgentCore Memory
    - Local: FileSessionManager

    Args:
        session_id: Session identifier
        user_id: User/actor identifier
        message_text: Message text to save
        agent_id: Agent identifier (default: "default")

    Returns:
        True if saved successfully, False otherwise
    """
    memory_id = os.environ.get('MEMORY_ID')
    is_cloud = memory_id and AGENTCORE_MEMORY_AVAILABLE

    # Create message dict (Strands SDK format)
    message = {
        "role": "user",
        "content": [{"text": message_text}]
    }

    # Create SessionMessage using from_message() factory method
    # Second parameter is index (used as message_id)
    session_message = SessionMessage.from_message(message, 0)

    if is_cloud:
        return _save_to_agentcore_memory(
            session_id, user_id, agent_id, session_message, memory_id
        )
    else:
        return _save_to_file_storage(
            session_id, agent_id, session_message
        )


def _save_to_agentcore_memory(
    session_id: str,
    user_id: str,
    agent_id: str,
    session_message: SessionMessage,
    memory_id: str
) -> bool:
    """Save message to AgentCore Memory (cloud mode)."""
    try:
        aws_region = os.environ.get('AWS_REGION', 'us-west-2')

        config = AgentCoreMemoryConfig(
            memory_id=memory_id,
            session_id=session_id,
            actor_id=user_id,
            enable_prompt_caching=False,
            retrieval_config=None
        )

        session_manager = AgentCoreMemorySessionManager(
            config=config,
            region_name=aws_region
        )

        session_manager.create_message(
            session_id=session_id,
            agent_id=agent_id,
            session_message=session_message
        )

        logger.info(f"[MemoryUtils] Message saved to AgentCore Memory")
        return True

    except Exception as e:
        logger.error(f"[MemoryUtils] Failed to save to AgentCore Memory: {e}")
        return False


def _save_to_file_storage(
    session_id: str,
    agent_id: str,
    session_message: SessionMessage
) -> bool:
    """Save message to local file storage (local mode)."""
    try:
        # Path must match agent.py: agentcore/sessions (not src/sessions)
        sessions_dir = Path(__file__).parent.parent.parent / "sessions"
        sessions_dir.mkdir(exist_ok=True)

        file_manager = FileSessionManager(
            session_id=session_id,
            storage_dir=str(sessions_dir)
        )

        file_manager.create_message(
            session_id=session_id,
            agent_id=agent_id,
            session_message=session_message
        )

        logger.info(f"[MemoryUtils] Message saved to local file storage")
        return True

    except Exception as e:
        logger.error(f"[MemoryUtils] Failed to save to local storage: {e}")
        return False
