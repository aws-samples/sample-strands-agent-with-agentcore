"""Factory module for creating agents and session managers."""

from agent.factory.session_manager_factory import (
    create_session_manager,
    create_compacting_session_manager,
    create_local_session_manager,
    AGENTCORE_MEMORY_AVAILABLE,
)

__all__ = [
    "create_session_manager",
    "create_compacting_session_manager",
    "create_local_session_manager",
    "AGENTCORE_MEMORY_AVAILABLE",
]
