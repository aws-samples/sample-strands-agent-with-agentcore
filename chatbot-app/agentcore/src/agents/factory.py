"""
Agent Factory - Create appropriate agent based on request type

Centralizes agent creation logic and provides unified interface for routers.
"""

import logging
from typing import Optional, List

from agents.base import BaseAgent
from agents.chat_agent import ChatAgent
from agents.swarm_agent import SwarmAgent
from agents.workflow_agent import WorkflowAgent
# VoiceAgent imported conditionally in create_agent

logger = logging.getLogger(__name__)


def create_agent(
    request_type: Optional[str],
    session_id: str,
    user_id: Optional[str] = None,
    enabled_tools: Optional[List[str]] = None,
    model_id: Optional[str] = None,
    temperature: Optional[float] = None,
    system_prompt: Optional[str] = None,
    caching_enabled: Optional[bool] = None,
    compaction_enabled: Optional[bool] = None,
    api_keys: Optional[dict] = None,
    auth_token: Optional[str] = None,
    **kwargs
) -> BaseAgent:
    """
    Create appropriate agent based on request type

    Args:
        request_type: Type of request - "normal", "swarm", "compose", "voice"
        session_id: Session identifier
        user_id: User identifier (defaults to session_id)
        enabled_tools: List of tool IDs to enable
        model_id: Bedrock model ID to use
        temperature: Model temperature (0.0 - 1.0)
        system_prompt: System prompt text
        caching_enabled: Whether to enable prompt caching
        compaction_enabled: Whether to enable context compaction
        **kwargs: Additional agent-specific parameters

    Returns:
        BaseAgent instance (ChatAgent, SwarmAgent, WorkflowAgent, or VoiceAgent)

    Raises:
        ValueError: If request_type is not recognized

    Examples:
        # Normal text chat
        agent = create_agent("normal", session_id, user_id)

        # Multi-agent swarm
        agent = create_agent("swarm", session_id, user_id)

        # Document composition workflow
        agent = create_agent("compose", session_id, user_id)

        # Voice conversation
        agent = create_agent("voice", session_id, user_id)
    """
    # Default to normal chat if not specified
    request_type = request_type or "normal"

    logger.debug(
        f"[AgentFactory] Creating agent: type={request_type}, "
        f"session={session_id}, user={user_id or session_id}"
    )

    # Create appropriate agent based on request type
    if request_type == "normal":
        return ChatAgent(
            session_id=session_id,
            user_id=user_id,
            enabled_tools=enabled_tools,
            model_id=model_id,
            temperature=temperature,
            system_prompt=system_prompt,
            caching_enabled=caching_enabled,
            compaction_enabled=compaction_enabled,
            use_null_conversation_manager=kwargs.get("use_null_conversation_manager"),
            api_keys=api_keys,
            auth_token=auth_token,
        )

    elif request_type == "swarm":
        return SwarmAgent(
            session_id=session_id,
            user_id=user_id,
            model_id=model_id,
            max_handoffs=kwargs.get("max_handoffs", 15),
            max_iterations=kwargs.get("max_iterations", 15),
            execution_timeout=kwargs.get("execution_timeout", 600.0),
            node_timeout=kwargs.get("node_timeout", 180.0),
            api_keys=api_keys,
            auth_token=auth_token,
        )

    elif request_type == "compose":
        return WorkflowAgent(
            session_id=session_id,
            user_id=user_id,
            workflow_type="compose",
            model_id=model_id,
            temperature=temperature,
        )

    elif request_type == "voice":
        # Import VoiceAgent here to avoid circular imports
        from agent.voice_agent import VoiceAgent

        return VoiceAgent(
            session_id=session_id,
            user_id=user_id,
            enabled_tools=enabled_tools,
            system_prompt=system_prompt,
            auth_token=auth_token,
            api_keys=api_keys,
        )

    else:
        raise ValueError(
            f"Unknown request_type: {request_type}. "
            f"Valid types: normal, swarm, compose, voice"
        )


def get_agent_type_description(request_type: str) -> str:
    """
    Get human-readable description for agent type

    Args:
        request_type: Type of request

    Returns:
        Description string
    """
    descriptions = {
        "normal": "Text-based conversation with streaming",
        "swarm": "Multi-agent orchestration with specialist agents",
        "compose": "Document composition workflow",
        "voice": "Bidirectional audio streaming (Nova Sonic)",
    }

    return descriptions.get(request_type, "Unknown agent type")
