import json
import importlib
import asyncio
import contextlib
import logging
import requests
from typing import List, Dict, Any, Tuple, Optional
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient
from strands.tools.tools import PythonAgentTool
from mcp_session_manager import MCPSessionManager
from opentelemetry import trace, baggage, context
import functools

logger = logging.getLogger(__name__)

class UnifiedToolManager:
    """Unified Tool Manager - Manages all tools in a single unified structure"""
    
    def __init__(self, config_path: str = "unified_tools_config.json"):
        self.config_path = config_path
        self.config = {}
        self.strands_tool_functions = {}
        self.custom_tool_functions = {}  # Custom tools storage
        
        # Initialize MCP session manager
        self.mcp_session_manager = MCPSessionManager()
        
        # Initialize OpenTelemetry
        self.tracer = trace.get_tracer(__name__)
        
        self.load_config()
        self.load_strands_tool_functions()
        self.load_custom_tool_functions()
    
    def load_config(self):
        """Load unified configuration file"""
        try:
            with open(self.config_path, 'r') as f:
                self.config = json.load(f)
        except FileNotFoundError:
            logger.warning(f"Config file not found: {self.config_path}")
            self.config = {"tools": []}
        except Exception as e:
            logger.error(f"Error loading config: {e}")
            self.config = {"tools": []}
    
    def _process_base64_for_model(self, text_content: str) -> str:
        """Remove Base64 download data from tool result before sending to model"""
        import re
        
        # Pattern to match Base64 data URLs: <download>data:application/zip;base64,{base64_data}</download>
        base64_pattern = r'<download>data:([^;]+);base64,([A-Za-z0-9+/=]+)</download>'
        
        # Replace Base64 data with a simple message for the model
        processed_text = re.sub(base64_pattern, r'[Files generated and saved for download]', text_content)
        
        # If replacement occurred, log it
        if processed_text != text_content:
            print(f"📝 Removed Base64 data from model tool result (saved {len(text_content) - len(processed_text)} characters)")
        
        return processed_text

    def _parse_mcp_response(self, response):
        """Parse MCP response - handles both JSON and SSE formats"""
        try:
            # First try regular JSON parsing
            return response.json()
        except:
            # If that fails, try SSE parsing
            try:
                lines = response.text.strip().split('\n')
                
                # Handle SSE format with event: message followed by data: {...}
                for i, line in enumerate(lines):
                    if line.startswith('event: message') and i + 1 < len(lines):
                        next_line = lines[i + 1]
                        if next_line.startswith('data: '):
                            data_line = next_line[6:]  # Remove 'data: ' prefix
                            import json
                            return json.loads(data_line)
                
                # Fallback: look for any data: line (original logic)
                for line in lines:
                    if line.startswith('data: '):
                        data_line = line[6:]  # Remove 'data: ' prefix
                        import json
                        return json.loads(data_line)
                        
                return None
            except Exception as e:
                logger.warning(f"Failed to parse SSE response: {e}")
                return None
    
    def save_config(self):
        """Save configuration file"""
        try:
            with open(self.config_path, 'w') as f:
                json.dump(self.config, f, indent=2)
            logger.info(f"Saved config to {self.config_path}")
        except Exception as e:
            logger.error(f"Error saving config: {e}")
    
    def get_tools_by_type(self, tool_type: str) -> List[Dict[str, Any]]:
        """Get tools filtered by type"""
        return [tool for tool in self.config.get("tools", []) if tool.get("type") == tool_type]
    
    def get_tool_by_id(self, tool_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific tool by ID"""
        for tool in self.config.get("tools", []):
            if tool["id"] == tool_id:
                return tool
        return None
    
    def load_strands_tool_functions(self):
        """Load Strands built-in tool functions"""
        tool_imports = [
            ("calculator", "strands_tools.calculator", "calculator"),
            ("http_request", "strands_tools.http_request", "http_request"),
            ("generate_image", "strands_tools.generate_image", "generate_image"),
            ("image_reader", "strands_tools.image_reader", "image_reader")
        ]
        
        for tool_id, module_name, function_name in tool_imports:
            try:
                module = importlib.import_module(module_name)
                self.strands_tool_functions[tool_id] = getattr(module, function_name)
                logger.info(f"✓ Loaded Strands tool: {tool_id}")
            except ImportError as e:
                logger.warning(f"✗ Could not import {tool_id} from {module_name}: {e}")
                self._disable_unavailable_tool(tool_id)
            except AttributeError as e:
                logger.warning(f"✗ Could not find function {function_name} in {module_name}: {e}")
                self._disable_unavailable_tool(tool_id)
    
    def _disable_unavailable_tool(self, tool_id: str):
        """Disable unavailable tool"""
        tool = self.get_tool_by_id(tool_id)
        if tool and tool.get("enabled", False):
            tool["enabled"] = False
            logger.info(f"  → Automatically disabled {tool_id} due to import failure")
    
    def load_custom_tool_functions(self):
        """Load custom tools with explicit module paths"""
        custom_tools = self.get_tools_by_type("custom_tools") + self.get_tools_by_type("agent") + self.get_tools_by_type("strands_tools_wrapper")
        
        for tool_config in custom_tools:
            if not tool_config.get("enabled", False):
                continue
                
            try:
                module_path = tool_config["module_path"]
                function_name = tool_config["function_name"]
                tool_id = tool_config["id"]
                
                module = importlib.import_module(module_path)
                tool_function = getattr(module, function_name)
                
                if hasattr(tool_function, 'tool_spec'):
                    self.custom_tool_functions[tool_id] = tool_function
                    logger.info(f"✓ Loaded custom tool: {tool_id} from {module_path}.{function_name}")
                else:
                    logger.warning(f"✗ Function {function_name} is not decorated with @tool")
                    self._disable_unavailable_tool(tool_id)
                    
            except ImportError as e:
                logger.warning(f"✗ Could not import {tool_config['module_path']}: {e}")
                self._disable_unavailable_tool(tool_config['id'])
            except AttributeError as e:
                logger.warning(f"✗ Could not find function {tool_config['function_name']} in {tool_config['module_path']}: {e}")
                self._disable_unavailable_tool(tool_config['id'])
            except Exception as e:
                logger.error(f"Failed to load custom tool {tool_config['id']}: {e}")
                self._disable_unavailable_tool(tool_config['id'])
    
    def get_enabled_custom_tools(self) -> List[Any]:
        """Return enabled custom tools"""
        enabled_tools = []
        custom_tools = self.get_tools_by_type("custom_tools") + self.get_tools_by_type("agent") + self.get_tools_by_type("strands_tools_wrapper")
        
        for tool_config in custom_tools:
            if not tool_config.get("enabled", False):
                continue
                
            tool_id = tool_config["id"]
            if tool_id not in self.custom_tool_functions:
                continue
            
            tool_func = self.custom_tool_functions[tool_id]
            
            # Custom tools should already be decorated with @tool
            if hasattr(tool_func, 'tool_spec'):
                enabled_tools.append(tool_func)
            else:
                logger.warning(f"Custom tool {tool_id} is not properly decorated with @tool")
        
        return enabled_tools
    
    def get_enabled_strands_tools(self) -> List[Any]:
        """Return enabled Strands built-in tools"""
        enabled_tools = []
        strands_tools = self.get_tools_by_type("strands_tools")
        
        for tool_config in strands_tools:
            if not tool_config.get("enabled", False):
                continue
                
            tool_id = tool_config["id"]
            if tool_id not in self.strands_tool_functions:
                continue
            
            tool_func = self.strands_tool_functions[tool_id]
            
            # Check if it's already a DecoratedFunctionTool
            if hasattr(tool_func, 'tool_spec'):
                enabled_tools.append(tool_func)
            else:
                # Wrap with PythonAgentTool
                try:
                    module_name = tool_config.get("import_path")
                    if module_name:
                        module = importlib.import_module(module_name)
                        if hasattr(module, 'TOOL_SPEC'):
                            tool_spec = module.TOOL_SPEC
                            wrapped_tool = PythonAgentTool(tool_id, tool_spec, tool_func)
                            enabled_tools.append(wrapped_tool)
                except Exception as e:
                    logger.error(f"Error wrapping tool {tool_id}: {e}")
        
        return enabled_tools
    
    def get_enabled_mcp_servers(self) -> List[Dict[str, Any]]:
        """Return enabled MCP server configurations"""
        return [tool for tool in self.get_tools_by_type("mcp") 
                if tool.get("enabled", False)]
    
    def _create_mcp_client(self, server_config: Dict[str, Any]) -> MCPClient:
        """Create MCPClient using the unified factory"""
        from mcp_client_factory import MCPClientFactory
        return MCPClientFactory.create_client(server_config)
    
    # Configuration management methods
    def update_tool_status(self, tool_id: str, enabled: bool) -> bool:
        """Update tool enabled status (unified method)"""
        tool = self.get_tool_by_id(tool_id)
        if tool:
            # All MCP servers are handled uniformly - no session_aware distinction needed
            
            tool["enabled"] = enabled
            self.save_config()
            
            # Reload custom tools if enabling a custom tool or agent
            if enabled and tool.get("type") in ["custom_tools", "agent", "strands_tools_wrapper"]:
                self.load_custom_tool_functions()
            return True
        return False
    
    
    def add_tool(self, tool_config: Dict[str, Any]) -> bool:
        """Add new tool"""
        # Check for duplicate ID
        if self.get_tool_by_id(tool_config["id"]):
            return False
        
        self.config.setdefault("tools", []).append(tool_config)
        self.save_config()
        
        # Try to load the new tool if it's enabled and is a custom tool
        if tool_config.get("enabled", False) and tool_config.get("type") in ["custom_tools", "agent"]:
            self.load_custom_tool_functions()
        
        return True
    
    def remove_tool(self, tool_id: str) -> bool:
        """Remove tool"""
        tools = self.config.get("tools", [])
        for i, tool in enumerate(tools):
            if tool["id"] == tool_id:
                tools.pop(i)
                # Remove from loaded functions if it's a custom tool
                if tool_id in self.custom_tool_functions:
                    del self.custom_tool_functions[tool_id]
                self.save_config()
                return True
        return False
    
    def get_tools_summary(self) -> Dict[str, Any]:
        """Return tools status summary"""
        all_tools = self.config.get("tools", [])
        
        # Group by type
        strands_tools = self.get_tools_by_type("strands_tools")
        custom_tools = self.get_tools_by_type("custom_tools")
        agent_tools = self.get_tools_by_type("agent")
        mcp_servers = self.get_tools_by_type("mcp")
        
        enabled_strands = [t for t in strands_tools if t.get("enabled", False)]
        enabled_custom = [t for t in custom_tools if t.get("enabled", False)]
        enabled_agents = [t for t in agent_tools if t.get("enabled", False)]
        enabled_mcp = [s for s in mcp_servers if s.get("enabled", False)]
        
        return {
            "strands_tools": {
                "total": len(strands_tools),
                "enabled": len(enabled_strands),
                "tools": strands_tools
            },
            "custom_tools": {
                "total": len(custom_tools),
                "enabled": len(enabled_custom),
                "tools": custom_tools
            },
            "agent_tools": {
                "total": len(agent_tools),
                "enabled": len(enabled_agents),
                "tools": agent_tools
            },
            "mcp_servers": {
                "total": len(mcp_servers),
                "enabled": len(enabled_mcp),
                "servers": mcp_servers
            },
            "total_enabled": len(enabled_strands) + len(enabled_custom) + len(enabled_agents) + len(enabled_mcp)
        }
    
    def get_mcp_connection_status(self) -> Dict[str, Dict[str, Any]]:
        """Get connection status for all MCP servers"""
        status = {}
        mcp_servers = self.get_tools_by_type("mcp")
        
        for server in mcp_servers:
            server_id = server["id"]
            is_enabled = server.get("enabled", False)
            
            # For enabled servers, assume connected
            # For disabled servers, show as disconnected
            connected = is_enabled
            
            status[server_id] = {
                "enabled": is_enabled,
                "connected": connected,
                "name": server.get("name", server_id),
                "type": server.get("type", "unknown")
            }
        
        return status
    
    def get_all_tools(self) -> List[Dict[str, Any]]:
        """Return all tools (regardless of enabled status)"""
        return self.config.get("tools", [])
    
    def get_all_strands_tools(self) -> List[Dict[str, Any]]:
        """Return all Strands tools (regardless of enabled status)"""
        return self.get_tools_by_type("strands_tools")
    
    def get_all_mcp_servers(self) -> List[Dict[str, Any]]:
        """Return all MCP servers (regardless of enabled status)"""
        return self.get_tools_by_type("mcp")
    
    def get_all_custom_tools(self) -> List[Dict[str, Any]]:
        """Return all custom tools (regardless of enabled status)"""
        return self.get_tools_by_type("custom_tools") + self.get_tools_by_type("agent")
    
    def _create_http_tool_wrapper(self, server_id: str, tool_info: Dict[str, Any], server_config: Dict[str, Any]) -> PythonAgentTool:
        """Create a PythonAgentTool wrapper for HTTP-based MCP server tools"""
        tool_name = tool_info.get("name", "unknown_tool")
        tool_description = tool_info.get("description", "MCP tool")
        input_schema = tool_info.get("inputSchema", {})
        
        # Create tool specification
        tool_spec = {
            "name": tool_name,
            "description": tool_description,
            "input_schema": input_schema
        }
        
        # Create the actual function that will be called
        def http_tool_function(**kwargs):
            """HTTP tool function that calls the MCP server"""
            print(f"🔍 [DEBUG] Calling MCP tool: {tool_name} with args: {kwargs}")
            print(f"🔍 [DEBUG] Server URL: {url}")
            try:
                # Get server configuration
                url = server_config["config"]["url"]
                headers = server_config.get("headers", {})
                
                # Prepare headers
                request_headers = {
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream"
                }
                
                # Add Authorization header if provided
                if headers:
                    for key, value in headers.items():
                        if key.lower() in ['x-tavily-api-key', 'tavily-api-key', 'api-key', 'apikey']:
                            request_headers['Authorization'] = f'Bearer {value}'
                            break
                        elif key.lower() == 'authorization':
                            request_headers['Authorization'] = value
                            break
                
                # Create MCP request payload
                payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": kwargs
                    }
                }
                
                # Make HTTP request
                response = requests.post(
                    url,
                    json=payload,
                    headers=request_headers,
                    timeout=30
                )
                
                if response.status_code == 200:
                    # Use the same MCP response parser for consistency
                    result = self._parse_mcp_response(response)
                    if result and "result" in result:
                        # Extract the actual result content
                        tool_result = result["result"]
                        print(f"🔍 [DEBUG] MCP tool result for {tool_name}: {type(tool_result)} - {str(tool_result)[:200]}...")
                        if isinstance(tool_result, dict) and "content" in tool_result:
                            # Handle MCP tool result format
                            content = tool_result["content"]
                            if isinstance(content, list) and len(content) > 0:
                                # Process all content items to handle both text and images
                                result_text = ""
                                result_images = []
                                
                                for content_item in content:
                                    if isinstance(content_item, dict):
                                        if "text" in content_item:
                                            # Handle text content
                                            text_content = content_item["text"]
                                            try:
                                                import json
                                                parsed_response = json.loads(text_content)
                                                
                                                # Extract images from JSON response
                                                extracted_images = self._extract_images_from_response(parsed_response)
                                                result_images.extend(extracted_images)
                                                
                                                # Clean response for display
                                                cleaned_response = self._clean_response_for_display(parsed_response)
                                                result_text += json.dumps(cleaned_response, indent=2)
                                                
                                            except (json.JSONDecodeError, TypeError):
                                                # Not JSON, process Base64 downloads if needed
                                                processed_text = self._process_base64_for_model(text_content)
                                                result_text += processed_text
                                        
                                        elif "data" in content_item and "mimeType" in content_item:
                                            # Handle ImageContent from FastMCP Image objects
                                            mime_type = content_item["mimeType"]
                                            if mime_type.startswith("image/"):
                                                image_format = mime_type.split("/")[-1]  # e.g., "png", "jpeg"
                                                result_images.append({
                                                    "format": image_format,
                                                    "data": content_item["data"]  # Already base64 encoded
                                                })
                                                
                                                # Add alt_text as result text if available  
                                                if "alt_text" in content_item:
                                                    result_text += content_item["alt_text"]
                                        
                                        else:
                                            result_text += str(content_item)
                                    else:
                                        result_text += str(content_item)
                                
                                # Return structured response if we have images, otherwise just text
                                if result_images:
                                    # Return in Strands ToolResult format for proper image handling
                                    tool_result_content = []
                                    
                                    # Add text content if available
                                    if result_text.strip():
                                        tool_result_content.append({"text": result_text.strip()})
                                    
                                    # Add image content
                                    for image in result_images:
                                        import base64
                                        try:
                                            # Convert base64 string to bytes for Strands SDK
                                            image_bytes = base64.b64decode(image["data"])
                                            image_content = {
                                                "image": {
                                                    "format": image["format"],
                                                    "source": {
                                                        "bytes": image_bytes  # Actual bytes for Strands SDK
                                                    }
                                                }
                                            }
                                            tool_result_content.append(image_content)
                                        except Exception as e:
                                            print(f"❌ Failed to decode image data: {e}")
                                            # Skip this image if decoding fails
                                    
                                    return {
                                        "content": tool_result_content,
                                        "status": "success"
                                    }
                                else:
                                    # Return simple text in ToolResult format
                                    return {
                                        "content": [{"text": result_text.strip() or str(content)}],
                                        "status": "success"
                                    }
                            else:
                                return str(content)
                        else:
                            # Check if this is already a Strands ToolResult format
                            if isinstance(tool_result, dict) and "status" in tool_result and "content" in tool_result:
                                # Already in Strands ToolResult format, return as-is
                                print(f"🔍 [DEBUG] Tool {tool_name} returned Strands ToolResult format with {len(tool_result.get('content', []))} content items")
                                for i, content_item in enumerate(tool_result.get('content', [])):
                                    if isinstance(content_item, dict):
                                        content_keys = list(content_item.keys())
                                        print(f"  Content[{i}]: {content_keys}")
                                        if 'image' in content_item:
                                            print(f"    Image format: {content_item['image'].get('format')}")
                                            print(f"    Image source keys: {list(content_item['image'].get('source', {}).keys())}")
                                return tool_result
                            
                            # Direct tool result - try to extract images
                            extracted_images = self._extract_images_from_response(tool_result)
                            if extracted_images:
                                cleaned_response = self._clean_response_for_display(tool_result)
                                
                                # Return in Strands ToolResult format
                                tool_result_content = []
                                
                                # Add text content if available
                                if str(cleaned_response).strip():
                                    tool_result_content.append({"text": str(cleaned_response)})
                                
                                # Add image content
                                for image in extracted_images:
                                    import base64
                                    try:
                                        # Convert base64 string to bytes for Strands SDK
                                        image_bytes = base64.b64decode(image["data"])
                                        image_content = {
                                            "image": {
                                                "format": image["format"],
                                                "source": {
                                                    "bytes": image_bytes  # Actual bytes for Strands SDK
                                                }
                                            }
                                        }
                                        tool_result_content.append(image_content)
                                    except Exception as e:
                                        print(f"❌ Failed to decode image data: {e}")
                                        # Skip this image if decoding fails
                                
                                return {
                                    "content": tool_result_content,
                                    "status": "success"
                                }
                            else:
                                return {
                                    "content": [{"text": str(tool_result)}],
                                    "status": "success"
                                }
                    elif "error" in result:
                        return f"Error: {result['error'].get('message', 'Unknown error')}"
                    else:
                        return f"Unexpected response format: {result}"
                else:
                    return f"HTTP Error {response.status_code}: {response.text}"
                    
            except requests.exceptions.Timeout:
                return "Error: Request timeout (30 seconds)"
            except requests.exceptions.ConnectionError:
                return "Error: Failed to connect to MCP server"
            except Exception as e:
                return f"Error calling {tool_name}: {str(e)}"
        
        # Create and return the PythonAgentTool
        return PythonAgentTool(
            tool_id=f"{server_id}_{tool_name}",
            tool_spec=tool_spec,
            tool_function=http_tool_function
        )
    
    def _extract_images_from_response(self, response_data):
        """Extract images from any tool response automatically"""
        images = []
        
        if isinstance(response_data, dict):
            # Support common image field patterns
            image_fields = ['screenshot', 'image', 'diagram', 'chart', 'visualization', 'figure']
            
            for field in image_fields:
                if field in response_data and isinstance(response_data[field], dict):
                    img_data = response_data[field]
                    if "data" in img_data and "format" in img_data:
                        images.append({
                            "format": img_data["format"],
                            "data": img_data["data"]
                        })
            
            # Preserve existing images array
            if "images" in response_data and isinstance(response_data["images"], list):
                images.extend(response_data["images"])
        
        return images
    
    def _clean_response_for_display(self, response_data):
        """Clean response data for display, removing large image data"""
        if isinstance(response_data, dict):
            cleaned = response_data.copy()
            
            # Remove image data fields to avoid cluttering the text display
            image_fields = ['screenshot', 'image', 'diagram', 'chart', 'visualization', 'figure']
            for field in image_fields:
                if field in cleaned and isinstance(cleaned[field], dict):
                    if "data" in cleaned[field]:
                        # Keep metadata but remove the large base64 data
                        cleaned[field] = {
                            "format": cleaned[field].get("format", "unknown"),
                            "size": f"{len(cleaned[field]['data'])} characters" if isinstance(cleaned[field]['data'], str) else "binary data"
                        }
            
            return cleaned
        return response_data
    
    def _wrap_tool_with_otel_span(self, tool, tool_name: str = None):
        """Wrap a tool function with OpenTelemetry instrumentation"""
        if not tool_name:
            # Try to extract tool name from different tool types
            if hasattr(tool, 'tool_spec') and isinstance(tool.tool_spec, dict):
                tool_name = tool.tool_spec.get('name', 'unknown_tool')
            elif hasattr(tool, 'name'):
                tool_name = tool.name
            elif hasattr(tool, '__name__'):
                tool_name = tool.__name__
            else:
                tool_name = 'unknown_tool'
        
        # For function tools, wrap the actual function
        if hasattr(tool, '__call__'):
            original_func = tool
            
            @functools.wraps(original_func)
            def wrapped_sync_tool(*args, **kwargs):
                # Get session ID from current baggage context
                session_id = baggage.get_baggage("session.id")
                
                with self.tracer.start_as_current_span(f"execute_tool.{tool_name}") as span:
                    # Add span attributes
                    span.set_attribute("tool.name", tool_name)
                    span.set_attribute("tool.type", "function")
                    if session_id:
                        span.set_attribute("session.id", session_id)
                    
                    # Add input parameters as attributes (limit size for performance)
                    if kwargs:
                        for key, value in kwargs.items():
                            str_value = str(value)
                            if len(str_value) <= 100:  # Limit attribute size
                                span.set_attribute(f"tool.input.{key}", str_value)
                    
                    try:
                        result = original_func(*args, **kwargs)
                        span.set_attribute("tool.status", "success")
                        return result
                    except Exception as e:
                        span.set_attribute("tool.status", "error")
                        span.set_attribute("tool.error", str(e))
                        raise
            
            @functools.wraps(original_func)
            async def wrapped_async_tool(*args, **kwargs):
                # Get session ID from current baggage context
                session_id = baggage.get_baggage("session.id")
                
                with self.tracer.start_as_current_span(f"execute_tool.{tool_name}") as span:
                    # Add span attributes
                    span.set_attribute("tool.name", tool_name)
                    span.set_attribute("tool.type", "async_function")
                    if session_id:
                        span.set_attribute("session.id", session_id)
                    
                    # Add input parameters as attributes (limit size for performance)
                    if kwargs:
                        for key, value in kwargs.items():
                            str_value = str(value)
                            if len(str_value) <= 100:  # Limit attribute size
                                span.set_attribute(f"tool.input.{key}", str_value)
                    
                    try:
                        result = await original_func(*args, **kwargs)
                        span.set_attribute("tool.status", "success")
                        return result
                    except Exception as e:
                        span.set_attribute("tool.status", "error")
                        span.set_attribute("tool.error", str(e))
                        raise
            
            # Check if the function is async
            if asyncio.iscoroutinefunction(original_func):
                return wrapped_async_tool
            else:
                return wrapped_sync_tool
        
        # For tool objects (like PythonAgentTool), wrap their call method
        elif hasattr(tool, '__call__') and hasattr(tool, 'tool_spec'):
            original_call = tool.__call__
            
            @functools.wraps(original_call)
            def wrapped_tool_call(*args, **kwargs):
                # Get session ID from current baggage context
                session_id = baggage.get_baggage("session.id")
                
                with self.tracer.start_as_current_span(f"execute_tool.{tool_name}") as span:
                    # Add span attributes
                    span.set_attribute("tool.name", tool_name)
                    span.set_attribute("tool.type", "agent_tool")
                    if session_id:
                        span.set_attribute("session.id", session_id)
                    
                    # Add input parameters as attributes (limit size for performance)
                    if kwargs:
                        for key, value in kwargs.items():
                            str_value = str(value)
                            if len(str_value) <= 100:  # Limit attribute size
                                span.set_attribute(f"tool.input.{key}", str_value)
                    
                    try:
                        result = original_call(*args, **kwargs)
                        span.set_attribute("tool.status", "success")
                        return result
                    except Exception as e:
                        span.set_attribute("tool.status", "error")
                        span.set_attribute("tool.error", str(e))
                        raise
            
            # Replace the call method with wrapped version
            tool.__call__ = wrapped_tool_call
            return tool
        
        # Return tool as-is if we can't wrap it
        return tool

    # Session-aware MCP methods
    def get_tools_for_session(self, backend_session_id: str, session_config: Dict = None) -> Tuple[List[Any], List[Any]]:
        """Get tools for a specific backend session (includes session-aware MCP tools)"""
        # 1. Get regular tools (Strands + Custom)
        strands_tools = self.get_enabled_strands_tools()
        custom_tools = self.get_enabled_custom_tools()
        
        # 2. Get ALL MCP tools through unified MCPSessionManager approach
        if session_config:
            # Use session-specific config if provided
            session_tools = session_config.get("tools", [])
            enabled_servers = [tool for tool in session_tools 
                             if tool.get("type") == "mcp" and tool.get("enabled", False)]
            logger.info(f"Using session config: {len(enabled_servers)} enabled MCP servers")
        else:
            # Fall back to global config
            enabled_servers = self.get_enabled_mcp_servers()
            logger.info(f"Using global config: {len(enabled_servers)} enabled MCP servers")
        
        # All MCP servers (both stateful and stateless) handled by MCPSessionManager
        # Stateless servers will simply ignore session IDs - no problem!
        all_mcp_tools = self.mcp_session_manager.get_tools_for_session(backend_session_id, enabled_servers)
        logger.info(f"MCPSessionManager returned {len(all_mcp_tools)} MCP tools (unified approach)")
        
        # Wrap all tools with OpenTelemetry instrumentation
        wrapped_tools = []
        for tool in strands_tools + custom_tools + all_mcp_tools:
            try:
                wrapped_tool = self._wrap_tool_with_otel_span(tool)
                wrapped_tools.append(wrapped_tool)
            except Exception as e:
                logger.warning(f"Failed to wrap tool with OTEL span: {e}, using original tool")
                wrapped_tools.append(tool)
        
        logger.info(f"Session {backend_session_id}: {len(wrapped_tools)} tools available (all wrapped with OTEL spans)")
        
        return wrapped_tools, []  # No separate client management needed
    
    def cleanup_session(self, backend_session_id: str):
        """Clean up session resources"""
        self.mcp_session_manager.cleanup_session(backend_session_id)
        logger.info(f"Cleaned up session: {backend_session_id}")
    
    def get_session_stats(self) -> Dict[str, Any]:
        """Get session statistics"""
        return self.mcp_session_manager.get_session_stats()
    
    async def start_session_cleanup_task(self):
        """Start background session cleanup task"""
        await self.mcp_session_manager.start_cleanup_task()
    
    def stop_session_cleanup_task(self):
        """Stop background session cleanup task"""
        self.mcp_session_manager.stop_cleanup_task()

    def test_server_connection(self, server_config: Dict[str, Any]) -> Dict[str, Any]:
        """Test connection to an MCP server"""
        try:
            server_type = server_config["type"]
            config = server_config["config"]
            headers = server_config.get("headers", {})
            
            if server_type in ["streamable_http", "mcp"]:
                # Test HTTP connection by calling tools/list
                url = config["url"]

                # Prepare headers
                request_headers = {
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream"
                }

                # Add Authorization header if provided
                if headers:
                    for key, value in headers.items():
                        if key.lower() in ['x-tavily-api-key', 'tavily-api-key', 'api-key', 'apikey']:
                            request_headers['Authorization'] = f'Bearer {value}'
                            break
                        elif key.lower() == 'authorization':
                            request_headers['Authorization'] = value
                            break

                try:
                    logger.info(f"Testing MCP server connection to: {url}")
                    logger.info(f"Request headers: {request_headers}")
                    
                    # Use the improved MCP response parser
                    def parse_mcp_response(response):
                        """Parse MCP response - handles both JSON and SSE formats"""
                        return self._parse_mcp_response(response)

                    # Check if this is an AgentCore or AWS MCP server that requires authentication
                    from mcp_client_factory import MCPClientFactory

                    # Initialize server payload
                    init_payload = {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {
                                "roots": {
                                    "listChanged": False
                                }
                            },
                            "clientInfo": {"name": "test-client", "version": "1.0.0"}
                        }
                    }

                    if MCPClientFactory.is_aws_server(url):
                        logger.info(f"AWS MCP server detected, using SigV4 authentication for testing")
                        try:
                            # Use SigV4 authenticated requests for AWS MCP servers
                            from mcp_sigv4_client import make_sigv4_request

                            # Resolve SSM URL if needed (for AgentCore and other SSM-based endpoints)
                            resolved_url = MCPClientFactory.resolve_url(url)
                            if resolved_url != url:
                                logger.info(f"Resolved SSM URL: {url} -> {resolved_url}")

                            # Determine service type from URL
                            if "bedrock-agentcore" in resolved_url:
                                service = "bedrock-agentcore"
                                timeout = 10  # AgentCore may take longer
                            elif "execute-api" in resolved_url:
                                service = "execute-api"
                                timeout = 3
                            else:
                                service = "lambda"
                                timeout = 3

                            # Extract region from resolved URL
                            region = MCPClientFactory.extract_region_from_url(resolved_url)

                            logger.info(f"Testing AWS MCP server with SigV4: service={service}, region={region}")

                            # Make SigV4 authenticated request
                            init_response = make_sigv4_request(
                                method="POST",
                                url=resolved_url,
                                headers=request_headers,
                                json_data=init_payload,
                                service=service,
                                region=region,
                                timeout=timeout
                            )

                        except ImportError as e:
                            logger.warning(f"SigV4 client not available for testing AWS MCP server: {e}")
                            return {
                                "success": False,
                                "message": f"AWS MCP server requires SigV4 authentication, but SigV4 client is not available: {e}"
                            }
                    else:
                        # For non-AWS servers, use regular HTTP requests
                        logger.info(f"Testing with initialization (skipping direct tools/list for compatibility)...")
                        logger.info(f"Initialize payload: {init_payload}")

                        # Initialize server first
                        init_response = requests.post(
                            url,
                            json=init_payload,
                            headers=request_headers,
                            timeout=3  # Shorter timeout for init
                        )
                    
                    logger.info(f"Initialize response status: {init_response.status_code}")
                    logger.info(f"Initialize response headers: {dict(init_response.headers)}")
                    logger.info(f"Initialize response text: {init_response.text[:500]}...")
                    
                    if init_response.status_code != 200:
                        return {
                            "success": False,
                            "message": f"Server initialization failed: HTTP {init_response.status_code}: {init_response.text}"
                        }
                    
                    # Parse initialization response to get server info
                    init_result = parse_mcp_response(init_response)
                    server_info = "Unknown MCP Server"
                    if init_result and "result" in init_result:
                        server_info_data = init_result["result"].get("serverInfo", {})
                        server_name = server_info_data.get("name", "Unknown")
                        server_version = server_info_data.get("version", "")
                        server_info = f"{server_name} v{server_version}" if server_version else server_name
                    
                    # For testing purposes, successful initialization is sufficient
                    # This avoids the roots/list timeout issue with Playwright MCP server
                    logger.info(f"✅ MCP server initialization successful: {server_info}")
                    
                    return {
                        "success": True,
                        "message": f"Connection successful! Server: {server_info} (initialization test only)",
                        "tools_count": 0,  # Not queried to avoid timeout
                        "tools": [],
                        "note": "Tools list not queried to avoid roots/list timeout. Server connection verified via initialization."
                    }
                        
                except requests.exceptions.Timeout:
                    return {
                        "success": False,
                        "message": "Connection timeout (reduced to 3 seconds for testing)"
                    }
                except requests.exceptions.ConnectionError:
                    return {
                        "success": False,
                        "message": "Failed to connect to server"
                    }
                except Exception as e:
                    return {
                        "success": False,
                        "message": f"Request failed: {str(e)}"
                    }
            
            else:
                return {
                    "success": True,
                    "message": f"{server_type} server configuration looks valid"
                }
                
        except Exception as e:
            logger.error(f"Error testing server connection: {e}")
            return {
                "success": False,
                "message": f"Test failed with error: {str(e)}"
            }

# Global instance
_unified_tool_manager_instance = None

def get_unified_tool_manager() -> UnifiedToolManager:
    """Get the global unified tool manager instance"""
    global _unified_tool_manager_instance
    if _unified_tool_manager_instance is None:
        _unified_tool_manager_instance = UnifiedToolManager()
    return _unified_tool_manager_instance
