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

    async def process_stream(self, agent, message: str, file_paths: list = None, session_id: str = None) -> AsyncGenerator[str, None]:
        """Process streaming events from agent with proper error handling and event separation"""

        # Store current session ID for tools to use
        self.current_session_id = session_id

        # Reset seen tool uses for each new stream
        self.seen_tool_uses.clear()

        # Add stream-level deduplication
        # Handle both string and list (multimodal) messages
        if isinstance(message, list):
            # For list messages, create a hash based on session_id and timestamp
            import time
            stream_id = f"stream_list_{session_id or 'default'}_{int(time.time() * 1000)}"
        else:
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
                # Check if session was cancelled (stop button clicked)
                if hasattr(agent, 'session_manager') and hasattr(agent.session_manager, 'cancelled'):
                    if agent.session_manager.cancelled:
                        import logging
                        logger = logging.getLogger(__name__)
                        logger.info(f"🛑 Stream cancelled for session {session_id} - stopping event processing")
                        # Send stop event and exit stream
                        yield self.formatter.create_response_event("\n\n*Session stopped by user*")
                        break
                while self.pending_events:
                    pending_event = self.pending_events.pop(0)
                    yield pending_event
                
                # Handle final result
                if "result" in event:
                    final_result = event["result"]
                    images, result_text = self.formatter.extract_final_result_data(final_result)

                    # Extract token usage from Strands SDK metrics
                    usage = None
                    try:
                        import logging
                        logger = logging.getLogger(__name__)

                        if hasattr(final_result, 'metrics') and hasattr(final_result.metrics, 'accumulated_usage'):
                            accumulated_usage = final_result.metrics.accumulated_usage

                            # accumulated_usage is a dict with camelCase keys
                            if isinstance(accumulated_usage, dict):
                                usage = {
                                    "inputTokens": accumulated_usage.get("inputTokens", 0),
                                    "outputTokens": accumulated_usage.get("outputTokens", 0),
                                    "totalTokens": accumulated_usage.get("totalTokens", 0)
                                }
                                # Add optional cache token fields if present and non-zero
                                if accumulated_usage.get("cacheReadInputTokens", 0) > 0:
                                    usage["cacheReadInputTokens"] = accumulated_usage["cacheReadInputTokens"]
                                if accumulated_usage.get("cacheWriteInputTokens", 0) > 0:
                                    usage["cacheWriteInputTokens"] = accumulated_usage["cacheWriteInputTokens"]

                                # Log detailed cache information
                                cache_read = accumulated_usage.get("cacheReadInputTokens", 0)
                                cache_write = accumulated_usage.get("cacheWriteInputTokens", 0)
                                if cache_read > 0 or cache_write > 0:
                                    logger.info(f"[Cache Usage] 🎯 Cache READ: {cache_read} tokens | Cache WRITE: {cache_write} tokens")
                                    if cache_read > 0:
                                        cache_savings = cache_read * 0.9  # 90% savings from cache
                                        logger.info(f"[Cache Savings] 💰 Saved ~{cache_savings:.0f} tokens from cache hit!")

                                logger.info(f"[Token Usage] ✅ Total - Input: {usage['inputTokens']}, Output: {usage['outputTokens']}, Total: {usage['totalTokens']}")
                    except Exception as e:
                        import logging
                        logger = logging.getLogger(__name__)
                        logger.error(f"[Token Usage] Error extracting token usage: {e}")
                        # Continue without usage data

                    yield self.formatter.create_complete_event(result_text, images, usage)
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
                        # For tools with no parameters, empty input is valid
                        # For tools with parameters, we need to wait for input
                        # Check if tool_input arrives as empty string initially then gets populated
                        # To be safe, we'll wait a bit to see if parameters arrive
                        should_process = False
                        processed_input = None
                    elif tool_input == "{}":
                        # Empty JSON object means tool has no parameters (valid)
                        should_process = True
                        processed_input = {}
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
