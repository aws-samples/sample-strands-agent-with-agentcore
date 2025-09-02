import asyncio
import contextlib
import json
import logging
from typing import AsyncGenerator, List, Dict, Any
from strands import Agent
from strands.models import BedrockModel
from unified_tool_manager import UnifiedToolManager
from streaming.event_processor import StreamEventProcessor
from opentelemetry import baggage, context

logger = logging.getLogger(__name__)

# Global stream processor instance for tools to access
_global_stream_processor = None

def get_global_stream_processor():
    """Get the global stream processor instance"""
    return _global_stream_processor

class ChatbotAgent:
    def __init__(self, session_manager):
        if not session_manager:
            raise ValueError("session_manager is required for ChatbotAgent")
            
        global _global_stream_processor
        self.tool_manager = UnifiedToolManager()
        self.stream_processor = StreamEventProcessor()
        # Set global reference for tools to access
        _global_stream_processor = self.stream_processor
        self.agent = None
        self.model_config_file = "model_config.json"
        
        # Session management
        self.session_manager = session_manager
        
        self.create_agent()
    
    def load_model_config(self) -> Dict[str, Any]:
        """Load model configuration from session manager"""
        try:
            # Use session-specific model configuration
            return self.session_manager.get_model_config()
        except Exception as e:
            logger.error(f"Error loading session model config: {e}")
            # Return default config on error
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
    
    def get_active_system_prompt(self) -> str:
        """Get the currently active system prompt from session manager"""
        try:
            # Use session manager's method for getting active system prompt
            return self.session_manager.get_active_system_prompt()
        except Exception as e:
            logger.error(f"Error getting active system prompt from session: {e}")
            return "You are a helpful AI assistant with vision capabilities. Use only the tools that are explicitly provided to you. If a user asks for functionality that requires a tool you don't have, clearly explain that the tool is not available."
    
    async def _get_session_tools_with_context(self):
        """Get tools based on session-specific configuration"""
        from typing import Tuple
        from strands.tools.tools import PythonAgentTool
        from strands.tools.mcp import MCPClient
        from mcp.client.streamable_http import streamablehttp_client
        import importlib
        
        # Get session-specific tool configuration
        session_tool_config = self.session_manager.get_tool_config()
        session_tools = session_tool_config.get("tools", [])
        
        print(f"🔧 Agent - Loading tools from session config: {len(session_tools)} total tools")
        
        # Filter enabled tools
        enabled_tools = [tool for tool in session_tools if tool.get("enabled", False)]
        print(f"🔧 Agent - Found {len(enabled_tools)} enabled tools in session")
        
        all_tools = []
        
        # Process each enabled tool
        for tool_config in enabled_tools:
            tool_type = tool_config.get("type")
            tool_id = tool_config.get("id")
            
            try:
                if tool_type == "strands_tools":
                    # Load Strands built-in tools
                    tool_func = self._load_strands_tool(tool_config)
                    if tool_func:
                        all_tools.append(tool_func)
                        print(f"🔧 Agent - Loaded Strands tool: {tool_id}")
                
                elif tool_type in ["custom_tools", "agent", "strands_tools_wrapper"]:
                    # Load custom tools
                    tool_func = self._load_custom_tool(tool_config)
                    if tool_func:
                        all_tools.append(tool_func)
                        print(f"🔧 Agent - Loaded custom tool: {tool_id}")
                
                elif tool_type == "mcp":
                    # MCP tools are handled by UnifiedToolManager below
                    print(f"🔧 Agent - MCP server {tool_id} will be handled by UnifiedToolManager")
                    pass
                
            except Exception as e:
                print(f"🔧 Agent - Failed to load tool {tool_id}: {e}")
                continue
        
        # Get session-aware MCP tools using improved UnifiedToolManager
        backend_session_id = self.session_manager.session_id
        print(f"🔧 Agent - Backend session ID: {backend_session_id}")
        
        try:
            # Pass session config to UnifiedToolManager for unified MCP handling
            all_mcp_tools, _ = self.tool_manager.get_tools_for_session(
                backend_session_id, 
                session_tool_config
            )
            
            # Add all MCP tools (both stateful and stateless) via unified approach
            all_tools.extend(all_mcp_tools)
            print(f"🔧 Agent - Added {len(all_mcp_tools)} MCP tools via unified MCPSessionManager")
            
        except Exception as e:
            print(f"🔧 Agent - Error loading MCP tools: {e}")
        
        print(f"🔧 Agent - Total tools loaded: {len(all_tools)} (unified MCP approach)")
        
        # Log details of loaded tools with inspection
        if all_tools:
            print(f"🔧 Agent - Loaded tool details:")
            for i, tool in enumerate(all_tools):
                tool_info = f"  {i+1}. "
                
                # Try different ways to get tool name
                if hasattr(tool, 'tool_spec') and isinstance(tool.tool_spec, dict):
                    tool_name = tool.tool_spec.get('name', 'Unknown')
                    tool_info += f"{tool_name} (tool)"
                elif hasattr(tool, 'name'):
                    tool_info += f"{tool.name} (name attr)"
                elif hasattr(tool, '__name__'):
                    tool_info += f"{tool.__name__} (function)"
                else:
                    tool_str = str(tool)[:50]
                    tool_info += f"{tool_str}... (unknown)"
                
                tool_info += f" [{type(tool).__name__}]"
                print(tool_info)
                
                # For MCP tools, try to get more details
                if 'mcp' in str(type(tool)).lower():
                    try:
                        if hasattr(tool, 'schema'):
                            print(f"     MCP schema: {tool.schema}")
                        elif hasattr(tool, 'definition'):
                            print(f"     MCP definition: {tool.definition}")
                    except:
                        pass
        else:
            print(f"🔧 Agent - WARNING: No tools loaded!")
        
        return all_tools
    
    def _load_strands_tool(self, tool_config):
        """Load a Strands built-in tool"""
        try:
            import importlib
            
            tool_id = tool_config["id"]
            import_path = tool_config.get("import_path")
            
            if not import_path:
                return None
            
            module = importlib.import_module(import_path)
            tool_func = getattr(module, tool_id)
            
            # Check if it's already decorated
            if hasattr(tool_func, 'tool_spec'):
                return tool_func
            else:
                # Wrap with PythonAgentTool if needed
                if hasattr(module, 'TOOL_SPEC'):
                    tool_spec = module.TOOL_SPEC
                    from strands.tools.tools import PythonAgentTool
                    wrapped_tool = PythonAgentTool(tool_id, tool_spec, tool_func)
                    return wrapped_tool
            
            return None
            
        except Exception as e:
            print(f"🔧 Agent - Error loading Strands tool {tool_config.get('id')}: {e}")
            return None
    
    def _load_custom_tool(self, tool_config):
        """Load a custom tool"""
        try:
            import importlib
            
            module_path = tool_config["module_path"]
            function_name = tool_config["function_name"]
            
            module = importlib.import_module(module_path)
            tool_function = getattr(module, function_name)
            
            if hasattr(tool_function, 'tool_spec'):
                return tool_function
            else:
                print(f"🔧 Agent - Function {function_name} is not decorated with @tool")
                return None
                
        except Exception as e:
            print(f"🔧 Agent - Error loading custom tool {tool_config.get('id')}: {e}")
            return None
    
    async def create_agent_with_all_tools(self):
        """Create agent using Strands standard approach with all tools (Strands + MCP)"""
        try:
            # MCP client cleanup is now handled by MCPSessionManager
            
            # Always use session-specific tool configuration
            print(f"🔧 Agent - Using session-specific tool configuration for session: {self.session_manager.session_id}")
            all_tools = await self._get_session_tools_with_context()
            
            # Load dynamic model configuration
            config = self.load_model_config()
            logger.info(f"🔧 Loaded model config: {config}")
            
            # Configure Bedrock model with dynamic settings and extended timeout
            from botocore.config import Config as BotocoreConfig
            
            # Extended timeout configuration for better reliability
            boto_config = BotocoreConfig(
                connect_timeout=30,      # 30s connection timeout
                read_timeout=300,        # 5min read timeout (increased from 60s)
                retries={"max_attempts": 3, "mode": "adaptive"}
            )
            
            # Load caching configuration (simplified)
            caching_config = config.get("caching", {})
            self.caching_enabled = caching_config.get("enabled", True)  # Default ON
            
            # Apply caching settings to BedrockModel
            bedrock_model_params = {
                "model_id": config["model_id"],
                "temperature": config["temperature"],
                "streaming": True,
                "region_name": "us-west-2",
                "boto_client_config": boto_config
            }
            
            # Add caching options if enabled
            if self.caching_enabled:
                bedrock_model_params["cache_prompt"] = "default"
                bedrock_model_params["cache_tools"] = "default"
                print(f"🔄 Prompt caching ENABLED - Cache points will be added after tool execution")
            else:
                print(f"❌ Prompt caching DISABLED - No cache points will be added")
            
            bedrock_model = BedrockModel(**bedrock_model_params)
            
            # Get active system prompt
            system_prompt = self.get_active_system_prompt()

            # No additional hooks needed - session_manager handles everything via Strands interface
            hooks = []

            self.agent = Agent(
                model=bedrock_model,
                tools=all_tools,  # Strands + all MCP server tools
                system_prompt=system_prompt,
                hooks=hooks,
                session_manager=self.session_manager  # Pass session_manager to Strands Agent
            )
            
            logger.info(f"Agent created with {len(all_tools)} tools (unified MCP approach)")
            logger.info(f"🚀 Using model: {config['model_id']} (temp: {config['temperature']})")
            logger.info(f"🔧 Model config details: {config}")
            return self.agent
            
        except Exception as e:
            logger.error(f"Error creating agent: {e}")
            self.agent = None
            return None
    
    def create_agent(self):
        """Synchronous version - calls async method"""
        try:
            # Run async method synchronously
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # If loop is already running, create task but don't wait
                print(f"🚨🚨🚨 ASYNC LOOP RUNNING - SKIPPING AGENT CREATION FOR NOW")
                # TODO: Need to handle async agent creation properly in FastAPI context
                self.agent = None
            else:
                # Run in new loop
                loop.run_until_complete(self.create_agent_with_all_tools())
        except Exception as e:
            logger.error(f"Error in create_agent: {e}")
            self.agent = None
    
    def is_available(self) -> bool:
        """Check if agent is available"""
        return self.agent is not None
    
    def recreate_agent(self) -> None:
        """Recreate the agent with fresh session state"""
        try:
            # Clear any existing agent
            self.agent = None
            
            # Recreate the agent
            self.create_agent()
            
            logger.info("Agent recreated successfully with clean session state")
        except Exception as e:
            logger.error(f"Failed to recreate agent: {e}")
            self.agent = None
    
    async def reload_tools(self):
        """Reload tools configuration and recreate agent"""
        try:
            # Reload configuration
            self.tool_manager.load_config()
            self.tool_manager.load_strands_tool_functions()
            
            # Recreate agent with updated tools
            await self.create_agent_with_all_tools()
            return True
        except Exception as e:
            logger.error(f"Failed to reload tools: {e}")
            return False
    
    def get_tool_manager(self) -> UnifiedToolManager:
        """Get the tool manager instance"""
        return self.tool_manager
    
    
    def restore_conversation_messages(self, messages: List) -> bool:
        """Restore conversation messages to the agent"""
        try:
            if not self.agent:
                return False
            
            # Try different methods to restore messages
            if hasattr(self.agent, '_conversation_manager'):
                conversation_manager = self.agent._conversation_manager
                
                # Try direct assignment to _messages
                if hasattr(conversation_manager, '_messages'):
                    conversation_manager._messages = messages.copy()
                    return True
                
                # Try clear and add messages one by one
                if hasattr(conversation_manager, 'clear') and hasattr(conversation_manager, 'add_message'):
                    conversation_manager.clear()
                    for message in messages:
                        conversation_manager.add_message(message)
                    return True
                
                # Try direct messages property
                if hasattr(conversation_manager, 'messages'):
                    conversation_manager.messages = messages.copy()
                    return True
            
            return False
            
        except Exception as e:
            return False
    
    def clear_conversation_memory(self) -> None:
        """Clear all conversation memory and recreate agent"""
        if self.session_manager:
            self.session_manager.clear_session()
        # Recreate agent to ensure clean state
        self.recreate_agent()
    
    def get_conversation_stats(self) -> Dict[str, Any]:
        """Get conversation statistics"""
        if self.session_manager:
            return {
                "message_count": len(self.session_manager.messages),
                "recent_messages": len(self.session_manager.messages[-5:] if self.session_manager.messages else [])
            }
        return {"message_count": 0, "recent_messages": 0}
    
    def export_conversation(self, export_path: str) -> bool:
        """Export conversation to file"""
        try:
            if not self.session_manager:
                return False
                
            messages = self.session_manager.messages
            export_data = {
                "messages": messages,
                "stats": self.get_conversation_stats(),
                "export_timestamp": json.dumps({"timestamp": "now"})  # Simple timestamp
            }
            
            with open(export_path, 'w') as f:
                json.dump(export_data, f, indent=2, default=str)
            
            return True
        except Exception as e:
            return False
    
    
    async def invoke_async(self, message: str, file_paths: List[str] = None) -> str:
        """Invoke agent asynchronously for non-streaming response with optional files"""
        if not self.agent:
            return f"Echo: {message} (Agent not available - please configure AWS credentials for Bedrock)"
        
        try:
            # MCPSessionManager handles context management for session-aware MCP tools automatically
            multimodal_message = self.stream_processor._create_multimodal_message(message, file_paths)
            response = await self.agent.invoke_async(multimodal_message)
            return str(response)
        except Exception as e:
            return f"Sorry, I encountered an error: {str(e)}"

    async def stream_async(self, message: str, file_paths: List[str] = None, session_id: str = None) -> AsyncGenerator[str, None]:
        """Stream responses using the dedicated StreamEventProcessor with MCP context management"""
        
        # Use provided session_id or get from session_manager
        if not session_id:
            if self.session_manager and hasattr(self.session_manager, 'session_id'):
                session_id = self.session_manager.session_id
            else:
                # Generate a unique session ID for this stream
                import uuid
                session_id = f"stream_{uuid.uuid4().hex[:8]}"
        
        # Set session ID in OpenTelemetry baggage for context propagation
        ctx = baggage.set_baggage("session.id", session_id)
        token = context.attach(ctx)
        
        try:
            # LAZY AGENT RECREATION: Check if config changed OR agent is None and recreate if needed
            if (self.session_manager and self.session_manager.has_config_changes()) or not self.agent:
                if self.session_manager and self.session_manager.has_config_changes():
                    print(f"🔄 Config changed detected - recreating agent before chat")
                else:
                    print(f"🔄 Agent is None - creating agent before chat")
                try:
                    await self.create_agent_with_all_tools()
                    if self.session_manager:
                        self.session_manager.reset_config_change_flags()
                    print(f"🔄 Agent recreation completed")
                except Exception as e:
                    logger.error(f"Failed to recreate agent: {e}")
                    yield f"Sorry, I encountered an error updating my configuration: {str(e)}"
                    return
            
            if not self.agent:
                yield f"Echo: {message} (Agent not available - please configure AWS credentials for Bedrock)"
                return
            
            print(f"🔍 Agent - Using session_id for streaming: {session_id}")
            logger.info(f"🔍 Agent - Using session_id for streaming: {session_id}")
            
            # All MCP clients (both stateful and stateless) are managed by MCPSessionManager
            # No need for separate context management - much simpler!
            async for event in self.stream_processor.process_stream(self.agent, message, file_paths, session_id):
                yield event
                
                # Insert cache point after tool execution if caching is enabled
                if self.caching_enabled:
                    if self._is_tool_result_complete(event):
                        await self._insert_cache_point_after_tool(event)
                        
        except GeneratorExit:
            # Client disconnected - this is normal, don't log as error
            return
                
        except Exception as e:
            # Only log actual errors, not normal disconnections
            logger.debug(f"Stream error for session {session_id}: {e}")
            yield f"Sorry, I encountered an error during streaming: {str(e)}"
            
        finally:
            # Detach the context to clean up
            context.detach(token)
    
    def _is_tool_result_complete(self, event) -> bool:
        """Check if tool result is complete"""
        try:
            # Check for tool result completion in streaming events
            if isinstance(event, str):
                # SSE format event
                return "tool_result" in event.lower() and "completed" in event.lower()
            elif isinstance(event, dict):
                # Dict format event
                event_type = event.get("type", "")
                return (
                    event_type == "tool_result" or
                    (event_type == "message" and 
                     event.get("delta", {}).get("stopReason") == "tool_use")
                )
            return False
        except Exception:
            return False
    
    async def _insert_cache_point_after_tool(self, event):
        """Insert cache point after tool execution"""
        try:
            cache_points_added = 0
            
            # Add cache point to Strands Agent's messages
            if hasattr(self.agent, 'messages') and self.agent.messages:
                last_message = self.agent.messages[-1]
                if self._add_cache_point_to_message(last_message):
                    cache_points_added += 1
            
            # Sync with session manager
            if self.session_manager:
                if self.session_manager.add_cache_point_to_last_message():
                    cache_points_added += 1
                    
            if cache_points_added > 0:
                print(f"✅ CACHE POINT INSERTED - {cache_points_added} locations updated")
                logger.info(f"Prompt caching: Cache point added after tool execution ({cache_points_added} locations)")
            else:
                print(f"⚠️  CACHE POINT INSERTION SKIPPED - No suitable messages found")
                
        except Exception as e:
            print(f"❌ CACHE POINT INSERTION FAILED: {e}")
            logger.warning(f"Cache point insertion failed: {e}")
    
    def _add_cache_point_to_message(self, message) -> bool:
        """Add cache point to message content"""
        try:
            if hasattr(message, 'content'):
                if isinstance(message.content, list):
                    # Check if cache point already exists
                    has_cache_point = any(
                        isinstance(item, dict) and "cachePoint" in item 
                        for item in message.content
                    )
                    
                    if not has_cache_point:
                        message.content.append({
                            "cachePoint": {"type": "default"}
                        })
                        return True
                elif isinstance(message.content, str):
                    # Convert string to list with cache point
                    message.content = [
                        {"text": message.content},
                        {"cachePoint": {"type": "default"}}
                    ]
                    return True
            return False
        except Exception as e:
            logger.warning(f"Failed to add cache point to message: {e}")
            return False
