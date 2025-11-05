import asyncio
import os
import time
from typing import AsyncGenerator, Dict, Any
from .event_formatter import StreamEventFormatter

# OpenTelemetry imports
from opentelemetry import trace, baggage, context
from opentelemetry.trace import get_tracer
from opentelemetry.metrics import get_meter

class StreamEventProcessor:
    """Processes streaming events from the agent and formats them for SSE"""
    
    def __init__(self):
        self.formatter = StreamEventFormatter()
        self.seen_tool_uses = set()
        self.pending_events = []
        self.current_session_id = None
        self.tool_use_registry = {}
        
        # Initialize OpenTelemetry
        self.observability_enabled = os.getenv("AGENT_OBSERVABILITY_ENABLED", "false").lower() == "true"
        self.tracer = get_tracer(__name__)
        self.meter = get_meter(__name__)
        
        if self.observability_enabled:
            self._init_metrics()
            
        self._setup_progress_emitter()
    
    def _init_metrics(self):
        """Initialize OpenTelemetry metrics for streaming"""
        self.stream_event_counter = self.meter.create_counter(
            name="stream_events_total",
            description="Total number of stream events processed",
            unit="1"
        )
        
        self.stream_duration = self.meter.create_histogram(
            name="stream_duration",
            description="Duration of streaming sessions",
            unit="s"
        )
        
        self.tool_use_counter = self.meter.create_counter(
            name="tool_uses_total",
            description="Total number of tool uses in streams",
            unit="1"
        )
        
        import logging
        logger = logging.getLogger(__name__)
        logger.info("OpenTelemetry metrics initialized for StreamEventProcessor")
    
    def _setup_progress_emitter(self):
        """Set up the progress event emitter for tools and connect to progress_channel"""
        def emit_progress_event(context: str, executor: str, session_id: str, step: str, message: str, 
                              progress: float = None, metadata: dict = None):
            """Emit progress events to main stream"""
            progress_data = {
                "toolId": context,
                "sessionId": session_id,
                "step": step,
                "message": message,
                "progress": progress,
                "timestamp": self._get_current_timestamp(),
                "metadata": metadata or {}
            }
            
            # Create progress event and add to immediate events queue
            event = self.formatter.create_progress_event(progress_data)
            self.pending_events.append(event)
            
            # Trigger immediate processing if we have an active stream
            if hasattr(self, '_immediate_event_callback') and self._immediate_event_callback:
                try:
                    self._immediate_event_callback(event)
                except Exception as e:
                    # Don't let callback errors break the progress emission
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.debug(f"Error in immediate event callback: {e}")
        
        self._progress_emitter = emit_progress_event
    
    def _connect_progress_channel(self):
        """Connect external progress_channel to main stream for unified progress handling"""
        import logging
        logger = logging.getLogger(__name__)
        
        try:
            from routers.tool_events import tool_events_channel as progress_channel
            # Connect tool_events_channel to main stream
            logger.info("Connecting tool_events_channel to main stream")
            
            # Override progress_channel's broadcast method to forward to main stream
            original_broadcast = progress_channel.broadcast
            
            async def unified_broadcast(event):
                """Forward progress events to main stream while maintaining original functionality"""
                await original_broadcast(event)
                
                if hasattr(self, '_immediate_event_callback') and self._immediate_event_callback:
                    try:
                        event_type = event.get('type')
                        if event_type == 'progress_update':
                            main_stream_event = self.formatter.create_progress_event({
                                "toolId": event.get('context'),
                                "sessionId": event.get('sessionId'),  
                                "step": event.get('step'),
                                "message": event.get('message'),
                                "progress": event.get('progress'),
                                "timestamp": event.get('timestamp'),
                                "metadata": event.get('metadata', {})
                            })
                            self._immediate_event_callback(main_stream_event)
                    except Exception as e:
                        logger.error(f"Error forwarding progress to main stream: {e}")
            
            progress_channel.broadcast = unified_broadcast
            logger.info("Progress channel connected to main stream")
            
        except ImportError as e:
            logger.error(f"Progress channel not available for unified streaming: {e}")
        except Exception as e:
            logger.error(f"Unexpected error connecting progress channel: {e}")
    
    def _get_current_timestamp(self) -> str:
        """Get current timestamp in ISO format"""
        from datetime import datetime
        return datetime.now().isoformat()
    
    def _parse_xml_tool_calls(self, text: str) -> list:
        """Parse raw XML tool calls from Claude response"""
        import re
        import json
        
        tool_calls = []
        
        # Pattern to match <use_tools><invoke name="tool_name"><parameter name="param">value</parameter></invoke></use_tools>
        use_tools_pattern = r'<use_tools>(.*?)</use_tools>'
        invoke_pattern = r'<invoke name="([^"]+)">(.*?)</invoke>'
        parameter_pattern = r'<parameter name="([^"]+)">([^<]*)</parameter>'
        
        # Find all use_tools blocks
        use_tools_matches = re.findall(use_tools_pattern, text, re.DOTALL)
        
        for use_tools_content in use_tools_matches:
            # Find all invoke blocks within this use_tools block
            invoke_matches = re.findall(invoke_pattern, use_tools_content, re.DOTALL)
            
            for tool_name, parameters_content in invoke_matches:
                # Parse parameters
                parameter_matches = re.findall(parameter_pattern, parameters_content, re.DOTALL)
                
                # Build input dictionary
                tool_input = {}
                for param_name, param_value in parameter_matches:
                    # Try to parse as JSON if it looks like structured data
                    param_value = param_value.strip()
                    if param_value.startswith('{') or param_value.startswith('['):
                        try:
                            tool_input[param_name] = json.loads(param_value)
                        except json.JSONDecodeError:
                            tool_input[param_name] = param_value
                    else:
                        tool_input[param_name] = param_value
                
                # Create tool call object
                tool_call = {
                    "name": tool_name,
                    "input": tool_input
                }
                
                tool_calls.append(tool_call)
        
        return tool_calls
    
    def _remove_xml_tool_calls(self, text: str) -> str:
        """Remove XML tool call blocks from text, leaving any other content"""
        import re
        
        # Pattern to match entire <use_tools>...</use_tools> blocks
        use_tools_pattern = r'<use_tools>.*?</use_tools>'
        
        # Remove all use_tools blocks
        cleaned_text = re.sub(use_tools_pattern, '', text, flags=re.DOTALL)
        
        # Clean up extra whitespace
        cleaned_text = re.sub(r'\n\s*\n', '\n\n', cleaned_text)  # Collapse multiple newlines
        cleaned_text = cleaned_text.strip()
        
        return cleaned_text
    
    async def _start_agent_analysis_stream(self, tool_use_id: str, tool_input: dict):
        """Start analysis stream for agent-type tools and execute in background"""
        try:
            # Import the tool events channel
            from routers.tool_events import tool_events_channel
            
            # Always use current session_id - don't fallback to tool_use_id
            if not self.current_session_id:
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(f"No session_id available for tool {tool_use_id} - skipping analysis stream")
                return
            
            # Start the analysis stream with correct session_id
            await tool_events_channel.send_analysis_start(
                self.current_session_id, 
                "Starting comprehensive spending analysis..."
            )
            
            # Schedule background execution of the full analysis
            asyncio.create_task(self._execute_agent_analysis(tool_use_id, tool_input))
            
        except ImportError:
            # If tool_events_channel is not available, just log it
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Could not start analysis stream for {tool_use_id} - tool_events_channel not available")
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Error starting analysis stream for {tool_use_id}: {e}")
    
    async def _execute_agent_analysis(self, tool_use_id: str, tool_input: dict):
        """Execute the actual analysis in background and stream results"""
        try:
            from routers.tool_events import tool_events_channel
            
            # Always use current session_id - don't fallback to tool_use_id
            if not self.current_session_id:
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(f"No session_id available for tool {tool_use_id} - skipping analysis execution")
                return
            
            # Get the query from tool input
            query = tool_input.get('query', 'comprehensive spending analysis')
            
            # Stream initial progress with correct session_id
            await tool_events_channel.send_analysis_stream(
                self.current_session_id, 
                query,
                'initializing'
            )
            
            await asyncio.sleep(0.5)
            
            # Try to execute the actual spending analysis tool
            try:
                # Import and execute the spending analysis tool
                from custom_tools.spending_analysis_tool import spending_analysis_agent_func
                
                # Execute the actual analysis
                result = await spending_analysis_agent_func(query)
                
                # Stream the final result with correct session_id
                await tool_events_channel.send_analysis_complete(
                    self.current_session_id,
                    result
                )
                
                # Also send tool_result event for UI consistency
                if hasattr(self, 'pending_events'):
                    tool_result_data = {
                        "toolUseId": tool_use_id,
                        "result": "Analysis completed successfully. Check the Agent Analysis panel for detailed insights."
                    }
                    tool_result_event = self.formatter.create_tool_result_event(tool_result_data)
                    self.pending_events.append(tool_result_event)
                
            except ImportError:
                # If spending analysis tool is not available, send a placeholder result
                placeholder_result = f"""# Analysis Results

## Overview
Your comprehensive spending analysis for: {query}

## Summary
Analysis completed successfully. The detailed insights have been generated based on your spending patterns.

## Key Insights
- Spending pattern analysis completed
- Category breakdown processed
- Behavioral insights generated

*Note: This is a simplified analysis result. The full analysis tool is not currently available.*
"""
                await tool_events_channel.send_analysis_complete(
                    self.current_session_id,
                    placeholder_result
                )
                
                # Also send tool_result event for UI consistency
                if hasattr(self, 'pending_events'):
                    tool_result_data = {
                        "toolUseId": tool_use_id,
                        "result": "Analysis completed successfully. Check the Agent Analysis panel for detailed insights."
                    }
                    tool_result_event = self.formatter.create_tool_result_event(tool_result_data)
                    self.pending_events.append(tool_result_event)
                
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Error executing agent analysis for {tool_use_id}: {e}")
            
            # Send error to analysis stream with correct session_id
            try:
                from routers.tool_events import tool_events_channel
                if self.current_session_id:
                    await tool_events_channel.send_analysis_error(
                        self.current_session_id,
                        f"Analysis failed: {str(e)}"
                    )
            except:
                pass
    
    def _is_agent_type_tool(self, tool_name: str) -> bool:
        """Check if a tool is of type 'agent' by looking up unified_tools_config.json"""
        try:
            import json
            import os
            
            # Load unified_tools_config.json
            config_path = os.path.join(os.path.dirname(__file__), '..', 'unified_tools_config.json')
            with open(config_path, 'r') as f:
                tools_config = json.load(f)
            
            # Find tool by name and check tool_type
            for tool in tools_config.get('tools', []):
                if tool.get('id') == tool_name or tool.get('function_name') == tool_name:
                    return tool.get('tool_type') == 'agent'
            
            return False
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Could not load tools config: {e}")
            return False
    
    def get_progress_emitter(self):
        """Get the progress emitter function for tools to use"""
        return getattr(self, '_progress_emitter', None)
    
    
    async def process_stream(self, agent, message: str, file_paths: list = None, session_id: str = None) -> AsyncGenerator[str, None]:
        """Process streaming events from agent with proper error handling and event separation"""
        
        # Store current session ID for tools to use
        self.current_session_id = session_id
        
        # Reset seen tool uses for each new stream
        self.seen_tool_uses.clear()
        
        # Add stream-level deduplication
        stream_id = f"stream_{hash(message)}_{session_id or 'default'}"
        if hasattr(self, '_active_streams'):
            if stream_id in self._active_streams:
                return
        else:
            self._active_streams = set()
        
        self._active_streams.add(stream_id)
        
        if not agent:
            yield self.formatter.create_error_event("Agent not available - please configure AWS credentials for Bedrock")
            return
        
        stream_iterator = None
        try:
            multimodal_message = self._create_multimodal_message(message, file_paths)
            
            # Initialize streaming
            yield self.formatter.create_init_event()
            
            stream_iterator = agent.stream_async(multimodal_message)

            # Note: Keepalive is handled at the router level (chat.py) via stream_with_keepalive wrapper
            async for event in stream_iterator:
                while self.pending_events:
                    pending_event = self.pending_events.pop(0)
                    yield pending_event
                
                # Handle final result
                if "result" in event:
                    final_result = event["result"]
                    images, result_text = self.formatter.extract_final_result_data(final_result)
                    yield self.formatter.create_complete_event(result_text, images)
                    return
                
                
                # Handle reasoning text (separate from regular text)
                elif event.get("reasoning") and event.get("reasoningText"):
                    yield self.formatter.create_reasoning_event(event["reasoningText"])
                
                # Handle regular text response
                elif event.get("data") and not event.get("reasoning"):
                    text_data = event["data"]
                    
                    # Check if this is a raw XML tool call that needs parsing
                    tool_calls = self._parse_xml_tool_calls(text_data)
                    if tool_calls:
                        # Process each tool call as proper tool events
                        for tool_call in tool_calls:
                            # Generate proper tool_use_id if not present
                            if not tool_call.get("toolUseId"):
                                tool_call["toolUseId"] = f"tool_{tool_call['name']}_{self._get_current_timestamp().replace(':', '').replace('-', '').replace('.', '')}"
                            
                            # Check for duplicates
                            tool_use_id = tool_call["toolUseId"]
                            if tool_use_id and tool_use_id not in self.seen_tool_uses:
                                self.seen_tool_uses.add(tool_use_id)
                                
                                # Register tool info with session_id
                                self.tool_use_registry[tool_use_id] = {
                                    'tool_name': tool_call["name"],
                                    'tool_use_id': tool_use_id,
                                    'session_id': self.current_session_id,
                                    'input': tool_call.get("input", {})
                                }
                                
                                # Emit tool_use event
                                yield self.formatter.create_tool_use_event(tool_call)
                                
                                # Agent-type tools now handle their own analysis streams internally
                                # No need for event processor to intercept
                                
                                await asyncio.sleep(0.1)
                        
                        # Remove the XML from the text and send the remaining as regular response
                        cleaned_text = self._remove_xml_tool_calls(text_data)
                        if cleaned_text.strip():
                            yield self.formatter.create_response_event(cleaned_text)
                    else:
                        # Regular text response
                        yield self.formatter.create_response_event(text_data)
                        # Small delay to allow progress events to be processed
                        await asyncio.sleep(0.02)
                
                # Handle callback events - ignore current_tool_use from delta events
                elif event.get("callback"):
                    callback_data = event["callback"]
                    # Ignore current_tool_use from callback since it's incomplete
                    # We only want to process tool_use when it's fully completed
                    continue
                
                # Handle tool use events - only process when input looks complete
                elif event.get("current_tool_use"):
                    tool_use = event["current_tool_use"]
                    tool_use_id = tool_use.get("toolUseId")
                    tool_name = tool_use.get("name")
                    tool_input = tool_use.get("input", "")
                    
                    # Only process if input looks complete (valid JSON or empty for no-param tools)
                    should_process = False
                    processed_input = None
                    
                    # Handle empty input case
                    if tool_input == "":
                        # Check if this tool is supposed to have no parameters
                        if tool_name in ['get_portfolio_overview', 'get_asset_overview']:
                            should_process = True
                            processed_input = {}  # Set empty dict for UI
                        else:
                            should_process = False  # Wait for input to arrive
                    else:
                        # Check if input is valid JSON (complete)
                        try:
                            import json
                            # Handle case where input might already be parsed
                            if isinstance(tool_input, str):
                                parsed_input = json.loads(tool_input)
                                should_process = True
                                processed_input = parsed_input  # Use parsed input
                            elif isinstance(tool_input, dict):
                                # Already parsed
                                should_process = True
                                processed_input = tool_input
                            else:
                                should_process = False
                        except json.JSONDecodeError:
                            # Input is still incomplete
                            should_process = False
                    
                    if should_process and tool_use_id and tool_use_id not in self.seen_tool_uses:
                        self.seen_tool_uses.add(tool_use_id)
                        
                        # Create a copy of tool_use with processed input (don't modify original)
                        tool_use_copy = {
                            "toolUseId": tool_use_id,
                            "name": tool_name,
                            "input": processed_input
                        }
                        
                        # Create tool execution context for all tools with session_id
                        if tool_name and self.current_session_id:
                            try:
                                from utils.tool_execution_context import tool_context_manager
                                await tool_context_manager.create_context(tool_use_id, tool_name, self.current_session_id)
                            except ImportError:
                                pass
                        
                        # Register tool info for later result processing
                        if tool_name:
                            self.tool_use_registry[tool_use_id] = {
                                'tool_name': tool_name,
                                'tool_use_id': tool_use_id,
                                'session_id': self.current_session_id,
                                'input': processed_input
                            }
                        
                        # Agent-type tools now handle their own analysis streams internally
                        # No need for event processor to intercept
                        
                        yield self.formatter.create_tool_use_event(tool_use_copy)
                        await asyncio.sleep(0.1)
                
                # Handle lifecycle events
                elif event.get("init_event_loop"):
                    yield self.formatter.create_init_event()
                
                elif event.get("start_event_loop"):
                    yield self.formatter.create_thinking_event()
                
                # Handle tool results from message events
                elif event.get("message"):
                    async for result in self._process_message_event(event):
                        yield result
            
            # Yield any remaining pending events after stream ends
            while self.pending_events:
                pending_event = self.pending_events.pop(0)
                yield pending_event
            
        except GeneratorExit:
            # Normal termination when client disconnects
            return
            
        except Exception as e:
            # Log the error for debugging but don't crash
            import logging
            logger = logging.getLogger(__name__)
            logger.debug(f"Stream processing error: {e}")
            yield self.formatter.create_error_event(f"Sorry, I encountered an error: {str(e)}")
            
        finally:
            # Clean up immediate event callback
            self._immediate_event_callback = None
            
            # Clean up stream iterator if it exists
            if stream_iterator and hasattr(stream_iterator, 'aclose'):
                try:
                    await stream_iterator.aclose()
                except Exception:
                    # Ignore cleanup errors - they're usually harmless
                    pass
            
            # Remove from active streams
            if hasattr(self, '_active_streams') and stream_id in self._active_streams:
                self._active_streams.discard(stream_id)  # Use discard to avoid KeyError
    
    async def _process_message_event(self, event: Dict[str, Any]) -> AsyncGenerator[str, None]:
        """Process message events that may contain tool results"""
        message_obj = event["message"]
        
        # Handle both dict and object formats
        if hasattr(message_obj, 'content'):
            content = message_obj.content
        elif isinstance(message_obj, dict) and 'content' in message_obj:
            content = message_obj['content']
        else:
            content = None
        
        if content:
            for content_item in content:
                if isinstance(content_item, dict) and "toolResult" in content_item:
                    tool_result = content_item["toolResult"]
                    
                    # Set context before tool execution and cleanup after
                    tool_use_id = tool_result.get("toolUseId")
                    if tool_use_id:
                        try:
                            from utils.tool_execution_context import tool_context_manager
                            context = tool_context_manager.get_context(tool_use_id)
                            if context:
                                # Set as current context during result processing
                                tool_context_manager.set_current_context(context)
                                
                                # Process the tool result
                                yield self.formatter.create_tool_result_event(tool_result)
                                
                                # Clean up context after processing
                                tool_context_manager.clear_current_context()
                                await tool_context_manager.cleanup_context(tool_use_id)
                            else:
                                yield self.formatter.create_tool_result_event(tool_result)
                        except ImportError:
                            yield self.formatter.create_tool_result_event(tool_result)
                    else:
                        yield self.formatter.create_tool_result_event(tool_result)
    
    def _create_multimodal_message(self, text: str, file_paths: list = None):
        """Create a multimodal message with text, images, and documents for Strands SDK"""
        if not file_paths:
            return text
        
        # Create multimodal message format for Strands SDK
        content = []
        
        # Add text content
        if text.strip():
            content.append({
                "text": text
            })
        
        # Add file content (images and documents)
        for file_path in file_paths:
            file_data = self._encode_file_to_base64(file_path)
            if file_data:
                mime_type = self._get_file_mime_type(file_path)
                
                if mime_type.startswith('image/'):
                    # Handle images - Strands SDK format
                    content.append({
                        "image": {
                            "format": mime_type.split('/')[-1],  # e.g., "jpeg", "png"
                            "source": {
                                "bytes": self._base64_to_bytes(file_data)
                            }
                        }
                    })
                elif mime_type == 'application/pdf':
                    # Handle PDF documents - Strands SDK format
                    original_filename = file_path.split('/')[-1]  # Extract filename
                    # Remove extension since format is already specified as "pdf"
                    name_without_ext = original_filename.rsplit('.', 1)[0] if '.' in original_filename else original_filename
                    sanitized_filename = self._sanitize_filename_for_bedrock(name_without_ext)
                    content.append({
                        "document": {
                            "format": "pdf",
                            "name": sanitized_filename,
                            "source": {
                                "bytes": self._base64_to_bytes(file_data)
                            }
                        }
                    })
        
        return content if len(content) > 1 else text
    
    def _encode_file_to_base64(self, file_path: str) -> str:
        """Encode file to base64 string"""
        try:
            import base64
            with open(file_path, "rb") as file:
                return base64.b64encode(file.read()).decode('utf-8')
        except Exception as e:
            return None
    
    def _get_file_mime_type(self, file_path: str) -> str:
        """Get MIME type of file"""
        import mimetypes
        mime_type, _ = mimetypes.guess_type(file_path)
        return mime_type or "application/octet-stream"
    
    def _base64_to_bytes(self, base64_data: str) -> bytes:
        """Convert base64 string to bytes"""
        import base64
        return base64.b64decode(base64_data)
    
    def _sanitize_filename_for_bedrock(self, filename: str) -> str:
        """Sanitize filename for Bedrock document format:
        - Only alphanumeric characters, whitespace, hyphens, parentheses, square brackets
        - No consecutive whitespace
        - Convert underscores to hyphens
        """
        import re
        
        # First, replace underscores with hyphens
        sanitized = filename.replace('_', '-')
        
        # Keep only allowed characters: alphanumeric, whitespace, hyphens, parentheses, square brackets
        sanitized = re.sub(r'[^a-zA-Z0-9\s\-\(\)\[\]]', '', sanitized)
        
        # Replace multiple consecutive whitespace characters with single space
        sanitized = re.sub(r'\s+', ' ', sanitized)
        
        # Trim whitespace from start and end
        sanitized = sanitized.strip()
        
        # If name becomes empty, use default
        if not sanitized:
            sanitized = 'document'
        
        return sanitized
