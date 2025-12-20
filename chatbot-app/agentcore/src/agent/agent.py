"""
ChatbotAgent for Agent Core
- Uses Strands Agent with local tools
- Session management with AgentCore Memory
- User preference and conversation persistence
- Streaming with event processing
"""

import logging
import os
from typing import AsyncGenerator, Dict, Any, List, Optional
from pathlib import Path
from datetime import datetime
from strands import Agent
from strands.models import BedrockModel
from strands.session.file_session_manager import FileSessionManager
from strands.hooks import HookProvider, HookRegistry, BeforeModelCallEvent, BeforeToolCallEvent
from strands.tools.executors import SequentialToolExecutor
from streaming.event_processor import StreamEventProcessor

# Import timezone support (zoneinfo for Python 3.9+, fallback to pytz)
try:
    from zoneinfo import ZoneInfo
    TIMEZONE_AVAILABLE = True
except ImportError:
    try:
        import pytz
        TIMEZONE_AVAILABLE = True
    except ImportError:
        TIMEZONE_AVAILABLE = False
        logger.warning("Neither zoneinfo nor pytz available - date will use UTC")

# AgentCore Memory integration (optional, only for cloud deployment)
try:
    from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig
    from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
    AGENTCORE_MEMORY_AVAILABLE = True
except ImportError:
    AGENTCORE_MEMORY_AVAILABLE = False

# Import Strands built-in tools
from strands_tools.calculator import calculator

# Import local tools module (general-purpose, agent-core integrated)
import local_tools

# Import built-in tools module (AWS Bedrock-powered tools)
import builtin_tools

# Import Gateway MCP client
from agent.gateway_mcp_client import get_gateway_client_if_enabled

# Import A2A tools module
import a2a_tools

logger = logging.getLogger(__name__)


def get_current_date_pacific() -> str:
    """Get current date and hour in US Pacific timezone (America/Los_Angeles)"""
    try:
        if TIMEZONE_AVAILABLE:
            try:
                # Try zoneinfo first (Python 3.9+)
                from zoneinfo import ZoneInfo
                pacific_tz = ZoneInfo("America/Los_Angeles")
                now = datetime.now(pacific_tz)
                # Get timezone abbreviation (PST/PDT)
                tz_abbr = now.strftime("%Z")
            except (ImportError, NameError):
                # Fallback to pytz
                import pytz
                pacific_tz = pytz.timezone("America/Los_Angeles")
                now = datetime.now(pacific_tz)
                # Get timezone abbreviation (PST/PDT)
                tz_abbr = now.strftime("%Z")

            return now.strftime(f"%Y-%m-%d (%A) %H:00 {tz_abbr}")
        else:
            # Fallback to UTC if no timezone library available
            now = datetime.utcnow()
            return now.strftime("%Y-%m-%d (%A) %H:00 UTC")
    except Exception as e:
        logger.warning(f"Failed to get Pacific time: {e}, using UTC")
        now = datetime.utcnow()
        return now.strftime("%Y-%m-%d (%A) %H:00 UTC")


class StopHook(HookProvider):
    """Hook to handle session stop requests by cancelling tool execution"""

    def __init__(self, session_manager):
        self.session_manager = session_manager

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self.check_cancelled)

    def check_cancelled(self, event: BeforeToolCallEvent) -> None:
        """Cancel tool execution if session is stopped by user"""
        if hasattr(self.session_manager, 'cancelled') and self.session_manager.cancelled:
            tool_name = event.tool_use.get("name", "unknown")
            logger.info(f"🚫 Cancelling tool execution: {tool_name} (session stopped by user)")
            event.cancel_tool = "Session stopped by user"


class ResearchApprovalHook(HookProvider):
    """Hook to request user approval before executing research agent or browser-use agent"""

    def __init__(self, app_name: str = "chatbot"):
        self.app_name = app_name

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self.request_approval)

    def request_approval(self, event: BeforeToolCallEvent) -> None:
        """Request user approval before executing research_agent or browser_use_agent tool"""
        tool_name = event.tool_use.get("name", "")

        # Only interrupt for research_agent or browser_use_agent tools
        if tool_name not in ["research_agent", "browser_use_agent"]:
            return

        # Extract tool input
        tool_input = event.tool_use.get("input", {})

        # Prepare approval details based on tool type
        if tool_name == "research_agent":
            # Research Agent: show plan
            plan = tool_input.get("plan", "No plan provided")
            logger.info(f"🔍 Requesting approval for research_agent with plan: {plan[:100]}...")

            approval = event.interrupt(
                f"{self.app_name}-research-approval",
                reason={
                    "tool_name": tool_name,
                    "plan": plan,
                    "plan_preview": plan[:200] + "..." if len(plan) > 200 else plan
                }
            )
            action = "research"

        elif tool_name == "browser_use_agent":
            # Browser-Use Agent: show task and max_steps
            task = tool_input.get("task", "No task provided")
            max_steps = tool_input.get("max_steps", 15)
            logger.info(f"🌐 Requesting approval for browser_use_agent with task: {task[:100]}...")

            approval = event.interrupt(
                f"{self.app_name}-browser-approval",
                reason={
                    "tool_name": tool_name,
                    "task": task,
                    "task_preview": task[:200] + "..." if len(task) > 200 else task,
                    "max_steps": max_steps
                }
            )
            action = "browser automation"

        # Check user response
        if approval and approval.lower() in ["y", "yes", "approve"]:
            logger.info(f"✅ {action.capitalize()} approved by user, proceeding with execution")
            return
        else:
            logger.info(f"❌ {action.capitalize()} rejected by user, cancelling tool execution")
            event.cancel_tool = f"User declined to proceed with {action}"


