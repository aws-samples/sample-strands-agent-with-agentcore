"""SwarmAgent - Multi-agent orchestration using Strands Swarm

Orchestrates specialist agents via Swarm pattern. All multiagent events are
flattened into standard tool_use/tool_result/response events so the frontend
handles them identically to a single agent.

Unlike ChatAgent, SwarmAgent:
- Does NOT use session_manager for agent state (to avoid SDK bugs)
- Does NOT filter tools by user preference (each agent has fixed tools)
- DOES save conversation history to unified storage for cross-mode sharing
"""

import logging
import os
import asyncio
import json
import copy
from typing import Dict, List, Optional, AsyncGenerator, Any
from pathlib import Path

from strands import Agent
from strands.models import BedrockModel
from strands.multiagent import Swarm
from botocore.config import Config
from fastapi import Request

from agents.base import BaseAgent
from agent.config.swarm_config import (
    AGENT_TOOL_MAPPING,
    AGENT_DESCRIPTIONS,
    build_agent_system_prompt,
)
from agent.tool_filter import filter_tools

logger = logging.getLogger(__name__)


class SwarmAgent(BaseAgent):
    """
    Multi-agent orchestration agent using Strands Swarm pattern.

    Swarm mode features:
    - Coordinator routes tasks to specialist agents
    - Specialists hand off to each other autonomously
    - Responder generates final user-facing response
    - All agents share context via SDK's shared_context
    - No session manager for agent state (SDK limitation)
    - Conversation history saved to unified storage
    """

    def __init__(
        self,
        session_id: str,
        user_id: Optional[str] = None,
        model_id: Optional[str] = None,
        coordinator_model_id: Optional[str] = None,
        max_handoffs: int = 15,
        max_iterations: int = 15,
        execution_timeout: float = 600.0,
        node_timeout: float = 180.0,
        api_keys: Optional[dict] = None,
        auth_token: Optional[str] = None,
    ):
        """
        Initialize SwarmAgent with swarm configuration
        """
        self.coordinator_model_id = coordinator_model_id or "us.anthropic.claude-haiku-4-5-20251001-v1:0"
        self.max_handoffs = max_handoffs
        self.max_iterations = max_iterations
        self.execution_timeout = execution_timeout
        self.node_timeout = node_timeout
        self.api_keys = api_keys or {}
        self.auth_token = auth_token

        # Initialize base class (will call _load_tools, _build_system_prompt, _create_session_manager)
        # Note: enabled_tools is None - swarm agents use predefined tool sets
        super().__init__(
            session_id=session_id,
            user_id=user_id,
            enabled_tools=None,  # Swarm agents use AGENT_TOOL_MAPPING
            model_id=model_id,
            temperature=0.7,
            system_prompt=None,  # Not used by swarm
            caching_enabled=False,  # Not used by swarm
            compaction_enabled=False,  # Not used by swarm
            auth_token=auth_token,  # For MCP Runtime 3LO tools (Gmail, Notion)
        )

        # Create swarm with specialist agents
        self.swarm = self._create_swarm()

        # Message store for unified storage (same format as normal agent)
        self.message_store = self._create_message_store()

        logger.debug(
            f"[SwarmAgent] Initialized: session={session_id}, "
            f"max_handoffs={max_handoffs}, timeout={execution_timeout}s"
        )

    def _get_default_model_id(self) -> str:
        """Get default model ID for specialist agents"""
        return "us.anthropic.claude-sonnet-4-5-20250929-v1:0"

    def _load_tools(self) -> List:
        """
        Skip tool loading in base class.

        Swarm agents load their own tools based on AGENT_TOOL_MAPPING.
        This prevents the base class from loading tools.
        """
        return []

    def _build_system_prompt(self) -> str:
        """
        Skip system prompt building in base class.

        Swarm agents build their own prompts using build_agent_system_prompt().
        """
        return ""

    def _create_session_manager(self) -> Any:
        """
        Return None for swarm mode.

        SDK Swarm has bugs with session_manager state persistence:
        - FileSessionManager causes 'NoneType' has no attribute 'node_id' error
        - State deserialization fails when resuming completed state

        Instead, we use UnifiedFileSessionManager via message_store for history.
        """
        return None

    def _create_message_store(self) -> Any:
        """Create message store for conversation history"""
        from agent.session.swarm_message_store import get_swarm_message_store

        return get_swarm_message_store(
            session_id=self.session_id,
            user_id=self.user_id
        )

    def _create_swarm_agents(self) -> Dict[str, Agent]:
        """
        Create all specialist agents for the Swarm.

        Each agent gets:
        - Predefined tool set from AGENT_TOOL_MAPPING
        - Role-specific system prompt
        - Appropriate model (coordinator uses Haiku, others use Sonnet)

        Returns:
            Dictionary mapping agent name to Agent instance
        """
        region = os.environ.get("AWS_REGION", "us-west-2")

        # Retry configuration
        retry_config = Config(
            retries={"max_attempts": 5, "mode": "adaptive"},
            connect_timeout=30,
            read_timeout=180,
        )

        # Create models
        main_model = BedrockModel(
            model_id=self.model_id,
            temperature=0.7,
            boto_client_config=retry_config,
        )

        coordinator_model = BedrockModel(
            model_id=self.coordinator_model_id,
            temperature=0.3,  # Lower temperature for routing decisions
            boto_client_config=retry_config,
        )

        # Responder needs higher max_tokens to handle large context + tool results
        responder_model = BedrockModel(
            model_id=self.model_id,
            temperature=0.7,
            max_tokens=4096,
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
            ("google_workspace_agent", main_model, True),
            ("notion_agent", main_model, True),
            ("responder", responder_model, True),  # Higher max_tokens for final response
        ]

        for agent_name, model, use_tools in agent_configs:
            # Get tools if this agent uses them
            tools = []
            if use_tools:
                tools = get_tools_for_agent(agent_name, auth_token=self.auth_token)
                # Log tool loading details for debugging
                expected_tools = AGENT_TOOL_MAPPING.get(agent_name, [])
                if expected_tools and not tools:
                    logger.warning(
                        f"[SwarmAgent] Agent '{agent_name}' expected tools {expected_tools} "
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
            logger.debug(f"[SwarmAgent] Created agent '{agent_name}' with {tool_count} tools")

        logger.info(f"[SwarmAgent] Created {len(agents)} agents for session {self.session_id}")

        return agents

    def _create_swarm(self) -> Swarm:
        """
        Create a configured Swarm instance.

        Swarm configuration:
        - Entry point: coordinator (analyzes and routes tasks)
        - Session manager: None (to avoid SDK bugs)
        - Handoff detection: prevents ping-pong patterns
        - Responder: Final agent with handoff_to_agent removed

        Returns:
            Configured Swarm instance
        """
        # Create all agents
        agents = self._create_swarm_agents()

        # Create Swarm with coordinator as entry point
        swarm = Swarm(
            nodes=list(agents.values()),
            entry_point=agents["coordinator"],
            session_manager=None,  # Disabled to avoid state persistence bugs
            max_handoffs=self.max_handoffs,
            max_iterations=self.max_iterations,
            execution_timeout=self.execution_timeout,
            node_timeout=self.node_timeout,
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
                logger.debug("[SwarmAgent] Removed handoff_to_agent from responder")

        logger.debug(
            f"[SwarmAgent] Created Swarm: "
            f"max_handoffs={self.max_handoffs}, timeout={self.execution_timeout}s"
        )

        return swarm

    async def stream_async(
        self,
        message: str,
        http_request: Optional[Request] = None,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """
        Stream swarm execution with multi-agent orchestration.

        Flow:
        1. Inject conversation history into coordinator
        2. Execute swarm.stream_async with user query
        3. Stream events: node start/stop, handoffs, tool execution, text
        4. Save turn to unified storage

        Args:
            message: User message
            http_request: FastAPI Request for disconnect detection
            **kwargs: Additional parameters (unused)

        Yields:
            SSE-formatted strings with swarm events
        """
        from agent.stop_signal import get_stop_signal_provider

        user_query = message
        stop_signal_provider = get_stop_signal_provider()

        logger.info(f"[SwarmAgent] Starting for session {self.session_id}: {user_query[:50]}...")

        # Inject conversation history into coordinator
        # SDK SwarmNode captures _initial_messages at creation time and resets to it before each execution.
        # To inject history, we must update BOTH executor.messages AND _initial_messages.
        history_messages = self.message_store.get_history_messages()
        coordinator_node = self.swarm.nodes.get("coordinator")

        if history_messages and coordinator_node:
            # Update executor.messages (current state)
            coordinator_node.executor.messages = history_messages
            # Update _initial_messages (reset state) - this is what gets restored on reset_executor_state()
            coordinator_node._initial_messages = copy.deepcopy(history_messages)
            logger.info(f"[SwarmAgent] Injected {len(history_messages)} history messages into coordinator")
        else:
            logger.info(f"[SwarmAgent] No history (new session or first turn)")

        # Prepare invocation_state for tool context access
        invocation_state = {
            'user_id': self.user_id,
            'session_id': self.session_id,
            'model_id': self.model_id,
            'api_keys': self.api_keys,
            'auth_token': self.auth_token,
        }
        logger.debug(f"[SwarmAgent] Prepared invocation_state: user_id={self.user_id}, session_id={self.session_id}")

        # Yield start event
        yield f"data: {json.dumps({'type': 'start'})}\n\n"

        # Token usage accumulator
        total_usage = {
            "inputTokens": 0,
            "outputTokens": 0,
            "totalTokens": 0,
        }

        node_history = []
        current_node_id = None
        node_text_accumulator: Dict[str, str] = {}
        content_blocks: List[Dict] = []
        responder_current_text: str = ""
        pending_tools: Dict[str, Dict] = {}  # toolUseId -> toolUse block
        handoff_tool_ids: set = set()
        sent_tool_ids: set = set()
        last_emitted_input: Dict[str, dict] = {}  # toolUseId -> last emitted input

        try:
            # Execute Swarm with streaming
            last_event_time = asyncio.get_event_loop().time()

            async for event in self.swarm.stream_async(user_query, invocation_state=invocation_state):
                current_time = asyncio.get_event_loop().time()
                time_since_last = current_time - last_event_time
                last_event_time = current_time

                # Check for client disconnect
                if http_request and await http_request.is_disconnected():
                    logger.info(f"[SwarmAgent] Client disconnected")
                    break

                # Check for stop signal (user requested stop)
                if stop_signal_provider.is_stop_requested(self.user_id, self.session_id):
                    logger.info(f"[SwarmAgent] Stop signal received for {self.session_id}")
                    stop_signal_provider.clear_stop_signal(self.user_id, self.session_id)
                    # Send stop complete event (don't save incomplete turn)
                    yield f"data: {json.dumps({'type': 'complete', 'message': 'Stream stopped by user'})}\n\n"
                    break

                event_type = event.get("type")

                # Log event timing only for long gaps (debugging)
                if time_since_last > 10.0:
                    logger.warning(f"[SwarmAgent] Long gap: {time_since_last:.1f}s since last event")

                if event_type == "multiagent_node_start":
                    node_id = event.get("node_id")
                    current_node_id = node_id
                    node_history.append(node_id)
                    logger.debug(f"[SwarmAgent] Node started: {node_id}")

                elif event_type == "multiagent_node_stream":
                    inner_event = event.get("event", {})
                    node_id = event.get("node_id", current_node_id)

                    if "reasoningText" in inner_event:
                        if node_id == "responder":
                            reasoning_text = inner_event["reasoningText"]
                            if reasoning_text:
                                yield f"data: {json.dumps({'type': 'reasoning', 'text': reasoning_text})}\n\n"

                    elif "data" in inner_event:
                        text_data = inner_event["data"]
                        if node_id not in node_text_accumulator:
                            node_text_accumulator[node_id] = ""
                        node_text_accumulator[node_id] += text_data

                        if node_id == "responder":
                            responder_current_text += text_data
                            yield f"data: {json.dumps({'type': 'response', 'text': text_data})}\n\n"

                    # Tool use from all agents (skip handoff_to_agent)
                    elif inner_event.get("type") == "tool_use_stream":
                        current_tool = inner_event.get("current_tool_use", {})
                        tool_id = current_tool.get("toolUseId")
                        tool_name = current_tool.get("name", "")

                        if not current_tool or not tool_id or tool_id in handoff_tool_ids:
                            pass
                        elif tool_name == "handoff_to_agent":
                            handoff_tool_ids.add(tool_id)
                        elif tool_id not in sent_tool_ids:
                            # First emission - create tool card in UI
                            sent_tool_ids.add(tool_id)
                            tool_input = current_tool.get("input")
                            if not isinstance(tool_input, dict):
                                tool_input = {}
                            last_emitted_input[tool_id] = tool_input
                            tool_event = {"type": "tool_use", "toolUseId": tool_id, "name": tool_name, "input": tool_input}
                            yield f"data: {json.dumps(tool_event)}\n\n"
                            logger.debug(f"[SwarmAgent] Tool use from {node_id}: {tool_name}")

                            if node_id == "responder" and responder_current_text.strip():
                                content_blocks.append({"text": responder_current_text})
                                responder_current_text = ""

                            pending_tools[tool_id] = {
                                "toolUse": {"toolUseId": tool_id, "name": tool_name, "input": tool_input}
                            }
                        else:
                            # Input update - re-emit if input changed
                            tool_input = current_tool.get("input")
                            if isinstance(tool_input, dict) and tool_input and tool_input != last_emitted_input.get(tool_id):
                                last_emitted_input[tool_id] = tool_input
                                tool_event = {"type": "tool_use", "toolUseId": tool_id, "name": tool_name, "input": tool_input}
                                yield f"data: {json.dumps(tool_event)}\n\n"
                                if tool_id in pending_tools:
                                    pending_tools[tool_id]["toolUse"]["input"] = tool_input

                    # Browser session detection
                    elif inner_event.get("tool_stream_event"):
                        tool_stream = inner_event["tool_stream_event"]
                        stream_data = tool_stream.get("data", {})
                        if isinstance(stream_data, dict) and stream_data.get("type") == "browser_session_detected":
                            metadata = {"browserSessionId": stream_data.get("browserSessionId")}
                            if stream_data.get("browserId"):
                                metadata["browserId"] = stream_data["browserId"]
                            yield f"data: {json.dumps({'type': 'metadata', 'metadata': metadata})}\n\n"

                    # Tool result from all agents (skip handoff results)
                    elif "message" in inner_event:
                        msg = inner_event.get("message", {})
                        if msg.get("role") == "user" and msg.get("content"):
                            for cb in msg["content"]:
                                if not (isinstance(cb, dict) and "toolResult" in cb):
                                    continue
                                tool_result = cb["toolResult"]
                                tool_use_id = tool_result.get("toolUseId")

                                if tool_use_id and tool_use_id in handoff_tool_ids:
                                    continue
                                if tool_use_id and tool_use_id in sent_tool_ids:
                                    result_event = {
                                        "type": "tool_result",
                                        "toolUseId": tool_use_id,
                                        "status": tool_result.get("status", "success")
                                    }
                                    if tool_result.get("content"):
                                        for rc in tool_result["content"]:
                                            if isinstance(rc, dict) and "text" in rc:
                                                result_event["result"] = rc["text"]
                                    if tool_result.get("metadata"):
                                        result_event["metadata"] = tool_result["metadata"]
                                    yield f"data: {json.dumps(result_event)}\n\n"

                                    if tool_use_id in pending_tools:
                                        content_blocks.append(pending_tools.pop(tool_use_id))
                                        content_blocks.append({"toolResult": tool_result})
                                    sent_tool_ids.discard(tool_use_id)

                elif event_type == "multiagent_node_stop":
                    node_id = event.get("node_id")
                    node_result = event.get("node_result", {})
                    if hasattr(node_result, "accumulated_usage"):
                        usage = node_result.accumulated_usage
                        total_usage["inputTokens"] += usage.get("inputTokens", 0)
                        total_usage["outputTokens"] += usage.get("outputTokens", 0)
                        total_usage["totalTokens"] += usage.get("totalTokens", 0)
                    elif isinstance(node_result, dict) and "accumulated_usage" in node_result:
                        usage = node_result["accumulated_usage"]
                        total_usage["inputTokens"] += usage.get("inputTokens", 0)
                        total_usage["outputTokens"] += usage.get("outputTokens", 0)
                        total_usage["totalTokens"] += usage.get("totalTokens", 0)

                elif event_type == "multiagent_handoff":
                    from_nodes = event.get("from_node_ids", [])
                    to_nodes = event.get("to_node_ids", [])
                    from_node = from_nodes[0] if from_nodes else ""
                    logger.info(f"[SwarmAgent] Handoff: {from_node or '?'} → {to_nodes[0] if to_nodes else '?'}")

                elif event_type == "multiagent_result":
                    final_response = None
                    if node_history:
                        last_node = node_history[-1]
                        if last_node != "responder":
                            accumulated_text = node_text_accumulator.get(last_node, "")
                            if accumulated_text.strip():
                                final_response = accumulated_text

                    if responder_current_text.strip():
                        content_blocks.append({"text": responder_current_text})
                    if not content_blocks and final_response:
                        content_blocks.append({"text": final_response})

                    # Stream final_response to frontend if it wasn't already streamed
                    # (happens when non-responder agent generates the final text)
                    if final_response and not responder_current_text.strip():
                        yield f"data: {json.dumps({'type': 'response', 'text': final_response})}\n\n"

                    if content_blocks:
                        self.message_store.save_turn(
                            user_message=user_query,
                            content_blocks=content_blocks,
                            swarm_state=None
                        )

                    # Collect artifacts from all swarm agents and persist
                    all_artifacts = {}
                    for node_name, swarm_node in self.swarm.nodes.items():
                        agent_artifacts = swarm_node.executor.state.get("artifacts")
                        if agent_artifacts:
                            all_artifacts.update(agent_artifacts)
                    if all_artifacts:
                        self.message_store.save_artifacts(all_artifacts)

                    final_usage = {k: v for k, v in total_usage.items() if v > 0}
                    yield f"data: {json.dumps({'type': 'complete', 'usage': final_usage if final_usage else None})}\n\n"
                    logger.info(f"[SwarmAgent] Complete: {len(node_history)} nodes")

        except Exception as e:
            logger.error(f"[SwarmAgent] Error: {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

        finally:
            yield f"data: {json.dumps({'type': 'end'})}\n\n"


def get_tools_for_agent(agent_name: str, auth_token: Optional[str] = None) -> List:
    """
    Get all tools assigned to a specific agent.

    Swarm mode uses ALL tools assigned to each agent without user filtering.
    Each agent has a predefined set of tools based on their specialty.

    Args:
        agent_name: Name of the agent (must be in AGENT_TOOL_MAPPING)
        auth_token: Cognito JWT for MCP Runtime 3LO tools (Gmail, Notion, etc.)

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
        log_prefix=f"[Swarm:{agent_name}]",
        auth_token=auth_token,
    )

    if result.validation_errors:
        logger.warning(f"[Swarm:{agent_name}] Tool validation errors: {result.validation_errors}")

    return result.tools
