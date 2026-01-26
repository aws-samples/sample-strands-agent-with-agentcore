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
from strands import Agent
from strands.models import BedrockModel
from strands.session.file_session_manager import FileSessionManager
from streaming.event_processor import StreamEventProcessor
from agent.hooks import ResearchApprovalHook, ConversationCachingHook
from agent.prompt_builder import (
    build_text_system_prompt,
    system_prompt_to_string,
    load_tool_guidance,
    SystemContentBlock,
)

# AgentCore Memory integration (optional, only for cloud deployment)
try:
    from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig
    from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
    from agent.compacting_session_manager import CompactingSessionManager
    AGENTCORE_MEMORY_AVAILABLE = True
except ImportError:
    AGENTCORE_MEMORY_AVAILABLE = False

# Import Strands built-in tools
from strands_tools.calculator import calculator

# Import local tools module (general-purpose, agent-core integrated)
import local_tools

# Import built-in tools module (AWS Bedrock-powered tools)
import builtin_tools

# Import unified tool filter
from agent.tool_filter import filter_tools
# Import unified file session manager for cross-agent history sharing (local mode)
from agent.unified_file_session_manager import UnifiedFileSessionManager

logger = logging.getLogger(__name__)

# Global stream processor instance
_global_stream_processor = None

# Global cache for Memory Strategy IDs (loaded once per container lifecycle)
_cached_strategy_ids: Optional[Dict[str, str]] = None

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
    logger.debug(f"Registered local tool: {tool_name}")