class ConversationCachingHook(HookProvider):
    """Hook to add cache points to conversation history before model calls

    Strategy:
    - Maintain 3 cache points in conversation (sliding window)
    - Prioritize recent assistant messages and tool results
    - When limit reached, remove oldest cache point and add new one
    - Combined with system prompt cache = 4 total cache breakpoints (Claude/Bedrock limit)
    - Sliding cache points keep the most recent turns cached for optimal efficiency
    """

    def __init__(self, enabled: bool = True):
        self.enabled = enabled

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeModelCallEvent, self.add_conversation_cache_point)

    def add_conversation_cache_point(self, event: BeforeModelCallEvent) -> None:
        """Add cache points to conversation history with sliding window (max 3, remove oldest when full)"""
        if not self.enabled:
            logger.info("❌ Caching disabled")
            return

        messages = event.agent.messages
        if not messages:
            logger.info("❌ No messages in history")
            return

        logger.info(f"🔍 Processing caching for {len(messages)} messages")

        # Count existing cache points across all content blocks
        existing_cache_count = 0
        cache_point_positions = []

        for msg_idx, msg in enumerate(messages):
            content = msg.get("content", [])
            if isinstance(content, list):
                for block_idx, block in enumerate(content):
                    if isinstance(block, dict) and "cachePoint" in block:
                        existing_cache_count += 1
                        cache_point_positions.append((msg_idx, block_idx))

        # If we already have 3 cache points, remove the oldest one (sliding window)
        if existing_cache_count >= 3:
            logger.info(f"📊 Cache limit reached: {existing_cache_count}/3 cache points")
            # Remove the oldest cache point to make room for new one
            if cache_point_positions:
                oldest_msg_idx, oldest_block_idx = cache_point_positions[0]
                oldest_msg = messages[oldest_msg_idx]
                oldest_content = oldest_msg.get("content", [])
                if isinstance(oldest_content, list) and oldest_block_idx < len(oldest_content):
                    # Remove the cache point block
                    del oldest_content[oldest_block_idx]
                    oldest_msg["content"] = oldest_content
                    existing_cache_count -= 1
                    logger.info(f"♻️  Removed oldest cache point at message {oldest_msg_idx} block {oldest_block_idx}")
                    # Update positions for remaining cache points
                    cache_point_positions.pop(0)

        # Strategy: Prioritize assistant messages, then tool_result blocks
        # This ensures every assistant turn gets cached, with or without tools

        assistant_candidates = []
        tool_result_candidates = []

        for msg_idx, msg in enumerate(messages):
            msg_role = msg.get("role", "")
            content = msg.get("content", [])

            if isinstance(content, list) and len(content) > 0:
                # For assistant messages: cache after reasoning/response (priority)
                if msg_role == "assistant":
                    last_block = content[-1]
                    has_cache = isinstance(last_block, dict) and "cachePoint" in last_block
                    if not has_cache:
                        assistant_candidates.append((msg_idx, len(content) - 1, "assistant"))

                # For user messages: cache after tool_result blocks (secondary)
                elif msg_role == "user":
                    for block_idx, block in enumerate(content):
                        if isinstance(block, dict) and "toolResult" in block:
                            has_cache = "cachePoint" in block
                            if not has_cache:
                                tool_result_candidates.append((msg_idx, block_idx, "tool_result"))

        remaining_slots = 3 - existing_cache_count
        logger.info(f"📊 Cache status: {existing_cache_count}/3 existing, {len(assistant_candidates)} assistant + {len(tool_result_candidates)} tool_result candidates, {remaining_slots} slots available")

        # Prioritize assistant messages: take most recent assistants first, then tool_results
        candidates_to_cache = []
        if remaining_slots > 0:
            # Take recent assistant messages first
            num_assistants = min(len(assistant_candidates), remaining_slots)
            if num_assistants > 0:
                candidates_to_cache.extend(assistant_candidates[-num_assistants:])
                remaining_slots -= num_assistants

            # Fill remaining slots with tool_results
            if remaining_slots > 0 and tool_result_candidates:
                num_tool_results = min(len(tool_result_candidates), remaining_slots)
                candidates_to_cache.extend(tool_result_candidates[-num_tool_results:])

        if candidates_to_cache:

            for msg_idx, block_idx, block_type in candidates_to_cache:
                msg = messages[msg_idx]
                content = msg.get("content", [])

                # Safety check: content must be a list and not empty
                if not isinstance(content, list):
                    logger.warning(f"⚠️  Skipping cache point: content is not a list at message {msg_idx}")
                    continue

                if len(content) == 0:
                    logger.warning(f"⚠️  Skipping cache point: content is empty at message {msg_idx}")
                    continue

                if block_idx >= len(content):
                    logger.warning(f"⚠️  Skipping cache point: block_idx {block_idx} out of range at message {msg_idx}")
                    continue

                block = content[block_idx]

                # For dict blocks (toolResult, text, etc.), add cachePoint as separate block after it
                if isinstance(block, dict):
                    # Safety: Don't insert cachePoint at the beginning of next message
                    # Only insert within the same message's content array
                    cache_block = {"cachePoint": {"type": "default"}}
                    insert_position = block_idx + 1

                    # Insert cache point after the current block
                    content.insert(insert_position, cache_block)
                    msg["content"] = content
                    existing_cache_count += 1
                    logger.info(f"✅ Added cache point after {block_type} at message {msg_idx} block {block_idx} (total: {existing_cache_count}/3)")

                elif isinstance(block, str):
                    # Convert string to structured format with cache
                    msg["content"] = [
                        {"text": block},
                        {"cachePoint": {"type": "default"}}
                    ]
                    existing_cache_count += 1
                    logger.info(f"✅ Added cache point after text at message {msg_idx} (total: {existing_cache_count}/3)")

                if existing_cache_count >= 3:
                    break

