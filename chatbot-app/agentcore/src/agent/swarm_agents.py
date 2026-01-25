"""Swarm Agent Definitions

This module provides:
- create_swarm_agents(): Creates all specialist agents for the Swarm
- create_chatbot_swarm(): Factory function to create a configured Swarm instance
"""

import logging
import os
from pathlib import Path
from typing import Dict, List, Optional

from strands import Agent
from strands.models import BedrockModel
from strands.multiagent import Swarm

from agent.swarm_config import (
    AGENT_TOOL_MAPPING,
    AGENT_DESCRIPTIONS,
    build_agent_system_prompt,
)
from agent.tool_filter import filter_tools

logger = logging.getLogger(__name__)


def get_tools_for_agent(agent_name: str) -> List:
    """Get all tools assigned to a specific agent.

    Swarm mode uses ALL tools assigned to each agent without user filtering.
    Each agent has a predefined set of tools based on their specialty.

    Args:
        agent_name: Name of the agent (must be in AGENT_TOOL_MAPPING)

    Returns:
        List of tool objects for the agent
    """
    # Get tools assigned to this agent
    agent_tool_ids = AGENT_TOOL_MAPPING.get(agent_name, [])

    if not agent_tool_ids:
        return []

    # Use the unified tool filter to get actual tool objects
    # No user filtering - Swarm agents get ALL their assigned tools
    result = filter_tools(
        enabled_tool_ids=agent_tool_ids,
        log_prefix=f"[Swarm:{agent_name}]"
    )

    return result.tools


def create_swarm_agents(
    session_id: str,
    user_id: str,
    enabled_tools: Optional[List[str]] = None,
    model_id: Optional[str] = None,
    coordinator_model_id: Optional[str] = None,
) -> Dict[str, Agent]:
    """Create all specialist agents for the Swarm.

    Args:
        session_id: Session identifier
        user_id: User identifier
        enabled_tools: Optional list of user-enabled tool IDs
        model_id: Model ID for specialist agents (default: Claude Sonnet)
        coordinator_model_id: Model ID for coordinator (default: Claude Haiku)

    Returns:
        Dictionary mapping agent name to Agent instance
    """
    from botocore.config import Config

    region = os.environ.get("AWS_REGION", "us-west-2")

    # Default models
    default_model_id = model_id or "us.anthropic.claude-sonnet-4-20250514-v1:0"
    default_coordinator_model_id = coordinator_model_id or "us.anthropic.claude-haiku-4-5-20251001-v1:0"

    # Retry configuration
    retry_config = Config(
        retries={"max_attempts": 5, "mode": "adaptive"},
        connect_timeout=30,
        read_timeout=180,
    )

    # Create models
    main_model = BedrockModel(
        model_id=default_model_id,
        temperature=0.7,
        boto_client_config=retry_config,
    )

    coordinator_model = BedrockModel(
        model_id=default_coordinator_model_id,
        temperature=0.3,  # Lower temperature for routing decisions
        boto_client_config=retry_config,
    )

    agents: Dict[str, Agent] = {}

    # Agent configurations: (name, model, use_tools)
    agent_configs = [
        ("coordinator", coordinator_model, False),
        ("web_researcher", main_model, True),
        ("academic_researcher", main_model, True),
        ("word_agent", main_model, True),
        ("excel_agent", main_model, True),
        ("powerpoint_agent", main_model, True),
        ("data_analyst", main_model, True),
        ("browser_agent", main_model, True),
        ("weather_agent", main_model, True),
        ("finance_agent", main_model, True),
        ("maps_agent", main_model, True),
        ("responder", main_model, False),  # Final response - no tools
    ]

    for agent_name, model, use_tools in agent_configs:
        # Get tools if this agent uses them
        tools = []
        if use_tools:
            tools = get_tools_for_agent(agent_name)
            # Log tool loading details for debugging
            expected_tools = AGENT_TOOL_MAPPING.get(agent_name, [])
            if expected_tools and not tools:
                logger.warning(
                    f"[Swarm] Agent '{agent_name}' expected tools {expected_tools} "
                    f"but got 0 tools. Check if gateway tools are connected."
                )

        # Build system prompt
        system_prompt = build_agent_system_prompt(agent_name)

        # Create agent
        agents[agent_name] = Agent(
            name=agent_name,
            description=AGENT_DESCRIPTIONS.get(agent_name, ""),
            model=model,
            system_prompt=system_prompt,
            tools=tools,
        )

        tool_count = len(tools) if tools else 0
        logger.debug(f"[Swarm] Created agent '{agent_name}' with {tool_count} tools")

    logger.info(f"[Swarm] Created {len(agents)} agents for session {session_id}")

    return agents


def create_chatbot_swarm(
    session_id: str,
    user_id: str,
    enabled_tools: Optional[List[str]] = None,
    model_id: Optional[str] = None,
    coordinator_model_id: Optional[str] = None,
    max_handoffs: int = 15,
    max_iterations: int = 15,
    execution_timeout: float = 600.0,
    node_timeout: float = 180.0,
) -> Swarm:
    """Create a configured Swarm instance for the chatbot.

    Args:
        session_id: Session identifier
        user_id: User identifier
        enabled_tools: Optional list of user-enabled tool IDs
        model_id: Model ID for specialist agents
        coordinator_model_id: Model ID for coordinator agent
        max_handoffs: Maximum agent handoffs allowed (default: 15)
        max_iterations: Maximum node executions (default: 15)
        execution_timeout: Total execution timeout in seconds (default: 600)
        node_timeout: Individual node timeout in seconds (default: 180)

    Returns:
        Configured Swarm instance
    """
    # Create all agents
    agents = create_swarm_agents(
        session_id=session_id,
        user_id=user_id,
        enabled_tools=enabled_tools,
        model_id=model_id,
        coordinator_model_id=coordinator_model_id,
    )

    # NOTE: Not using session_manager for Swarm to avoid state persistence issues.
    # The SDK's FileSessionManager can cause 'NoneType' has no attribute 'node_id' error
    # when deserializing completed state (next_nodes_to_execute: []) and resuming.
    # Each Swarm invocation should be independent without persisting across requests.

    # Create Swarm with coordinator as entry point
    swarm = Swarm(
        nodes=list(agents.values()),
        entry_point=agents["coordinator"],
        session_manager=None,  # Disabled to avoid state persistence bugs
        max_handoffs=max_handoffs,
        max_iterations=max_iterations,
        execution_timeout=execution_timeout,
        node_timeout=node_timeout,
        # Detect ping-pong patterns (same agents passing back and forth)
        repetitive_handoff_detection_window=6,
        repetitive_handoff_min_unique_agents=2,
    )

    # Remove handoff_to_agent from responder - it should NEVER hand off
    # Responder is the final agent that generates user-facing response
    responder_node = swarm.nodes.get("responder")
    if responder_node and hasattr(responder_node, "executor"):
        tool_registry = responder_node.executor.tool_registry
        if hasattr(tool_registry, "registry") and "handoff_to_agent" in tool_registry.registry:
            del tool_registry.registry["handoff_to_agent"]
            logger.debug("[Swarm] Removed handoff_to_agent from responder")

    logger.debug(
        f"[Swarm] Created Swarm for session {session_id}: "
        f"max_handoffs={max_handoffs}, timeout={execution_timeout}s"
    )

    return swarm