# Dynamically load all builtin tools from builtin_tools.__all__
# This ensures we only need to maintain the list in one place (__init__.py)
for tool_name in builtin_tools.__all__:
    tool_obj = getattr(builtin_tools, tool_name)
    TOOL_REGISTRY[tool_name] = tool_obj
    logger.debug(f"Registered builtin tool: {tool_name}")


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
        caching_enabled: Optional[bool] = None,
        compaction_enabled: Optional[bool] = None,
        use_null_conversation_manager: Optional[bool] = None
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
            compaction_enabled: Whether to enable context compaction (default: True)
            use_null_conversation_manager: Use NullConversationManager instead of default SlidingWindow (default: False)
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

        # Build system prompt using prompt_builder module
        # Returns list of SystemContentBlock for better tracking and caching control
        self.system_prompt = build_text_system_prompt(
            enabled_tools=enabled_tools
        )

        self.caching_enabled = caching_enabled if caching_enabled is not None else True
        self.compaction_enabled = compaction_enabled if compaction_enabled is not None else True
        self.use_null_conversation_manager = use_null_conversation_manager if use_null_conversation_manager is not None else False

        # Session Manager Selection: AgentCore Memory (cloud) vs File-based (local)
        memory_id = os.environ.get('MEMORY_ID')
        aws_region = os.environ.get('AWS_REGION', 'us-west-2')

        if memory_id and AGENTCORE_MEMORY_AVAILABLE:
            # Cloud deployment: Use AgentCore Memory
            logger.debug(f"Cloud mode: Using AgentCore Memory (memory_id={memory_id})")

            # Get strategy IDs dynamically from Memory configuration
            strategy_ids = self._get_memory_strategy_ids(memory_id, aws_region)

            # Build retrieval_config using actual namespace patterns from Memory strategies
            # Namespace pattern: /strategies/{memoryStrategyId}/actors/{actorId}
            retrieval_config = {}

            # User preferences (coding style, language preference, etc.)
            if 'USER_PREFERENCE' in strategy_ids:
                pref_namespace = f"/strategies/{strategy_ids['USER_PREFERENCE']}/actors/{self.user_id}"
                retrieval_config[pref_namespace] = RetrievalConfig(top_k=5, relevance_score=0.7)
                logger.debug(f"User preferences namespace: {pref_namespace}")

            # Semantic facts (learned information about user)
            if 'SEMANTIC' in strategy_ids:
                facts_namespace = f"/strategies/{strategy_ids['SEMANTIC']}/actors/{self.user_id}"
                retrieval_config[facts_namespace] = RetrievalConfig(top_k=10, relevance_score=0.3)
                logger.debug(f"Semantic facts namespace: {facts_namespace}")

            # Session summaries (previous conversation summaries)
            # Note: Summary namespace includes sessionId, so we use a broader pattern for cross-session retrieval
            if 'SUMMARIZATION' in strategy_ids:
                # For summaries, we retrieve from the actor-level to get summaries across sessions
                summary_namespace = f"/strategies/{strategy_ids['SUMMARIZATION']}/actors/{self.user_id}"
                retrieval_config[summary_namespace] = RetrievalConfig(top_k=3, relevance_score=0.5)
                logger.debug(f"Session summaries namespace: {summary_namespace}")

            if not retrieval_config:
                logger.warning("No retrieval_config configured - LTM retrieval disabled")

            # Configure AgentCore Memory with dynamic retrieval config
            # LTM retrieval disabled - set retrieval_config=None to skip retrieve_customer_context hook
            agentcore_memory_config = AgentCoreMemoryConfig(
                memory_id=memory_id,
                session_id=session_id,
                actor_id=self.user_id,
                enable_prompt_caching=caching_enabled if caching_enabled is not None else True,
                retrieval_config=None
            )

            # Session Manager selection based on compaction_enabled flag
            if self.compaction_enabled:
                # Use CompactingSessionManager for token-based context compaction
                # Two-feature compaction:
                # - Feature 1: Truncation (always applied) - truncate old tool contents
                # - Feature 2: Checkpoint (token_threshold 100K) - skip old messages + summary
                # Configuration via environment variables (with sensible defaults)
                token_threshold = int(os.environ.get('COMPACTION_TOKEN_THRESHOLD', '100000'))
                protected_turns = int(os.environ.get('COMPACTION_PROTECTED_TURNS', '2'))
                max_tool_content_length = int(os.environ.get('COMPACTION_MAX_TOOL_LENGTH', '500'))

                # Get SUMMARIZATION strategy ID for summary retrieval
                summarization_strategy_id = strategy_ids.get('SUMMARIZATION')

                self.session_manager = CompactingSessionManager(
                    agentcore_memory_config=agentcore_memory_config,
                    region_name=aws_region,
                    token_threshold=token_threshold,
                    protected_turns=protected_turns,
                    max_tool_content_length=max_tool_content_length,
                    user_id=self.user_id,
                    summarization_strategy_id=summarization_strategy_id
                )

                logger.debug(f"AgentCore Memory initialized (with compaction): user_id={self.user_id}")
                logger.debug(f"   LTM retrieval: {len(retrieval_config)} namespace(s) configured")
                logger.debug(f"   Compaction: threshold={token_threshold:,}, protected_turns={protected_turns}")
            else:
                # Use CompactingSessionManager with metrics_only=True for baseline mode
                # This enables context token tracking without applying compaction
                self.session_manager = CompactingSessionManager(
                    agentcore_memory_config=agentcore_memory_config,
                    region_name=aws_region,
                    user_id=self.user_id,
                    metrics_only=True  # Track metrics but don't apply compaction
                )

                logger.debug(f"AgentCore Memory initialized (metrics_only - baseline): user_id={self.user_id}")
                logger.debug(f"   LTM retrieval: {len(retrieval_config)} namespace(s) configured")
                logger.debug(f"    Compaction DISABLED - all messages loaded without truncation or summarization")
                logger.debug(f"   Context token tracking ENABLED for baseline comparison")
        else:
            # Local development: Use unified file session manager for cross-agent history sharing
            # UnifiedFileSessionManager overrides list_messages to read from ALL agent folders,
            # enabling voice-text conversation continuity (matching cloud mode behavior)
            logger.debug(f"💻 Local mode: Using UnifiedFileSessionManager with buffering")
            sessions_dir = Path(__file__).parent.parent.parent / "sessions"
            sessions_dir.mkdir(exist_ok=True)

            base_file_manager = UnifiedFileSessionManager(
                session_id=session_id,
                storage_dir=str(sessions_dir)
            )

            # Wrap with local buffering manager for stop functionality
            from agent.local_session_buffer import LocalSessionBuffer
            self.session_manager = LocalSessionBuffer(
                base_manager=base_file_manager,
                session_id=session_id
            )

            logger.debug(f"UnifiedFileSessionManager with buffering initialized: {sessions_dir}")

        self.create_agent()

    def get_model_config(self) -> Dict[str, Any]:
        """Return model configuration"""
        return {
            "model_id": self.model_id,
            "temperature": self.temperature,
            "system_prompt": system_prompt_to_string(self.system_prompt),
            "system_prompt_blocks": len(self.system_prompt),
            "caching_enabled": self.caching_enabled
        }

    def _get_dynamodb_table_name(self) -> str:
        """
        Get DynamoDB table name using {PROJECT_NAME}-users-v2 pattern.
        No environment variable dependency - automatic discovery.
        """
        project_name = os.environ.get('PROJECT_NAME', 'strands-agent-chatbot')
        return f"{project_name}-users-v2"

    def _get_memory_strategy_ids(self, memory_id: str, aws_region: str) -> Dict[str, str]:
        """Get Memory Strategy IDs from AgentCore Memory with global caching."""
        global _cached_strategy_ids

        if _cached_strategy_ids is not None:
            return _cached_strategy_ids

        import boto3

        try:
            gmcp = boto3.client('bedrock-agentcore-control', region_name=aws_region)
            response = gmcp.get_memory(memoryId=memory_id)
            memory = response['memory']
            strategies = memory.get('strategies', memory.get('memoryStrategies', []))

            strategy_map = {
                s.get('type', s.get('memoryStrategyType', '')): s.get('strategyId', s.get('memoryStrategyId', ''))
                for s in strategies
                if s.get('type', s.get('memoryStrategyType', '')) and s.get('strategyId', s.get('memoryStrategyId', ''))
            }

            _cached_strategy_ids = strategy_map
            logger.info(f"[StrategyCache] Loaded {len(strategy_map)} strategy IDs: {list(strategy_map.keys())}")

            return strategy_map
        except Exception as e:
            logger.warning(f"Failed to get memory strategy IDs: {e}")
            return {}

    def get_filtered_tools(self) -> List:
        """
        Get tools filtered by enabled_tools list.
        Uses unified tool_filter module for local, Gateway, and A2A tools.
        """
        result = filter_tools(
            enabled_tool_ids=self.enabled_tools,
            log_prefix="[ChatbotAgent]"
        )

        # Store Gateway client for lifecycle management
        self.gateway_client = result.clients.get("gateway")

        # Log any validation errors
        for error in result.validation_errors:
            logger.warning(f"[ChatbotAgent] {error}")

        return result.tools

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

            # Note: We intentionally do NOT use cache_prompt="default" here.
            # ConversationCachingHook adds a single cache point at the end which covers
            # the entire conversation including system prompt. Adding a separate system
            # prompt cache point would cause duplicate write premiums (25% extra cost)
            # without any read benefit. Testing showed this costs ~21% more than needed.

            logger.debug("Bedrock retry config: max_attempts=10, mode=adaptive")
            model = BedrockModel(**model_config)

            # Get filtered tools based on user preferences
            tools = self.get_filtered_tools()

            # Create hooks
            hooks = []

            # Add research approval hook (always enabled)
            research_approval_hook = ResearchApprovalHook(app_name="chatbot")
            hooks.append(research_approval_hook)
            logger.debug("Research approval hook enabled (BeforeToolCallEvent)")

            # Add conversation caching hook if enabled
            if self.caching_enabled:
                conversation_hook = ConversationCachingHook(enabled=True)
                hooks.append(conversation_hook)
                logger.debug("Conversation caching hook enabled")

            # Create agent with session manager, hooks, and system prompt as list of content blocks
            # Using list[SystemContentBlock] enables:
            # - Better tracking of each prompt section
            # - Flexible cache point insertion
            # - Modular prompt management
            agent_kwargs = {
                "model": model,
                "system_prompt": self.system_prompt,  # List[SystemContentBlock]
                "tools": tools,
                "session_manager": self.session_manager,
                "hooks": hooks if hooks else None
            }

            # Use NullConversationManager if requested (disables Strands' default sliding window)
            if self.use_null_conversation_manager:
                from strands.agent.conversation_manager import NullConversationManager
                agent_kwargs["conversation_manager"] = NullConversationManager()
                logger.debug("Using NullConversationManager (no context manipulation by Strands)")

            self.agent = Agent(**agent_kwargs)

            # Note: Voice history is now automatically loaded via CompactingSessionManager
            # since both voice and text agents use unified format storage.
            # No need for separate voice history injection - all messages are shared.

            # Calculate total characters for logging
            total_chars = sum(len(block.get("text", "")) for block in self.system_prompt)
            logger.debug(f"Agent created with {len(tools)} tools")
            logger.debug(f"System prompt: {len(self.system_prompt)} content blocks, {total_chars} characters")
            logger.debug(f"Session Manager: {type(self.session_manager).__name__}")

            if AGENTCORE_MEMORY_AVAILABLE and os.environ.get('MEMORY_ID'):
                logger.debug(f"   • Session: {self.session_id}, User: {self.user_id}")
                logger.debug(f"   • Short-term memory: Conversation history (90 days retention)")
                logger.debug(f"   • Long-term memory: User preferences and facts across sessions")
            else:
                logger.debug(f"   • Session: {self.session_id}")
                logger.debug(f"   • File-based persistence: {self.session_manager.storage_dir}")

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
            # Reset context token tracking for new turn
            if hasattr(self.session_manager, 'reset_context_token_tracking'):
                self.session_manager.reset_context_token_tracking()

            logger.debug(f"Streaming message: {message[:50]}...")
            if files:
                logger.debug(f"Processing {len(files)} file(s)")

            # Convert files to Strands ContentBlock format and prepare uploaded_files for tools
            prompt, uploaded_files = self._build_prompt(message, files)

            # Log prompt type for debugging (without printing bytes)
            if isinstance(prompt, list):
                logger.debug(f"Prompt is list with {len(prompt)} content blocks")
            else:
                logger.debug(f"Prompt is string: {prompt[:100]}")

            # Prepare invocation_state with model_id, user_id, session_id, and uploaded files
            invocation_state = {
                "session_id": self.session_id,
                "user_id": self.user_id,
                "model_id": self.model_id
            }

            # Add uploaded files to invocation_state (for tool access)
            if uploaded_files:
                invocation_state['uploaded_files'] = uploaded_files
                logger.debug(f"Added {len(uploaded_files)} file(s) to invocation_state")

            # Use stream processor to handle Strands agent streaming
            async for event in self.stream_processor.process_stream(
                self.agent,
                prompt,  # Can be str or list[ContentBlock]
                file_paths=None,
                session_id=session_id or "default",
                invocation_state=invocation_state
            ):
                yield event

            # Update compaction state after turn completion
            self._update_compaction_state()

        except Exception as e:
            import traceback
            logger.error(f"Error in stream_async: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")

            # Send error event
            import json
            error_event = {
                "type": "error",
                "message": str(e)
            }
            yield f"data: {json.dumps(error_event)}\n\n"

    def _update_compaction_state(self):
        """Update compaction state after turn completion (if using CompactingSessionManager).

        Uses last_llm_input_tokens from stream_processor, which captures the inputTokens
        from the LAST LLM call's metadata (not accumulated across all calls in the turn).

        This is the actual context size for compaction threshold decisions.
        """
        if not hasattr(self.session_manager, 'update_after_turn'):
            return

        try:
            # Get last LLM call's input tokens from stream processor
            # This is the actual context size (not accumulated across multiple LLM calls)
            context_tokens = self.stream_processor.last_llm_input_tokens
            logger.debug(f"_update_compaction_state: context_tokens={context_tokens:,} (from last LLM call)")

            if context_tokens > 0:
                self.session_manager.update_after_turn(context_tokens, self.agent.agent_id)
                logger.debug(f"Compaction updated: context={context_tokens:,} tokens")
            else:
                # Skip compaction if no token data available
                logger.debug(f"Skipping compaction: context_tokens=0 (no token data from stream processor)")
        except Exception as e:
            logger.error(f"Compaction update failed: {e}")

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
            logger.debug(f"Found CODE_INTERPRETER_ID in environment: {code_interpreter_id}")
            return code_interpreter_id

        # Try Parameter Store
        try:
            import boto3
            project_name = os.getenv('PROJECT_NAME', 'strands-agent-chatbot')
            environment = os.getenv('ENVIRONMENT', 'dev')
            region = os.getenv('AWS_REGION', 'us-west-2')
            param_name = f"/{project_name}/{environment}/agentcore/code-interpreter-id"

            logger.debug(f"Checking Parameter Store for Code Interpreter ID: {param_name}")
            ssm = boto3.client('ssm', region_name=region)
            response = ssm.get_parameter(Name=param_name)
            code_interpreter_id = response['Parameter']['Value']
            logger.debug(f"Found CODE_INTERPRETER_ID in Parameter Store: {code_interpreter_id}")
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
        logger.debug(f"Filtering {len(uploaded_files)} files for {document_type} (extensions: {extensions})")
        for f in uploaded_files:
            logger.debug(f"   - {f['filename']} (matches: {any(f['filename'].lower().endswith(ext) for ext in extensions)})")

        # Filter files by extensions
        filtered_files = [
            f for f in uploaded_files
            if any(f['filename'].lower().endswith(ext) for ext in extensions)
        ]

        logger.debug(f"Filtered {len(filtered_files)} {document_type} file(s)")

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
                logger.debug(f"Auto-stored {document_type}: {filename}")
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
        logger.debug(f"Auto-store called with {len(uploaded_files)} file(s):")
        for f in uploaded_files:
            logger.debug(f"   - {f['filename']} ({f['content_type']})")

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
                logger.debug(f"Added image: {filename} (format: {image_format})")

            elif filename.endswith(".pptx"):
                # PowerPoint - always use workspace (never sent as ContentBlock)
                workspace_only_files.append(sanitized_full_name)
                logger.debug(f"PowerPoint presentation uploaded: {sanitized_full_name} (will be stored in workspace, not sent to model)")

            elif filename.endswith((".docx", ".xlsx")):
                # Word/Excel documents - use workspace in cloud mode to avoid bytes serialization error
                if is_cloud_mode:
                    workspace_only_files.append(sanitized_full_name)
                    logger.debug(f"[Cloud Mode] {sanitized_full_name} stored in workspace (skipping document ContentBlock to avoid AgentCore Memory serialization error)")
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
                    logger.debug(f"Added document: {file.filename} -> {sanitized_full_name} (format: {doc_format})")

            elif filename.endswith((".pdf", ".csv", ".doc", ".xls", ".html", ".txt", ".md")):
                # Other documents - send as ContentBlock (PDF, CSV, etc. are usually smaller and work better)
                doc_format = self._get_document_format(filename)

                # For Bedrock ContentBlock: name should be WITHOUT extension (extension is in format field)
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
                logger.debug(f"Added document: {file.filename} -> {sanitized_full_name} (format: {doc_format})")

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
            logger.debug(f"Added file hints to prompt: {sanitized_filenames}")

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