# Global stream processor instance
_global_stream_processor = None

def get_global_stream_processor():
    """Get the global stream processor instance"""
    return _global_stream_processor


# Tool ID to tool object mapping
# Start with Strands built-in tools (externally managed)
TOOL_REGISTRY = {
    "calculator": calculator,
}

# Dynamically load all local tools from local_tools.__all__
# This ensures we only need to maintain the list in one place (__init__.py)
for tool_name in local_tools.__all__:
    tool_obj = getattr(local_tools, tool_name)
    TOOL_REGISTRY[tool_name] = tool_obj
    logger.info(f"Registered local tool: {tool_name}")

# Dynamically load all builtin tools from builtin_tools.__all__
# This ensures we only need to maintain the list in one place (__init__.py)
for tool_name in builtin_tools.__all__:
    tool_obj = getattr(builtin_tools, tool_name)
    TOOL_REGISTRY[tool_name] = tool_obj
    logger.info(f"Registered builtin tool: {tool_name}")


class ChatbotAgent:
    """Main ChatbotAgent for Agent Core with user-specific configuration"""

    def __init__(
        self,
        session_id: str,
        user_id: Optional[str] = None,
        enabled_tools: Optional[List[str]] = None,
        model_id: Optional[str] = None,
        temperature: Optional[float] = None,
        system_prompt: Optional[str] = None,
        caching_enabled: Optional[bool] = None
    ):
        """
        Initialize agent with specific configuration and AgentCore Memory

        Args:
            session_id: Session identifier for message persistence
            user_id: User identifier for cross-session preferences (defaults to session_id)
            enabled_tools: List of tool IDs to enable. If None, all tools are enabled.
            model_id: Bedrock model ID to use
            temperature: Model temperature (0.0 - 1.0)
            system_prompt: System prompt text
            caching_enabled: Whether to enable prompt caching
        """
        global _global_stream_processor
        self.stream_processor = StreamEventProcessor()
        _global_stream_processor = self.stream_processor
        self.agent = None
        self.session_id = session_id
        self.user_id = user_id or session_id  # Use session_id as user_id if not provided
        self.enabled_tools = enabled_tools
        self.gateway_client = None  # Store Gateway MCP client for lifecycle management

        # Store model configuration
        self.model_id = model_id or "us.anthropic.claude-haiku-4-5-20251001-v1:0"
        self.temperature = temperature if temperature is not None else 0.7

        # Always build system prompt dynamically with tool-specific guidance
        # Ignore any system_prompt parameter - always construct from scratch
        base_system_prompt = """You are an intelligent AI agent with dynamic tool capabilities. You can perform various tasks based on the combination of tools available to you.

Key guidelines:
- You can ONLY use tools that are explicitly provided to you in each conversation
- Available tools may change throughout the conversation based on user preferences
- When multiple tools are available, select and use the most appropriate combination in the optimal order to fulfill the user's request
- Break down complex tasks into steps and use multiple tools sequentially or in parallel as needed
- Always explain your reasoning when using tools
- If you don't have the right tool for a task, clearly inform the user about the limitation

Your goal is to be helpful, accurate, and efficient in completing user requests using the available tools."""

        # Load tool-specific guidance dynamically based on enabled tools
        tool_guidance_list = self._load_tool_guidance()

        current_date = get_current_date_pacific()

        # Construct system prompt as string by combining all sections
        # Note: Strands 1.14.0 uses string system prompts, cached via BedrockModel's cache_prompt="default"
        prompt_sections = [base_system_prompt]

        # Add tool-specific guidance sections
        if tool_guidance_list:
            prompt_sections.extend(tool_guidance_list)
            logger.info(f"System prompt constructed with {len(tool_guidance_list)} tool guidance sections")

        # Add date as final section
        prompt_sections.append(f"Current date: {current_date}")

        # Combine all sections with double newline separator
        self.system_prompt = "\n\n".join(prompt_sections)

        logger.info(f"Using system prompt with {len(prompt_sections)} sections (base + {len(tool_guidance_list)} tool guidance + date)")
        logger.info(f"System prompt length: {len(self.system_prompt)} characters")
        logger.info(f"System prompt preview (first 200 chars): {self.system_prompt[:200]}")

        self.caching_enabled = caching_enabled if caching_enabled is not None else True

        # Session Manager Selection: AgentCore Memory (cloud) vs File-based (local)
        memory_id = os.environ.get('MEMORY_ID')
        aws_region = os.environ.get('AWS_REGION', 'us-west-2')

        if memory_id and AGENTCORE_MEMORY_AVAILABLE:
            # Cloud deployment: Use AgentCore Memory
            logger.info(f"🚀 Cloud mode: Using AgentCore Memory (memory_id={memory_id})")

            # Configure AgentCore Memory with user preferences and facts retrieval
            agentcore_memory_config = AgentCoreMemoryConfig(
                memory_id=memory_id,
                session_id=session_id,
                actor_id=self.user_id,
                enable_prompt_caching=caching_enabled if caching_enabled is not None else True,
                retrieval_config={
                    # User-specific preferences (e.g., coding style, language preference)
                    f"/preferences/{self.user_id}": RetrievalConfig(top_k=5, relevance_score=0.7),
                    # User-specific facts (e.g., learned information)
                    f"/facts/{self.user_id}": RetrievalConfig(top_k=10, relevance_score=0.3),
                }
            )

            # Create Turn-based Session Manager (reduces API calls by 75%)
            from agent.turn_based_session_manager import TurnBasedSessionManager

            self.session_manager = TurnBasedSessionManager(
                agentcore_memory_config=agentcore_memory_config,
                region_name=aws_region
            )

            logger.info(f"✅ AgentCore Memory initialized: user_id={self.user_id}")
        else:
            # Local development: Use file-based session manager with buffering wrapper
            logger.info(f"💻 Local mode: Using FileSessionManager with buffering")
            sessions_dir = Path(__file__).parent.parent.parent / "sessions"
            sessions_dir.mkdir(exist_ok=True)

            base_file_manager = FileSessionManager(
                session_id=session_id,
                storage_dir=str(sessions_dir)
            )

            # Wrap with local buffering manager for stop functionality
            from agent.local_session_buffer import LocalSessionBuffer
            self.session_manager = LocalSessionBuffer(
                base_manager=base_file_manager,
                session_id=session_id
            )

            logger.info(f"✅ FileSessionManager with buffering initialized: {sessions_dir}")

        self.create_agent()

    def get_model_config(self) -> Dict[str, Any]:
        """Return model configuration"""
        return {
            "model_id": self.model_id,
            "temperature": self.temperature,
            "system_prompt": self.system_prompt,
            "caching_enabled": self.caching_enabled
        }

    def _load_tool_guidance(self) -> List[str]:
        """
        Load tool-specific system prompt guidance based on enabled tools.

        Returns list of guidance texts from tools-config.json systemPromptGuidance fields
        for all enabled tool groups.
        """
        if not self.enabled_tools or len(self.enabled_tools) == 0:
            return []

        try:
            import boto3
            from botocore.exceptions import ClientError

            # Get environment variables
            aws_region = os.environ.get('AWS_REGION', 'us-west-2')
            dynamodb_table = os.environ.get('DYNAMODB_TABLE_NAME')
            is_local = os.environ.get('NEXT_PUBLIC_AGENTCORE_LOCAL', 'false').lower() == 'true'

            guidance_sections = []

            # Local mode: load from tools-config.json
            if is_local or not dynamodb_table:
                logger.info("Loading tool guidance from local tools-config.json")
                try:
                    import json
                    config_path = Path(__file__).parent.parent.parent.parent / "frontend" / "src" / "config" / "tools-config.json"

                    if config_path.exists():
                        with open(config_path, 'r') as f:
                            tools_config = json.load(f)

                        # Check all tool categories for systemPromptGuidance
                        for category in ['local_tools', 'builtin_tools', 'browser_automation', 'gateway_targets', 'agentcore_runtime_a2a']:
                            if category in tools_config:
                                for tool_group in tools_config[category]:
                                    tool_id = tool_group.get('id')

                                    # Check if any enabled tool matches this group
                                    if tool_id and self._is_tool_group_enabled(tool_id, tool_group):
                                        guidance = tool_group.get('systemPromptGuidance')
                                        if guidance:
                                            guidance_sections.append(guidance)
                                            logger.info(f"Added guidance for tool group: {tool_id}")

                except Exception as e:
                    logger.warning(f"Failed to load tool guidance from local file: {e}")

            # Cloud mode: load from DynamoDB
            else:
                logger.info("Loading tool guidance from DynamoDB")
                try:
                    dynamodb = boto3.resource('dynamodb', region_name=aws_region)
                    table = dynamodb.Table(dynamodb_table)

                    # Load tool registry from DynamoDB (userId='TOOL_REGISTRY')
                    response = table.get_item(Key={'userId': 'TOOL_REGISTRY', 'sessionId': 'default'})

                    if 'Item' in response and 'toolRegistry' in response['Item']:
                        tool_registry = response['Item']['toolRegistry']

                        # Check all tool categories
                        for category in ['local_tools', 'builtin_tools', 'browser_automation', 'gateway_targets', 'agentcore_runtime_a2a']:
                            if category in tool_registry:
                                for tool_group in tool_registry[category]:
                                    tool_id = tool_group.get('id')

                                    # Check if any enabled tool matches this group
                                    if tool_id and self._is_tool_group_enabled(tool_id, tool_group):
                                        guidance = tool_group.get('systemPromptGuidance')
                                        if guidance:
                                            guidance_sections.append(guidance)
                                            logger.info(f"Added guidance for tool group: {tool_id}")

                except ClientError as e:
                    logger.warning(f"Failed to load tool guidance from DynamoDB: {e}")
                except Exception as e:
                    logger.warning(f"Error loading tool guidance: {e}")

            return guidance_sections

        except Exception as e:
            logger.error(f"Error in _load_tool_guidance: {e}")
            return []

    def _is_tool_group_enabled(self, tool_group_id: str, tool_group: Dict) -> bool:
        """
        Check if a tool group is enabled based on enabled_tools list.

        For dynamic tool groups (isDynamic=true), checks if any sub-tool is enabled.
        For static tool groups, checks if the group ID itself is enabled.
        """
        if not self.enabled_tools:
            return False

        # Check if group ID itself is in enabled tools
        if tool_group_id in self.enabled_tools:
            return True

        # For dynamic tool groups, check if any sub-tool is enabled
        if tool_group.get('isDynamic') and 'tools' in tool_group:
            for sub_tool in tool_group['tools']:
                if sub_tool.get('id') in self.enabled_tools:
                    return True

        return False

    def get_filtered_tools(self) -> List:
        """
        Get tools filtered by enabled_tools list.
        Includes local tools, Gateway MCP client, and A2A agents.
        """
        # If no enabled_tools specified (None or empty), return NO tools
        if self.enabled_tools is None or len(self.enabled_tools) == 0:
            logger.info("No enabled_tools specified - Agent will run WITHOUT any tools")
            return []

        # Filter local tools based on enabled_tools
        filtered_tools = []
        gateway_tool_ids = []
        a2a_agent_ids = []

        for tool_id in self.enabled_tools:
            if tool_id in TOOL_REGISTRY:
                # Local tool
                filtered_tools.append(TOOL_REGISTRY[tool_id])
            elif tool_id.startswith("gateway_"):
                # Gateway MCP tool - collect for filtering
                gateway_tool_ids.append(tool_id)
            elif tool_id.startswith("agentcore_"):
                # A2A Agent tool - collect for creation
                a2a_agent_ids.append(tool_id)
            else:
                logger.warning(f"Tool '{tool_id}' not found in registry, skipping")

        logger.info(f"Local tools enabled: {len(filtered_tools)}")
        logger.info(f"Gateway tools enabled: {len(gateway_tool_ids)}")
        logger.info(f"A2A agents enabled: {len(a2a_agent_ids)}")

        # Add Gateway MCP client if Gateway tools are enabled
        # Store as instance variable to keep session alive during Agent lifecycle
        if gateway_tool_ids:
            self.gateway_client = get_gateway_client_if_enabled(enabled_tool_ids=gateway_tool_ids)
            if self.gateway_client:
                # Using Managed Integration (Strands 1.16+) - pass MCPClient directly to Agent
                # Agent will automatically manage lifecycle and filter tools
                filtered_tools.append(self.gateway_client)
                logger.info(f"✅ Gateway MCP client added (Managed Integration with Strands 1.16+)")
                logger.info(f"   Enabled Gateway tool IDs: {gateway_tool_ids}")
            else:
                logger.warning("⚠️  Gateway MCP client not available")

        # Add A2A Agent tools
        if a2a_agent_ids:
            for agent_id in a2a_agent_ids:
                try:
                    # Create A2A tool based on agent_id
                    a2a_tool = self._create_a2a_tool(agent_id)
                    if a2a_tool:
                        filtered_tools.append(a2a_tool)
                        logger.info(f"✅ A2A Agent added: {agent_id}")
                except Exception as e:
                    logger.error(f"Failed to create A2A tool {agent_id}: {e}")

        logger.info(f"Total enabled tools: {len(filtered_tools)} (local + gateway + a2a)")
        return filtered_tools

    def _create_a2a_tool(self, agent_id: str):
        """Create A2A agent tool from agent_id"""
        # Delegate to a2a_tools module
        return a2a_tools.create_a2a_tool(agent_id)

    def create_agent(self):
        """Create Strands agent with filtered tools and session management"""
        try:
            from botocore.config import Config

            config = self.get_model_config()

            # Configure retry for transient Bedrock errors (serviceUnavailableException)
            retry_config = Config(
                retries={
                    'max_attempts': 10,
                    'mode': 'adaptive'  # Adaptive retry with exponential backoff
                },
                connect_timeout=30,
                read_timeout=120
            )

            # Create model configuration
            model_config = {
                "model_id": config["model_id"],
                "temperature": config.get("temperature", 0.7),
                "boto_client_config": retry_config
            }

            # Add cache_prompt if caching is enabled (BedrockModel handles SystemContentBlock formatting)
            if self.caching_enabled:
                model_config["cache_prompt"] = "default"
                logger.info("✅ System prompt caching enabled (cache_prompt=default)")

            logger.info("✅ Bedrock retry config: max_attempts=10, mode=adaptive")
            model = BedrockModel(**model_config)

            # Get filtered tools based on user preferences
            tools = self.get_filtered_tools()

            # Create hooks
            hooks = []

            # Add stop hook for session cancellation (always enabled)
            stop_hook = StopHook(self.session_manager)
            hooks.append(stop_hook)
            logger.info("✅ Stop hook enabled (BeforeToolCallEvent)")

            # Add research approval hook (always enabled)
            research_approval_hook = ResearchApprovalHook(app_name="chatbot")
            hooks.append(research_approval_hook)
            logger.info("✅ Research approval hook enabled (BeforeToolCallEvent)")

            # Add conversation caching hook if enabled
            if self.caching_enabled:
                conversation_hook = ConversationCachingHook(enabled=True)
                hooks.append(conversation_hook)
                logger.info("✅ Conversation caching hook enabled")

            # Create agent with session manager, hooks, and system prompt (as string)
            # Use SequentialToolExecutor to prevent concurrent browser operations
            # This prevents "Failed to start and initialize Playwright" errors with NovaAct
            self.agent = Agent(
                model=model,
                system_prompt=self.system_prompt,  # String system prompt (Strands 1.14.0)
                tools=tools,
                tool_executor=SequentialToolExecutor(),
                session_manager=self.session_manager,
                hooks=hooks if hooks else None
            )

            logger.info(f"✅ Agent created with {len(tools)} tools")
            logger.info(f"✅ System prompt: {len(self.system_prompt)} characters")
            logger.info(f"✅ Session Manager: {type(self.session_manager).__name__}")

            if AGENTCORE_MEMORY_AVAILABLE and os.environ.get('MEMORY_ID'):
                logger.info(f"   • Session: {self.session_id}, User: {self.user_id}")
                logger.info(f"   • Short-term memory: Conversation history (90 days retention)")
                logger.info(f"   • Long-term memory: User preferences and facts across sessions")
            else:
                logger.info(f"   • Session: {self.session_id}")
                logger.info(f"   • File-based persistence: {self.session_manager.storage_dir}")

        except Exception as e:
            logger.error(f"Error creating agent: {e}")
            raise

    async def stream_async(self, message: str, session_id: str = None, files: Optional[List] = None) -> AsyncGenerator[str, None]:
        """
        Stream responses using StreamEventProcessor

        Args:
            message: User message text
            session_id: Session identifier
            files: Optional list of FileContent objects (with base64 bytes)
        """

        if not self.agent:
            self.create_agent()

        # Set SESSION_ID for browser session isolation (each conversation has isolated browser)
        import os
        os.environ['SESSION_ID'] = self.session_id
        os.environ['USER_ID'] = self.user_id or self.session_id

        try:
            logger.info(f"Streaming message: {message[:50]}...")
            if files:
                logger.info(f"Processing {len(files)} file(s)")

            # Convert files to Strands ContentBlock format and prepare uploaded_files for tools
            prompt, uploaded_files = self._build_prompt(message, files)

            # Log prompt type for debugging (without printing bytes)
            if isinstance(prompt, list):
                logger.info(f"Prompt is list with {len(prompt)} content blocks")
            else:
                logger.info(f"Prompt is string: {prompt[:100]}")

            # Prepare invocation_state with model_id, user_id, session_id, and uploaded files
            invocation_state = {
                "session_id": self.session_id,
                "user_id": self.user_id,
                "model_id": self.model_id
            }

            # Add uploaded files to invocation_state (for tool access)
            if uploaded_files:
                invocation_state['uploaded_files'] = uploaded_files
                logger.info(f"Added {len(uploaded_files)} file(s) to invocation_state")

            # Use stream processor to handle Strands agent streaming
            async for event in self.stream_processor.process_stream(
                self.agent,
                prompt,  # Can be str or list[ContentBlock]
                file_paths=None,
                session_id=session_id or "default",
                invocation_state=invocation_state
            ):
                yield event

            # Flush any buffered messages (turn-based session manager)
            if hasattr(self.session_manager, 'flush'):
                self.session_manager.flush()
                logger.debug(f"💾 Session flushed after streaming complete")

        except Exception as e:
            import traceback
            logger.error(f"Error in stream_async: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")

            # Emergency flush: save buffered messages before losing them
            if hasattr(self.session_manager, 'flush'):
                try:
                    self.session_manager.flush()
                    logger.warning(f"🚨 Emergency flush on error - saved {len(getattr(self.session_manager, 'pending_messages', []))} buffered messages")
                except Exception as flush_error:
                    logger.error(f"Failed to emergency flush: {flush_error}")

            # Send error event
            import json
            error_event = {
                "type": "error",
                "message": str(e)
            }
            yield f"data: {json.dumps(error_event)}\n\n"

    def _sanitize_filename(self, filename: str) -> str:
        """
        Sanitize filename to meet AWS Bedrock requirements:
        - Only alphanumeric, whitespace, hyphens, parentheses, and square brackets
        - No consecutive whitespace
        - Convert underscores to hyphens
        """
        import re

        # First, replace underscores with hyphens
        sanitized = filename.replace('_', '-')

        # Keep only allowed characters: alphanumeric, whitespace, hyphens, parentheses, square brackets
        sanitized = re.sub(r'[^a-zA-Z0-9\s\-\(\)\[\]]', '', sanitized)

        # Replace consecutive whitespace with single space
        sanitized = re.sub(r'\s+', ' ', sanitized)

        # Trim whitespace
        sanitized = sanitized.strip()

        # If name becomes empty, use default
        if not sanitized:
            sanitized = 'document'

        return sanitized

    def _get_workspace_context(self) -> Optional[str]:
        """Get workspace file list as context string"""
        try:
            from builtin_tools.lib.document_manager import WordDocumentManager
            doc_manager = WordDocumentManager(self.user_id, self.session_id)
            documents = doc_manager.list_s3_documents()

            if documents:
                files_list = ", ".join([f"{doc['filename']} ({doc['size_kb']})" for doc in documents])
                return f"[Word documents in your workspace: {files_list}]"
            return None
        except Exception as e:
            logger.debug(f"Failed to get workspace context: {e}")
            return None

    def _auto_store_docx_files(self, uploaded_files: List[Dict[str, Any]]):
        """Automatically store uploaded .docx files to workspace"""
        try:
            from builtin_tools.lib.document_manager import WordDocumentManager
            from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter

            # Filter .docx files
            docx_files = [f for f in uploaded_files if f['filename'].lower().endswith('.docx')]
            if not docx_files:
                return

            doc_manager = WordDocumentManager(self.user_id, self.session_id)

            # Get Code Interpreter ID (from env or Parameter Store)
            code_interpreter_id = os.getenv('CODE_INTERPRETER_ID')
            if not code_interpreter_id:
                # Try Parameter Store
                try:
                    import boto3
                    project_name = os.getenv('PROJECT_NAME', 'strands-agent-chatbot')
                    environment = os.getenv('ENVIRONMENT', 'dev')
                    region = os.getenv('AWS_REGION', 'us-west-2')
                    param_name = f"/{project_name}/{environment}/agentcore/code-interpreter-id"

                    logger.info(f"Checking Parameter Store for Code Interpreter ID: {param_name}")
                    ssm = boto3.client('ssm', region_name=region)
                    response = ssm.get_parameter(Name=param_name)
                    code_interpreter_id = response['Parameter']['Value']
                    logger.info(f"Found CODE_INTERPRETER_ID in Parameter Store: {code_interpreter_id}")
                except Exception as e:
                    logger.warning(f"CODE_INTERPRETER_ID not found in env or Parameter Store: {e}")
                    return

            region = os.getenv('AWS_REGION', 'us-west-2')
            code_interpreter = CodeInterpreter(region)
            code_interpreter.start(identifier=code_interpreter_id)

            try:
                for file_info in docx_files:
                    filename = file_info['filename']
                    file_bytes = file_info['bytes']

                    # Sync to both S3 and Code Interpreter
                    doc_manager.sync_to_both(
                        code_interpreter,
                        filename,
                        file_bytes,
                        metadata={'auto_stored': 'true'}  # S3 metadata values must be strings
                    )
                    logger.info(f"✅ Auto-stored: {filename}")
            finally:
                code_interpreter.stop()

        except Exception as e:
            logger.error(f"Failed to auto-store .docx files: {e}")

    def _build_prompt(self, message: str, files: Optional[List] = None):
        """
        Build prompt for Strands Agent and prepare uploaded files for tools

        Args:
            message: User message text
            files: Optional list of FileContent objects with base64 bytes

        Returns:
            tuple: (prompt, uploaded_files)
                - prompt: str or list[ContentBlock] for Strands Agent
                - uploaded_files: list of dicts with filename, bytes, content_type (for tool invocation_state)
        """
        import base64

        # If no files, return simple text message
        if not files or len(files) == 0:
            return message, []

        # Build ContentBlock list for multimodal input
        content_blocks = []
        uploaded_files = []

        # Add text first (user message only - no workspace context to avoid UI display issues)
        content_blocks.append({"text": message})

        # Add each file as appropriate ContentBlock
        for file in files:
            content_type = file.content_type.lower()
            filename = file.filename.lower()

            # Decode base64 to bytes (do this only once)
            file_bytes = base64.b64decode(file.bytes)

            # Sanitize filename for consistency (used in S3 storage and tool invocation_state)
            # Split into name and extension, sanitize only the name part
            if '.' in file.filename:
                name_parts = file.filename.rsplit('.', 1)
                sanitized_full_name = self._sanitize_filename(name_parts[0]) + '.' + name_parts[1]
            else:
                sanitized_full_name = self._sanitize_filename(file.filename)

            # Store for tool invocation_state with sanitized filename
            uploaded_files.append({
                'filename': sanitized_full_name,  # Use sanitized filename for consistency
                'bytes': file_bytes,
                'content_type': file.content_type
            })

            # Determine file type and create appropriate ContentBlock
            if content_type.startswith("image/") or filename.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
                # Image content
                image_format = self._get_image_format(content_type, filename)
                content_blocks.append({
                    "image": {
                        "format": image_format,
                        "source": {
                            "bytes": file_bytes
                        }
                    }
                })
                logger.info(f"Added image: {filename} (format: {image_format})")

            elif filename.endswith((".pdf", ".csv", ".doc", ".docx", ".xls", ".xlsx", ".html", ".txt", ".md")):
                # Document content
                doc_format = self._get_document_format(filename)

                # For Bedrock ContentBlock: name should be WITHOUT extension (extension is in format field)
                # Split sanitized_full_name to get name without extension
                if '.' in sanitized_full_name:
                    name_without_ext = sanitized_full_name.rsplit('.', 1)[0]
                else:
                    name_without_ext = sanitized_full_name

                logger.info(f"🔍 [DEBUG] About to add document ContentBlock: name='{name_without_ext}', format={doc_format}, original='{file.filename}'")
                content_blocks.append({
                    "document": {
                        "format": doc_format,
                        "name": name_without_ext,  # Use name WITHOUT extension
                        "source": {
                            "bytes": file_bytes
                        }
                    }
                })
                logger.info(f"Added document: {file.filename} -> {sanitized_full_name} (format: {doc_format})")

            else:
                logger.warning(f"Unsupported file type: {filename} ({content_type})")

        # Auto-store .docx files to workspace
        self._auto_store_docx_files(uploaded_files)

        return content_blocks, uploaded_files

    def _get_image_format(self, content_type: str, filename: str) -> str:
        """Determine image format from content type or filename"""
        if "png" in content_type or filename.endswith(".png"):
            return "png"
        elif "jpeg" in content_type or "jpg" in content_type or filename.endswith((".jpg", ".jpeg")):
            return "jpeg"
        elif "gif" in content_type or filename.endswith(".gif"):
            return "gif"
        elif "webp" in content_type or filename.endswith(".webp"):
            return "webp"
        else:
            return "png"  # default

    def _get_document_format(self, filename: str) -> str:
        """Determine document format from filename"""
        if filename.endswith(".pdf"):
            return "pdf"
        elif filename.endswith(".csv"):
            return "csv"
        elif filename.endswith(".doc"):
            return "doc"
        elif filename.endswith(".docx"):
            return "docx"
        elif filename.endswith(".xls"):
            return "xls"
        elif filename.endswith(".xlsx"):
            return "xlsx"
        elif filename.endswith(".html"):
            return "html"
        elif filename.endswith(".txt"):
            return "txt"
        elif filename.endswith(".md"):
            return "md"
        else:
            return "txt"  # default
