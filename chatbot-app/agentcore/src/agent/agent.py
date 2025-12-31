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
            # Browser-Use Agent: show task only
            task = tool_input.get("task", "No task provided")
            logger.info(f"🌐 Requesting approval for browser_use_agent with task: {task[:100]}...")

            approval = event.interrupt(
                f"{self.app_name}-browser-approval",
                reason={
                    "tool_name": tool_name,
                    "task": task,
                    "task_preview": task[:200] + "..." if len(task) > 200 else task,
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
    - Combined with system prompt cache = 4 total cache breakpoints (Bedrock limit)
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

        # Debug: Log message structure to diagnose tool_use/tool_result mismatch
        for msg_idx, msg in enumerate(messages):
            role = msg.get("role", "unknown")
            content = msg.get("content", [])
            block_types = []
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        if "toolUse" in block:
                            block_types.append(f"toolUse({block['toolUse'].get('name', '?')})")
                        elif "toolResult" in block:
                            block_types.append(f"toolResult({block['toolResult'].get('toolUseId', '?')[:8]}...)")
                        elif "text" in block:
                            block_types.append("text")
                        elif "cachePoint" in block:
                            block_types.append("cachePoint")
                        else:
                            block_types.append(f"other({list(block.keys())})")
                    elif isinstance(block, str):
                        block_types.append("str")
            logger.info(f"  [msg {msg_idx}] role={role}, blocks={block_types}")

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
- Use available tools whenever they can enhance your response with visualizations, data, or interactive elements
- You can ONLY use tools that are explicitly provided to you - available tools may change based on user preferences
- When multiple tools are available, select the most appropriate combination and use them in the optimal order to fulfill the request
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

            # Use AgentCore Memory Session Manager directly (no buffering)
            # Messages are saved immediately to ensure data consistency
            self.session_manager = AgentCoreMemorySessionManager(
                agentcore_memory_config=agentcore_memory_config,
                region_name=aws_region
            )

            logger.info(f"✅ AgentCore Memory initialized (direct mode): user_id={self.user_id}")
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

    def _get_dynamodb_table_name(self) -> str:
        """
        Get DynamoDB table name using {PROJECT_NAME}-users-v2 pattern.
        No environment variable dependency - automatic discovery.
        """
        project_name = os.environ.get('PROJECT_NAME', 'strands-agent-chatbot')
        return f"{project_name}-users-v2"

    def _load_tool_guidance(self) -> List[str]:
        """
        Load tool-specific system prompt guidance based on enabled tools.

        - Local mode: Load from tools-config.json (required)
        - Cloud mode: Load from DynamoDB {PROJECT_NAME}-users-v2 table (required)

        No fallback - errors are logged clearly for debugging.
        """
        if not self.enabled_tools or len(self.enabled_tools) == 0:
            return []

        import boto3
        from botocore.exceptions import ClientError

        # Get environment variables
        aws_region = os.environ.get('AWS_REGION', 'us-west-2')
        is_local = os.environ.get('NEXT_PUBLIC_AGENTCORE_LOCAL', 'false').lower() == 'true'

        guidance_sections = []

        # Local mode: load from tools-config.json (required)
        if is_local:
            import json
            config_path = Path(__file__).parent.parent.parent.parent / "frontend" / "src" / "config" / "tools-config.json"
            logger.info(f"Loading tool guidance from local: {config_path}")

            if not config_path.exists():
                logger.error(f"❌ TOOL CONFIG NOT FOUND: {config_path}")
                return []

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

        # Cloud mode: load from DynamoDB (required)
        else:
            dynamodb_table = self._get_dynamodb_table_name()
            logger.info(f"Loading tool guidance from DynamoDB table: {dynamodb_table}")

            dynamodb = boto3.resource('dynamodb', region_name=aws_region)
            table = dynamodb.Table(dynamodb_table)

            # Load tool registry from DynamoDB (userId='TOOL_REGISTRY', sk='CONFIG')
            response = table.get_item(Key={'userId': 'TOOL_REGISTRY', 'sk': 'CONFIG'})

            if 'Item' not in response:
                logger.error(f"❌ TOOL_REGISTRY NOT FOUND in DynamoDB table: {dynamodb_table}")
                logger.error("   Please ensure BFF has initialized the tool registry")
                return []

            if 'toolRegistry' not in response['Item']:
                logger.error(f"❌ toolRegistry field NOT FOUND in TOOL_REGISTRY record")
                return []

            tool_registry = response['Item']['toolRegistry']
            logger.info(f"✅ Loaded tool registry from DynamoDB: {dynamodb_table}")

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

        logger.info(f"✅ Tool guidance loaded: {len(guidance_sections)} sections")
        return guidance_sections

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

                # Note: _tool_name_map will be created when Agent calls list_tools_sync()
                # during initialization via Managed Integration.
                # We don't need to call it explicitly here.
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
                read_timeout=300  # Increased to 5 minutes for complex Code Interpreter operations (document generation, charts, etc.)
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
            self.agent = Agent(
                model=model,
                system_prompt=self.system_prompt,  # String system prompt (Strands 1.14.0)
                tools=tools,
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

            # No flush needed - messages are saved immediately by AgentCoreMemorySessionManager

        except Exception as e:
            import traceback
            logger.error(f"Error in stream_async: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")

            # No flush needed - messages are already saved immediately

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
        - Only alphanumeric, hyphens, parentheses, and square brackets
        - Convert underscores and spaces to hyphens for consistency
        - No consecutive hyphens
        """
        import re

        # First, replace underscores and spaces with hyphens
        sanitized = filename.replace('_', '-').replace(' ', '-')

        # Keep only allowed characters: alphanumeric, hyphens, parentheses, square brackets
        sanitized = re.sub(r'[^a-zA-Z0-9\-\(\)\[\]]', '', sanitized)

        # Replace consecutive hyphens with single hyphen
        sanitized = re.sub(r'\-+', '-', sanitized)

        # Trim hyphens from start/end
        sanitized = sanitized.strip('-')

        # If name becomes empty, use default
        if not sanitized:
            sanitized = 'document'

        return sanitized

    def _get_workspace_context(self) -> Optional[str]:
        """Get workspace file list as context string"""
        try:
            from workspace import WordManager
            doc_manager = WordManager(self.user_id, self.session_id)
            documents = doc_manager.list_s3_documents()

            if documents:
                files_list = ", ".join([f"{doc['filename']} ({doc['size_kb']})" for doc in documents])
                return f"[Word documents in your workspace: {files_list}]"
            return None
        except Exception as e:
            logger.debug(f"Failed to get workspace context: {e}")
            return None

    def _get_code_interpreter_id(self) -> Optional[str]:
        """Get Code Interpreter ID from environment or Parameter Store

        Returns:
            Code Interpreter ID string, or None if not found
        """
        # Check environment variable first
        code_interpreter_id = os.getenv('CODE_INTERPRETER_ID')
        if code_interpreter_id:
            logger.info(f"Found CODE_INTERPRETER_ID in environment: {code_interpreter_id}")
            return code_interpreter_id

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
            return code_interpreter_id
        except Exception as e:
            logger.warning(f"CODE_INTERPRETER_ID not found in env or Parameter Store: {e}")
            return None

    def _store_files_by_type(
        self,
        uploaded_files: List[Dict[str, Any]],
        code_interpreter,
        extensions: List[str],
        manager_class,
        document_type: str
    ):
        """Store files of specific type to workspace

        Args:
            uploaded_files: List of uploaded file info dicts
            code_interpreter: Active CodeInterpreter instance
            extensions: List of file extensions to filter (e.g., ['.docx'])
            manager_class: DocumentManager class (e.g., WordDocumentManager)
            document_type: Type name for logging (e.g., 'Word', 'Excel', 'image')
        """
        # Debug: log what we're filtering
        logger.info(f"🔍 Filtering {len(uploaded_files)} files for {document_type} (extensions: {extensions})")
        for f in uploaded_files:
            logger.info(f"   - {f['filename']} (matches: {any(f['filename'].lower().endswith(ext) for ext in extensions)})")

        # Filter files by extensions
        filtered_files = [
            f for f in uploaded_files
            if any(f['filename'].lower().endswith(ext) for ext in extensions)
        ]

        logger.info(f"✅ Filtered {len(filtered_files)} {document_type} file(s)")

        if not filtered_files:
            return

        # Initialize document manager
        doc_manager = manager_class(self.user_id, self.session_id)

        # Store each file
        for file_info in filtered_files:
            try:
                filename = file_info['filename']
                file_bytes = file_info['bytes']

                # Sync to both S3 and Code Interpreter
                doc_manager.sync_to_both(
                    code_interpreter,
                    filename,
                    file_bytes,
                    metadata={'auto_stored': 'true'}
                )
                logger.info(f"✅ Auto-stored {document_type}: {filename}")
            except Exception as e:
                logger.error(f"Failed to auto-store {document_type} file {filename}: {e}")

    def _auto_store_files(self, uploaded_files: List[Dict[str, Any]]):
        """Automatically store all uploaded files to S3 workspace (unified orchestrator)

        This method handles Word documents, Excel spreadsheets, and images in a single
        Code Interpreter session for better performance and maintainability.

        Architecture: S3 as Single Source of Truth
        - All uploaded files → S3 workspace (persistent storage)
        - When tools execute → Load from S3 to Code Interpreter (on-demand)
        - This enables multi-turn file usage and consistent file management

        Args:
            uploaded_files: List of uploaded file info dicts with 'filename' and 'bytes'
        """
        # Debug: log what files we're processing
        logger.info(f"📦 Auto-store called with {len(uploaded_files)} file(s):")
        for f in uploaded_files:
            logger.info(f"   - {f['filename']} ({f['content_type']})")

        try:
            from workspace import (
                WordManager,
                ExcelManager,
                PowerPointManager,
                ImageManager
            )
            from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter

            # Get Code Interpreter ID
            code_interpreter_id = self._get_code_interpreter_id()
            if not code_interpreter_id:
                logger.warning("Cannot auto-store files: CODE_INTERPRETER_ID not configured")
                return

            # Configuration for file types - all stored to S3 workspace for persistence
            file_type_configs = [
                {
                    'extensions': ['.docx'],
                    'manager_class': WordManager,
                    'document_type': 'Word document'
                },
                {
                    'extensions': ['.xlsx'],
                    'manager_class': ExcelManager,
                    'document_type': 'Excel spreadsheet'
                },
                {
                    'extensions': ['.pptx'],
                    'manager_class': PowerPointManager,
                    'document_type': 'PowerPoint presentation'
                },
                {
                    'extensions': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'],
                    'manager_class': ImageManager,
                    'document_type': 'image'
                }
            ]

            # Start Code Interpreter (single session for all file types)
            region = os.getenv('AWS_REGION', 'us-west-2')
            code_interpreter = CodeInterpreter(region)
            code_interpreter.start(identifier=code_interpreter_id)

            try:
                # Process each file type
                for config in file_type_configs:
                    self._store_files_by_type(
                        uploaded_files,
                        code_interpreter,
                        config['extensions'],
                        config['manager_class'],
                        config['document_type']
                    )
            finally:
                code_interpreter.stop()

        except Exception as e:
            logger.error(f"Failed to auto-store files: {e}")

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

        # Check if using AgentCore Memory (cloud mode)
        # AgentCore Memory has a bug where bytes in document ContentBlock cause JSON serialization errors
        # In cloud mode, we skip document ContentBlocks and rely on workspace tools instead
        is_cloud_mode = os.environ.get('MEMORY_ID') is not None and AGENTCORE_MEMORY_AVAILABLE

        # Build ContentBlock list for multimodal input
        content_blocks = []
        uploaded_files = []

        # Add text first (file hints will be added after sanitization)
        text_block_content = message

        # Track sanitized filenames for agent's reference
        sanitized_filenames = []

        # Track files that will use workspace tools (not sent as ContentBlock)
        workspace_only_files = []

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

            # Track sanitized filename for agent's reference
            sanitized_filenames.append(sanitized_full_name)

            # Determine file type and create appropriate ContentBlock
            if content_type.startswith("image/") or filename.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
                # Image content - always send as ContentBlock (works in both local and cloud)
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

            elif filename.endswith(".pptx"):
                # PowerPoint - always use workspace (never sent as ContentBlock)
                workspace_only_files.append(sanitized_full_name)
                logger.info(f"PowerPoint presentation uploaded: {sanitized_full_name} (will be stored in workspace, not sent to model)")

            elif filename.endswith((".docx", ".xlsx")):
                # Word/Excel documents - use workspace in cloud mode to avoid bytes serialization error
                if is_cloud_mode:
                    workspace_only_files.append(sanitized_full_name)
                    logger.info(f"📁 [Cloud Mode] {sanitized_full_name} stored in workspace (skipping document ContentBlock to avoid AgentCore Memory serialization error)")
                else:
                    # Local mode - can send as document ContentBlock
                    doc_format = self._get_document_format(filename)
                    if '.' in sanitized_full_name:
                        name_without_ext = sanitized_full_name.rsplit('.', 1)[0]
                    else:
                        name_without_ext = sanitized_full_name

                    content_blocks.append({
                        "document": {
                            "format": doc_format,
                            "name": name_without_ext,
                            "source": {
                                "bytes": file_bytes
                            }
                        }
                    })
                    logger.info(f"Added document: {file.filename} -> {sanitized_full_name} (format: {doc_format})")

            elif filename.endswith((".pdf", ".csv", ".doc", ".xls", ".html", ".txt", ".md")):
                # Other documents - send as ContentBlock (PDF, CSV, etc. are usually smaller and work better)
                doc_format = self._get_document_format(filename)

                # For Bedrock ContentBlock: name should be WITHOUT extension (extension is in format field)
                if '.' in sanitized_full_name:
                    name_without_ext = sanitized_full_name.rsplit('.', 1)[0]
                else:
                    name_without_ext = sanitized_full_name

                logger.info(f"🔍 [DEBUG] About to add document ContentBlock: name='{name_without_ext}', format={doc_format}, original='{file.filename}'")
                content_blocks.append({
                    "document": {
                        "format": doc_format,
                        "name": name_without_ext,
                        "source": {
                            "bytes": file_bytes
                        }
                    }
                })
                logger.info(f"Added document: {file.filename} -> {sanitized_full_name} (format: {doc_format})")

            else:
                logger.warning(f"Unsupported file type: {filename} ({content_type})")

        # Add file hints to text block (so agent knows the exact filenames stored in workspace)
        if sanitized_filenames:
            # Categorize files
            pptx_files = [fn for fn in sanitized_filenames if fn.endswith('.pptx')]
            docx_files = [fn for fn in workspace_only_files if fn.endswith('.docx')]
            xlsx_files = [fn for fn in workspace_only_files if fn.endswith('.xlsx')]
            # Files sent as ContentBlocks (not in workspace_only_files)
            attached_files = [fn for fn in sanitized_filenames if fn not in workspace_only_files]

            file_hints_lines = []

            # Add files sent as ContentBlocks (attached directly)
            if attached_files:
                file_hints_lines.append("Attached files:")
                file_hints_lines.extend([f"- {fn}" for fn in attached_files])

            # Add workspace-only files with tool hints
            # Word documents
            if docx_files:
                if file_hints_lines:
                    file_hints_lines.append("")
                word_tools_enabled = self.enabled_tools and 'word_document_tools' in self.enabled_tools
                file_hints_lines.append("Word documents in workspace:")
                for fn in docx_files:
                    name_without_ext = fn.rsplit('.', 1)[0] if '.' in fn else fn
                    if word_tools_enabled:
                        file_hints_lines.append(f"- {fn} (use read_word_document('{name_without_ext}') to view content)")
                    else:
                        file_hints_lines.append(f"- {fn}")

            # Excel spreadsheets
            if xlsx_files:
                if file_hints_lines:
                    file_hints_lines.append("")
                excel_tools_enabled = self.enabled_tools and 'excel_spreadsheet_tools' in self.enabled_tools
                file_hints_lines.append("Excel spreadsheets in workspace:")
                for fn in xlsx_files:
                    name_without_ext = fn.rsplit('.', 1)[0] if '.' in fn else fn
                    if excel_tools_enabled:
                        file_hints_lines.append(f"- {fn} (use read_excel_spreadsheet('{name_without_ext}') to view content)")
                    else:
                        file_hints_lines.append(f"- {fn}")

            # PowerPoint presentations
            if pptx_files:
                if file_hints_lines:
                    file_hints_lines.append("")
                ppt_tools_enabled = self.enabled_tools and 'powerpoint_presentation_tools' in self.enabled_tools
                file_hints_lines.append("PowerPoint presentations in workspace:")
                for fn in pptx_files:
                    name_without_ext = fn.rsplit('.', 1)[0] if '.' in fn else fn
                    if ppt_tools_enabled:
                        file_hints_lines.append(f"- {fn} (use analyze_presentation('{name_without_ext}', verbose=False) to view content)")
                    else:
                        file_hints_lines.append(f"- {fn}")

            file_hints = "\n".join(file_hints_lines)
            text_block_content = f"{text_block_content}\n\n<uploaded_files>\n{file_hints}\n</uploaded_files>"
            logger.info(f"Added file hints to prompt: {sanitized_filenames}")

        # Insert text block at the beginning of content_blocks
        content_blocks.insert(0, {"text": text_block_content})

        # Auto-store files to workspace (Word, Excel, images)
        self._auto_store_files(uploaded_files)

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
