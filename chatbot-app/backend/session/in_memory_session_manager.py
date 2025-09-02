"""InMemory implementation of Strands SessionManager interface."""

import json
import logging
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from strands.session import SessionManager
from strands.types.content import Message

if TYPE_CHECKING:
    from strands.agent.agent import Agent

logger = logging.getLogger(__name__)


class InMemorySessionManager(SessionManager):
    """Memory-based session manager implementing Strands SessionManager interface.
    
    Provides session isolation with complete message history and agent state management.
    Designed to be compatible with future Redis/Database implementations.
    """
    
    def __init__(self, session_id: str):
        """Initialize session manager for a specific session.
        
        Args:
            session_id: Unique identifier for this session
        """
        self.session_id = session_id
        
        # Session-isolated storage
        self.messages: List[Message] = []
        self.agent_state: Dict[str, Any] = {}
        self.conversation_manager_state: Dict[str, Any] = {}
        
        # Session-specific tool configuration
        self.tool_config: Dict[str, Any] = self._load_default_tool_config()
        
        # Session-specific model configuration
        self.model_config: Dict[str, Any] = self._load_default_model_config()
        
        # Configuration change tracking
        self.model_config_changed: bool = False
        self.tool_config_changed: bool = False
        
        # Session metadata
        self.created_at = datetime.now()
        self.last_activity = datetime.now()
        
        logger.info(f"InMemorySessionManager created for session: {session_id}")
    
    def initialize(self, agent: "Agent", **kwargs: Any) -> None:
        """Initialize agent with session data.
        
        Called when agent is created/recreated to restore conversation history
        and agent state from the session.
        
        Args:
            agent: Agent instance to initialize
            **kwargs: Additional keyword arguments for future extensibility
        """
        try:
            # 1. Restore message history
            if self.messages:
                agent.messages = self.messages.copy()
                logger.info(f"Session {self.session_id}: Restored {len(self.messages)} messages")
            
            # 2. Restore ConversationManager state
            if hasattr(agent, 'conversation_manager') and self.conversation_manager_state:
                try:
                    restored_messages = agent.conversation_manager.restore_from_session(
                        self.conversation_manager_state
                    )
                    if restored_messages:
                        # Prepend any messages returned by conversation manager
                        agent.messages = restored_messages + agent.messages
                        logger.info(f"Session {self.session_id}: ConversationManager restored additional messages")
                except Exception as cm_error:
                    logger.warning(f"Session {self.session_id}: ConversationManager restore failed: {cm_error}")
            
            # 3. Restore Agent state
            if hasattr(agent, 'state') and self.agent_state:
                try:
                    agent.state.update(self.agent_state)
                    logger.info(f"Session {self.session_id}: Agent state restored")
                except Exception as state_error:
                    logger.warning(f"Session {self.session_id}: Agent state restore failed: {state_error}")
            
            self.last_activity = datetime.now()
            logger.info(f"Session {self.session_id}: Agent initialization completed")
            
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to initialize agent: {e}")
            # Don't raise - allow agent to start with clean state
    
    def append_message(self, message: Message, agent: "Agent", **kwargs: Any) -> None:
        """Append a message to the session.
        
        Args:
            message: Message to add to the session
            agent: Agent that the message belongs to
            **kwargs: Additional keyword arguments for future extensibility
        """
        try:
            # Sanitize message to handle binary data safely
            safe_message = self._sanitize_message(message)
            self.messages.append(safe_message)
            self.last_activity = datetime.now()
            
            logger.debug(f"Session {self.session_id}: Message appended (total: {len(self.messages)})")
            
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to append message: {e}")
    
    def sync_agent(self, agent: "Agent", **kwargs: Any) -> None:
        """Synchronize agent state with session storage.
        
        Args:
            agent: Agent to synchronize
            **kwargs: Additional keyword arguments for future extensibility
        """
        try:
            # 1. Save ConversationManager state
            if hasattr(agent, 'conversation_manager'):
                try:
                    self.conversation_manager_state = agent.conversation_manager.get_state()
                    logger.debug(f"Session {self.session_id}: ConversationManager state synced")
                except Exception as cm_error:
                    logger.warning(f"Session {self.session_id}: ConversationManager sync failed: {cm_error}")
            
            # 2. Save Agent state
            if hasattr(agent, 'state'):
                try:
                    # Create a safe copy of agent state
                    self.agent_state = dict(agent.state) if hasattr(agent.state, '__iter__') else {}
                    logger.debug(f"Session {self.session_id}: Agent state synced")
                except Exception as state_error:
                    logger.warning(f"Session {self.session_id}: Agent state sync failed: {state_error}")
            
            self.last_activity = datetime.now()
            
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to sync agent: {e}")
    
    def redact_latest_message(self, redact_message: Message, agent: "Agent", **kwargs: Any) -> None:
        """Redact the most recently appended message.
        
        Called when guardrails or other systems need to modify the latest message.
        
        Args:
            redact_message: New message content to replace the latest message
            agent: Agent that the message belongs to
            **kwargs: Additional keyword arguments for future extensibility
        """
        try:
            if self.messages:
                safe_message = self._sanitize_message(redact_message)
                self.messages[-1] = safe_message
                self.last_activity = datetime.now()
                
                logger.info(f"Session {self.session_id}: Latest message redacted")
            else:
                logger.warning(f"Session {self.session_id}: No messages to redact")
                
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to redact message: {e}")
    
    def _sanitize_message(self, message: Message) -> Message:
        """Sanitize message content to handle binary data safely.
        
        Args:
            message: Original message that may contain binary data
            
        Returns:
            Sanitized message safe for JSON serialization
        """
        try:
            safe_message = {
                "role": message["role"],
                "content": []
            }
            
            # Process content to remove/convert binary data
            for content_item in message.get("content", []):
                if isinstance(content_item, dict):
                    if "text" in content_item:
                        safe_message["content"].append({"text": content_item["text"]})
                    elif "image" in content_item:
                        # Replace image content with placeholder
                        safe_message["content"].append({
                            "text": "[Image content - stored separately for session management]"
                        })
                    elif "document" in content_item:
                        # Replace document content with placeholder
                        document_name = content_item.get("document", {}).get("name", "unknown")
                        safe_message["content"].append({
                            "text": f"[Document: {document_name} - stored separately for session management]"
                        })
                    elif "toolResult" in content_item:
                        # Keep tool results but ensure they're serializable
                        tool_result = content_item["toolResult"]
                        safe_tool_result = {
                            "toolUseId": tool_result.get("toolUseId", ""),
                            "status": tool_result.get("status", "success"),
                            "content": []
                        }
                        
                        # Process tool result content
                        for result_content in tool_result.get("content", []):
                            if isinstance(result_content, dict) and "text" in result_content:
                                safe_tool_result["content"].append({"text": result_content["text"]})
                            else:
                                safe_tool_result["content"].append({"text": str(result_content)})
                        
                        safe_message["content"].append({"toolResult": safe_tool_result})
                    elif "toolUse" in content_item:
                        # Keep tool use as-is (should be serializable)
                        safe_message["content"].append(content_item)
                    else:
                        # Convert other content types to text safely
                        safe_message["content"].append({"text": str(content_item)})
                else:
                    # Handle string content
                    safe_message["content"].append({"text": str(content_item)})
            
            return safe_message
            
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to sanitize message: {e}")
            # Return a minimal safe message
            return {
                "role": message.get("role", "user"),
                "content": [{"text": "[Message sanitization failed - content not stored]"}]
            }
    
    def _load_default_tool_config(self) -> Dict[str, Any]:
        """Load default tool configuration from unified_tools_config.json.
        
        Returns:
            Dictionary containing tool configuration
        """
        try:
            import os
            config_path = os.path.join(os.path.dirname(__file__), '..', 'unified_tools_config.json')
            with open(config_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load default tool config: {e}")
            return {"tools": []}
    
    def _load_default_model_config(self) -> Dict[str, Any]:
        """Load default model configuration from model_config.json.
        
        Returns:
            Dictionary containing model configuration
        """
        try:
            import os
            config_path = os.path.join(os.path.dirname(__file__), '..', 'model_config.json')
            with open(config_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load default model config: {e}")
            return {
                "model_id": "us.anthropic.claude-sonnet-4-20250514-v1:0",
                "temperature": 0.7,
                "system_prompts": [
                    {
                        "id": "default",
                        "name": "General Assistant",
                        "prompt": "You are a helpful AI assistant with vision capabilities. Use only the tools that are explicitly provided to you. If a user asks for functionality that requires a tool you don't have, clearly explain that the tool is not available.",
                        "active": True
                    }
                ]
            }
    
    def add_cache_point_to_last_message(self) -> bool:
        """Add cache point to the last message if it contains tool results"""
        try:
            if self.messages and len(self.messages) > 0:
                last_message = self.messages[-1]
                
                # Check if this message contains tool results (could be user or assistant message)
                has_tool_result = False
                if isinstance(last_message.content, list):
                    has_tool_result = any(
                        isinstance(item, dict) and "toolResult" in item 
                        for item in last_message.content
                    )
                
                # Add cache point to messages with tool results
                if has_tool_result:
                    if isinstance(last_message.content, list):
                        # Check if cache point already exists
                        has_cache_point = any(
                            isinstance(item, dict) and "cachePoint" in item 
                            for item in last_message.content
                        )
                        
                        if not has_cache_point:
                            last_message.content.append({
                                "cachePoint": {"type": "default"}
                            })
                            logger.debug(f"Session {self.session_id}: Cache point added to last message")
                            return True
                    elif isinstance(last_message.content, str):
                        # Convert string to list with cache point
                        last_message.content = [
                            {"text": last_message.content},
                            {"cachePoint": {"type": "default"}}
                        ]
                        logger.debug(f"Session {self.session_id}: Cache point added to converted message")
                        return True
            return False
                        
        except Exception as e:
            logger.warning(f"Session {self.session_id}: Failed to add cache point: {e}")
            return False
    
    def get_tool_config(self) -> Dict[str, Any]:
        """Get current session-specific tool configuration.
        
        Returns:
            Dictionary containing tool configuration
        """
        return self.tool_config.copy()
    
    def update_tool_enabled(self, tool_id: str, enabled: bool) -> bool:
        """Update tool enabled status for this session.
        
        Args:
            tool_id: ID of the tool to update
            enabled: New enabled status
            
        Returns:
            True if tool was found and updated, False otherwise
        """
        try:
            for tool in self.tool_config.get("tools", []):
                if tool.get("id") == tool_id:
                    tool["enabled"] = enabled
                    self.tool_config_changed = True  # Set change flag
                    self.last_activity = datetime.now()
                    return True
            
            logger.warning(f"Session {self.session_id}: Tool {tool_id} not found")
            return False
            
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to update tool {tool_id}: {e}")
            return False
    
    def add_tool_to_config(self, tool_config: Dict[str, Any]) -> bool:
        """Add a new tool to the session's tool configuration.
        
        Args:
            tool_config: Complete tool configuration dictionary
            
        Returns:
            True if tool was added successfully, False otherwise
        """
        try:
            # Check if tool with same ID already exists
            tool_id = tool_config.get("id")
            if not tool_id:
                logger.error(f"Session {self.session_id}: Tool config missing 'id' field")
                return False
            
            for existing_tool in self.tool_config.get("tools", []):
                if existing_tool.get("id") == tool_id:
                    logger.warning(f"Session {self.session_id}: Tool {tool_id} already exists")
                    return False
            
            # Add tool to config
            if "tools" not in self.tool_config:
                self.tool_config["tools"] = []
            
            self.tool_config["tools"].append(tool_config)
            self.last_activity = datetime.now()
            logger.info(f"Session {self.session_id}: Added tool {tool_id}")
            return True
            
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to add tool: {e}")
            return False
    
    def update_tool_config(self, tool_id: str, new_config: Dict[str, Any]) -> bool:
        """Update tool configuration for this session.
        
        Args:
            tool_id: ID of the tool to update
            new_config: New tool configuration
            
        Returns:
            True if tool was found and updated, False otherwise
        """
        try:
            for i, tool in enumerate(self.tool_config.get("tools", [])):
                if tool.get("id") == tool_id:
                    # Update the tool configuration while preserving the ID
                    new_config["id"] = tool_id
                    self.tool_config["tools"][i] = new_config
                    self.last_activity = datetime.now()
                    logger.info(f"Session {self.session_id}: Tool {tool_id} configuration updated")
                    return True
            
            logger.warning(f"Session {self.session_id}: Tool {tool_id} not found")
            return False
            
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to update tool config {tool_id}: {e}")
            return False
    
    def get_enabled_tools(self) -> List[Dict[str, Any]]:
        """Get list of enabled tools for this session.
        
        Returns:
            List of enabled tool configurations
        """
        try:
            return [tool for tool in self.tool_config.get("tools", []) if tool.get("enabled", False)]
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to get enabled tools: {e}")
            return []
    
    def get_model_config(self) -> Dict[str, Any]:
        """Get current session-specific model configuration.
        
        Returns:
            Dictionary containing model configuration
        """
        return self.model_config.copy()
    
    def update_model_config(self, model_id: str = None, temperature: float = None, caching: Dict[str, Any] = None) -> bool:
        """Update model configuration for this session.
        
        Args:
            model_id: New model ID (optional)
            temperature: New temperature (optional)
            caching: New caching configuration (optional)
            
        Returns:
            True if config was updated, False otherwise
        """
        try:
            config_changed = False
            
            if model_id is not None:
                self.model_config["model_id"] = model_id
                config_changed = True
            
            if temperature is not None:
                self.model_config["temperature"] = temperature
                config_changed = True
            
            if caching is not None:
                self.model_config["caching"] = caching
                config_changed = True
                logger.info(f"Session {self.session_id}: Caching configuration updated to {caching}")
            
            if config_changed:
                self.model_config_changed = True  # Set change flag
            
            self.last_activity = datetime.now()
            return True
            
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to update model config: {e}")
            return False
    
    def has_config_changes(self) -> bool:
        """Check if any configuration has changed since last agent recreation.
        
        Returns:
            True if config has changed, False otherwise
        """
        return self.model_config_changed or self.tool_config_changed
    
    def reset_config_change_flags(self) -> None:
        """Reset configuration change flags after agent recreation."""
        self.model_config_changed = False
        self.tool_config_changed = False
    
    def get_active_system_prompt(self) -> str:
        """Get the currently active system prompt for this session.
        
        Returns:
            Active system prompt text
        """
        try:
            prompts = self.model_config.get("system_prompts", [])
            active_prompt = next((p for p in prompts if p.get("active", False)), None)
            if active_prompt:
                return active_prompt["prompt"]
            else:
                return "You are a helpful AI assistant with vision capabilities. Use only the tools that are explicitly provided to you. If a user asks for functionality that requires a tool you don't have, clearly explain that the tool is not available."
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to get active system prompt: {e}")
            return "You are a helpful AI assistant with vision capabilities. Use only the tools that are explicitly provided to you. If a user asks for functionality that requires a tool you don't have, clearly explain that the tool is not available."
    
    def update_system_prompt(self, prompt_id: str, name: str = None, prompt: str = None, active: bool = None) -> bool:
        """Update a system prompt for this session.
        
        Args:
            prompt_id: ID of the prompt to update
            name: New prompt name (optional)
            prompt: New prompt text (optional)
            active: New active status (optional)
            
        Returns:
            True if prompt was found and updated, False otherwise
        """
        try:
            prompts = self.model_config.get("system_prompts", [])
            
            for p in prompts:
                if p.get("id") == prompt_id:
                    if name is not None:
                        p["name"] = name
                    if prompt is not None:
                        p["prompt"] = prompt
                    if active is not None:
                        if active:
                            # Deactivate all other prompts when activating one
                            for other in prompts:
                                other["active"] = False
                        p["active"] = active
                    
                    self.last_activity = datetime.now()
                    logger.info(f"Session {self.session_id}: System prompt {prompt_id} updated")
                    return True
            
            logger.warning(f"Session {self.session_id}: System prompt {prompt_id} not found")
            return False
            
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to update system prompt {prompt_id}: {e}")
            return False
    
    def add_system_prompt(self, name: str, prompt: str, active: bool = False) -> str:
        """Add a new system prompt for this session.
        
        Args:
            name: Prompt name
            prompt: Prompt text
            active: Whether to make this prompt active (optional)
            
        Returns:
            New prompt ID if successful, None otherwise
        """
        try:
            prompts = self.model_config.get("system_prompts", [])
            
            # Generate new prompt ID
            existing_ids = [p["id"] for p in prompts]
            new_id = f"prompt_{len(prompts) + 1}"
            while new_id in existing_ids:
                new_id = f"prompt_{len(prompts) + len(existing_ids) + 1}"
            
            # Create new prompt
            new_prompt = {
                "id": new_id,
                "name": name,
                "prompt": prompt,
                "active": active
            }
            
            # If making this active, deactivate all others
            if active:
                for p in prompts:
                    p["active"] = False
            
            prompts.append(new_prompt)
            self.last_activity = datetime.now()
            logger.info(f"Session {self.session_id}: System prompt {new_id} added")
            return new_id
            
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to add system prompt: {e}")
            return None
    
    def delete_system_prompt(self, prompt_id: str) -> bool:
        """Delete a system prompt for this session.
        
        Args:
            prompt_id: ID of the prompt to delete
            
        Returns:
            True if prompt was found and deleted, False otherwise
        """
        try:
            prompts = self.model_config.get("system_prompts", [])
            original_count = len(prompts)
            
            # Remove the prompt
            prompts = [p for p in prompts if p.get("id") != prompt_id]
            
            if len(prompts) == original_count:
                logger.warning(f"Session {self.session_id}: System prompt {prompt_id} not found for deletion")
                return False
            
            # Ensure at least one prompt remains active
            if not any(p.get("active", False) for p in prompts) and prompts:
                prompts[0]["active"] = True
            
            self.model_config["system_prompts"] = prompts
            self.last_activity = datetime.now()
            logger.info(f"Session {self.session_id}: System prompt {prompt_id} deleted")
            return True
            
        except Exception as e:
            logger.error(f"Session {self.session_id}: Failed to delete system prompt {prompt_id}: {e}")
            return False
    
    def clear_session(self) -> None:
        """Clear all session data.
        
        Used when user explicitly clears conversation or starts new session.
        """
        self.messages.clear()
        self.agent_state.clear()
        self.conversation_manager_state.clear()
        # Reset tool config to default but keep session-specific changes
        # (Don't reload from file to preserve user's tool preferences)
        # Reset model config to default but keep session-specific changes
        # (Don't reload from file to preserve user's model preferences)
        self.last_activity = datetime.now()
        
        logger.info(f"Session {self.session_id}: All session data cleared")
    
    def get_session_info(self) -> Dict[str, Any]:
        """Get session information and statistics.
        
        Returns:
            Dictionary containing session metadata and statistics
        """
        return {
            "session_id": self.session_id,
            "message_count": len(self.messages),
            "created_at": self.created_at.isoformat(),
            "last_activity": self.last_activity.isoformat(),
            "has_agent_state": bool(self.agent_state),
            "has_conversation_manager_state": bool(self.conversation_manager_state)
        }
