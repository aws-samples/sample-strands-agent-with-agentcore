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

# AgentCore Memory integration (optional, only for cloud deployment)
try:
    from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig
    from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
    AGENTCORE_MEMORY_AVAILABLE = True
except ImportError:
    AGENTCORE_MEMORY_AVAILABLE = False

# Import Strands built-in tools
from strands_tools.calculator import calculator

# Import local tools (general-purpose, agent-core integrated)
from local_tools.weather import get_current_weather
from local_tools.visualization import create_visualization
from local_tools.web_search import ddg_web_search
from local_tools.url_fetcher import fetch_url_content

logger = logging.getLogger(__name__)

# Global stream processor instance
_global_stream_processor = None

def get_global_stream_processor():
    """Get the global stream processor instance"""
    return _global_stream_processor


# Tool ID to tool object mapping
TOOL_REGISTRY = {
    "calculator": calculator,
    "get_current_weather": get_current_weather,
    "create_visualization": create_visualization,
    "ddg_web_search": ddg_web_search,
    "fetch_url_content": fetch_url_content,
}


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

        # Store model configuration
        self.model_id = model_id or "us.anthropic.claude-haiku-4-5-20251001-v1:0"
        self.temperature = temperature if temperature is not None else 0.7
        self.system_prompt = system_prompt or "You are a helpful AI assistant."
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

            # Create AgentCore Memory Session Manager
            self.session_manager = AgentCoreMemorySessionManager(
                agentcore_memory_config=agentcore_memory_config,
                region_name=aws_region
            )

            logger.info(f"✅ AgentCore Memory initialized: user_id={self.user_id}")
        else:
            # Local development: Use file-based session manager
            logger.info(f"💻 Local mode: Using FileSessionManager")
            sessions_dir = Path(__file__).parent.parent.parent / "sessions"
            sessions_dir.mkdir(exist_ok=True)

            self.session_manager = FileSessionManager(
                session_id=session_id,
                storage_dir=str(sessions_dir)
            )

            logger.info(f"✅ FileSessionManager initialized: {sessions_dir}")

        self.create_agent()

    def get_model_config(self) -> Dict[str, Any]:
        """Return model configuration"""
        return {
            "model_id": self.model_id,
            "temperature": self.temperature,
            "system_prompts": [self.system_prompt],
            "caching_enabled": self.caching_enabled
        }

    def get_filtered_tools(self) -> List:
        """Get tools filtered by enabled_tools list"""
        # If no enabled_tools specified (None or empty), return NO tools
        if self.enabled_tools is None or len(self.enabled_tools) == 0:
            logger.info("No enabled_tools specified - Agent will run WITHOUT any tools")
            return []

        # Filter tools based on enabled_tools
        filtered_tools = []
        for tool_id in self.enabled_tools:
            if tool_id in TOOL_REGISTRY:
                filtered_tools.append(TOOL_REGISTRY[tool_id])
            else:
                logger.warning(f"Tool '{tool_id}' not found in registry, skipping")

        logger.info(f"User-specific tool filter: {len(filtered_tools)} enabled tools: {self.enabled_tools}")
        return filtered_tools

    def create_agent(self):
        """Create Strands agent with filtered tools and session management"""
        try:
            config = self.get_model_config()

            # Create model
            model = BedrockModel(
                model_id=config["model_id"],
                temperature=config.get("temperature", 0.7),
                system=config.get("system_prompts", [])
            )

            # Get filtered tools based on user preferences
            tools = self.get_filtered_tools()

            # Create agent with session manager for automatic conversation persistence
            # If session_manager is None (no MEMORY_ID), Agent will run without memory
            self.agent = Agent(
                model=model,
                tools=tools,
                session_manager=self.session_manager  # ← AgentCore Memory: auto load/save
            )

            logger.info(f"✅ Agent created with {len(tools)} tools")
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

        try:
            logger.info(f"Streaming message: {message[:50]}...")
            if files:
                logger.info(f"Processing {len(files)} file(s)")

            # Convert files to Strands ContentBlock format if provided
            prompt = self._build_prompt(message, files)

            # Log prompt type for debugging (without printing bytes)
            if isinstance(prompt, list):
                logger.info(f"Prompt is list with {len(prompt)} content blocks")
            else:
                logger.info(f"Prompt is string: {prompt[:100]}")

            # Use stream processor to handle Strands agent streaming
            async for event in self.stream_processor.process_stream(
                self.agent,
                prompt,  # Can be str or list[ContentBlock]
                file_paths=None,
                session_id=session_id or "default"
            ):
                yield event

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

    def _sanitize_filename(self, filename: str) -> str:
        """
        Sanitize filename to meet AWS Bedrock requirements:
        - Only alphanumeric, whitespace, hyphens, parentheses, and square brackets
        - No consecutive whitespace
        """
        import re

        # Replace special characters (except allowed ones) with underscore
        sanitized = re.sub(r'[^a-zA-Z0-9\s\-\(\)\[\]]', '_', filename)

        # Replace consecutive whitespace with single space
        sanitized = re.sub(r'\s+', ' ', sanitized)

        # Trim whitespace
        sanitized = sanitized.strip()

        return sanitized

    def _build_prompt(self, message: str, files: Optional[List] = None):
        """
        Build prompt for Strands Agent

        Args:
            message: User message text
            files: Optional list of FileContent objects with base64 bytes

        Returns:
            str or list[ContentBlock]: Prompt for Strands Agent
        """
        import base64

        # If no files, return simple text
        if not files or len(files) == 0:
            return message

        # Build ContentBlock list for multimodal input
        content_blocks = []

        # Add text first
        content_blocks.append({"text": message})

        # Add each file as appropriate ContentBlock
        for file in files:
            content_type = file.content_type.lower()
            filename = file.filename.lower()

            # Decode base64 to bytes
            file_bytes = base64.b64decode(file.bytes)

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

                # Sanitize filename for Bedrock
                sanitized_name = self._sanitize_filename(file.filename)

                content_blocks.append({
                    "document": {
                        "format": doc_format,
                        "name": sanitized_name,
                        "source": {
                            "bytes": file_bytes
                        }
                    }
                })
                logger.info(f"Added document: {filename} -> {sanitized_name} (format: {doc_format})")

            else:
                logger.warning(f"Unsupported file type: {filename} ({content_type})")

        return content_blocks

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
