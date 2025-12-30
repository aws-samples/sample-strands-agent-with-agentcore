import asyncio
import os
import time
import logging
from typing import AsyncGenerator, Dict, Any
from .event_formatter import StreamEventFormatter
from agent.stop_signal import get_stop_signal_provider

# OpenTelemetry imports
from opentelemetry import trace, baggage, context
from opentelemetry.trace import get_tracer
from opentelemetry.metrics import get_meter

logger = logging.getLogger(__name__)


class StopRequestedException(Exception):
    """Raised when stop signal is detected during streaming"""
    pass

class StreamEventProcessor:
    """Processes streaming events from the agent and formats them for SSE"""

    def __init__(self):
        self.formatter = StreamEventFormatter()
        self.seen_tool_uses = set()
        self.current_session_id = None
        self.current_user_id = None
        self.tool_use_registry = {}
        self.partial_response_text = ""  # Track partial response for graceful abort

        # Stop signal provider (Strategy pattern - Local or DynamoDB)
        self.stop_signal_provider = get_stop_signal_provider()
        self.last_stop_check_time = 0
        self.stop_check_interval = 1.0  # Check every 1 second (configurable)

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
        
        logger.info("OpenTelemetry metrics initialized for StreamEventProcessor")
    
    def _get_current_timestamp(self) -> str:
        """Get current timestamp in ISO format"""
        from datetime import datetime
        return datetime.now().isoformat()

    def _should_check_stop_signal(self) -> bool:
        """Check if enough time has passed to check stop signal (throttling)"""
        current_time = time.time()
        if current_time - self.last_stop_check_time >= self.stop_check_interval:
            self.last_stop_check_time = current_time
            return True
        return False

    def _check_stop_signal(self) -> bool:
        """Check if stop has been requested for current session"""
        if not self.current_user_id or not self.current_session_id:
            logger.debug(f"[StopSignal] Skipping check - user_id: {self.current_user_id}, session_id: {self.current_session_id}")
            return False

        if not self._should_check_stop_signal():
            return False

        try:
            is_stopped = self.stop_signal_provider.is_stop_requested(
                self.current_user_id,
                self.current_session_id
            )
            if is_stopped:
                logger.info(f"[StopSignal] 🛑 Stop signal detected for {self.current_user_id}:{self.current_session_id}")
            return is_stopped
        except Exception as e:
            logger.warning(f"[StopSignal] Error checking stop signal: {e}")
            return False

    def _clear_stop_signal(self) -> None:
        """Clear stop signal after processing"""
        if not self.current_user_id or not self.current_session_id:
            return

        try:
            self.stop_signal_provider.clear_stop_signal(
                self.current_user_id,
                self.current_session_id
            )
        except Exception as e:
            logger.warning(f"[StopSignal] Error clearing stop signal: {e}")

    def _save_partial_response(self, agent, session_id: str) -> bool:
        """Save partial response when stream is interrupted."""
        if not self.partial_response_text.strip():
            return False

        abort_message_text = self.partial_response_text.strip() + "\n\n**[Response interrupted by user]**"
        self.partial_response_text = ""

        session_mgr = getattr(agent, 'session_manager', None) or getattr(agent, '_session_manager', None)
        if not session_mgr:
            return False

        try:
            abort_message = {"role": "assistant", "content": [{"text": abort_message_text}]}
            session_mgr.append_message(abort_message, agent)
            if hasattr(session_mgr, 'flush'):
                session_mgr.flush()
            return True
        except Exception as e:
            logger.error(f"Failed to save partial response: {e}")
            return False

    def _get_last_pending_tool_id(self) -> str:
        """Get the last tool_use_id that was started but hasn't received a result yet.

        This is used for error recovery - when an error occurs, we can emit
        an error tool_result for the pending tool so the agent can self-recover.

        Returns:
            The last pending tool_use_id, or None if no pending tools
        """
        if not self.tool_use_registry:
            return None

        # Find tools that were started but might not have completed
        # Since we track all seen tool uses, return the most recent one
        # The tool_use_registry contains {tool_use_id: {tool_name, session_id, input}}
        if self.tool_use_registry:
            # Return the last registered tool (most recent)
            last_tool_id = list(self.tool_use_registry.keys())[-1] if self.tool_use_registry else None
            if last_tool_id:
                logger.info(f"[Error Recovery] Found pending tool: {last_tool_id}")
            return last_tool_id

        return None

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

    async def process_stream(self, agent, message: str, file_paths: list = None, session_id: str = None, invocation_state: dict = None) -> AsyncGenerator[str, None]:
        """Process streaming events from agent with proper error handling and event separation"""

        # Store current session ID and invocation_state for tools to use
        self.current_session_id = session_id
        self.invocation_state = invocation_state or {}

        # Extract user_id from invocation_state for stop signal checking
        self.current_user_id = self.invocation_state.get('user_id')

        # Log stop signal provider info for debugging
        logger.info(f"[StopSignal] Stream started - user_id: {self.current_user_id}, session_id: {self.current_session_id}")
        logger.info(f"[StopSignal] Provider: {type(self.stop_signal_provider).__name__}")

        # Reset stop signal check timer
        self.last_stop_check_time = 0

        # Reset seen tool uses for each new stream
        self.seen_tool_uses.clear()

        # Reset partial response tracking for this stream
        self.partial_response_text = ""

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
        stream_completed_normally = False  # Track if stream completed without interruption
        try:
            multimodal_message = self._create_multimodal_message(message, file_paths)

            # Initialize streaming
            yield self.formatter.create_init_event()

            # Pass invocation_state to agent for tool context access
            if invocation_state:
                stream_iterator = agent.stream_async(multimodal_message, invocation_state=invocation_state)
            else:
                stream_iterator = agent.stream_async(multimodal_message)

            # Track documents from tool results in this turn (for complete event)
            self.turn_documents = []

            async for event in stream_iterator:
                # Check stop signal periodically (throttled to reduce DB calls)
                if self._check_stop_signal():
                    logger.info(f"[StopSignal] 🛑 Stopping stream for session {session_id}")
                    self._clear_stop_signal()
                    raise StopRequestedException("Stop requested by user")

                # Check for browser session ARN in invocation_state (for Live View)
                # This is set by A2A tool callback when browser_session_arn artifact is received
                if hasattr(self, 'invocation_state') and self.invocation_state:
                    browser_session_arn = self.invocation_state.get('browser_session_arn')
                    if browser_session_arn and not self.invocation_state.get('_browser_session_emitted'):
                        # Mark as emitted to avoid duplicate events
                        self.invocation_state['_browser_session_emitted'] = True
                        import logging as _logging
                        _logger = _logging.getLogger(__name__)
                        _logger.info(f"🔴 [Live View] Emitting browser session from invocation_state: {browser_session_arn}")
                        yield self.formatter.create_metadata_event({
                            "browserSessionId": browser_session_arn
                        })

                # Handle final result
                if "result" in event:
                    logger.info("[Final Result] 🎯 Received final result event from agent")
                    final_result = event["result"]

                    # Check for interrupt (HITL - Human-in-the-loop)
                    if hasattr(final_result, 'stop_reason') and final_result.stop_reason == "interrupt":
                        if hasattr(final_result, 'interrupts') and final_result.interrupts:
                            logger.info(f"🔔 Interrupt detected: {len(final_result.interrupts)} interrupt(s)")

                            # Log interrupt details
                            for interrupt in final_result.interrupts:
                                logger.info(f"   Interrupt ID: {interrupt.id}, Name: {interrupt.name}")
                                if hasattr(interrupt, 'reason'):
                                    logger.info(f"   Reason: {interrupt.reason}")

                            # Send interrupt event to frontend
                            interrupt_event = self.formatter.create_interrupt_event(final_result.interrupts)
                            logger.info(f"📤 Sending interrupt event to frontend: {interrupt_event[:200]}...")
                            yield interrupt_event
                            logger.info(f"✅ Interrupt event sent, closing stream")
                            return

                    images, result_text = self.formatter.extract_final_result_data(final_result)
                    logger.info(f"[Final Result] Extracted data - has images: {bool(images)}, text length: {len(result_text) if result_text else 0}")

                    # Extract token usage from Strands SDK metrics
                    usage = None
                    try:

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
                        logger.error(f"[Token Usage] Error extracting token usage: {e}")
                        # Continue without usage data

                    # Include documents collected during this turn
                    documents = self.turn_documents if hasattr(self, 'turn_documents') and self.turn_documents else None
                    if documents:
                        logger.info(f"[DocumentDownload] Including {len(documents)} documents in complete event")

                    logger.info(f"[Final Result] 📤 Emitting complete event and closing stream")
                    yield self.formatter.create_complete_event(result_text, images, usage, documents)
                    logger.info(f"[Final Result] ✅ Complete event emitted, stream ended")
                    stream_completed_normally = True
                    return
                
                
                # Handle reasoning text (separate from regular text)
                elif event.get("reasoning") and event.get("reasoningText"):
                    yield self.formatter.create_reasoning_event(event["reasoningText"])
                
                # Handle regular text response
                elif event.get("data") and not event.get("reasoning"):
                    text_data = event["data"]

                    # Accumulate text for potential abort handling
                    self.partial_response_text += text_data

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
                    if tool_input == "" or tool_input == "{}":
                        # Empty string or empty JSON object
                        # Emit to frontend so it can show "Preparing..." state
                        logger.info(f"[Tool Use Event] 📋 Empty input for {tool_name} - emitting for frontend to show preparing state")
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
                                logger.info(f"[Tool Use Event] ✅ Parsed input for {tool_name} - keys: {list(parsed_input.keys()) if isinstance(parsed_input, dict) else 'not a dict'}")
                            elif isinstance(tool_input, dict):
                                # Already parsed
                                should_process = True
                                processed_input = tool_input
                                logger.info(f"[Tool Use Event] ✅ Dict input received for {tool_name} - keys: {list(tool_input.keys())}")
                            else:
                                should_process = False
                                logger.debug(f"[Tool Use Event] Unexpected input type: {type(tool_input).__name__}")
                        except json.JSONDecodeError as e:
                            # Input is still incomplete (streaming in progress) - this is normal, skip silently
                            should_process = False
                            logger.debug(f"[Tool Use Event] Incomplete input for {tool_name} (streaming): {str(e)[:100]}")

                    if should_process and tool_use_id:
                        # Check if this is a new tool or parameter update
                        is_new_tool = tool_use_id not in self.seen_tool_uses
                        is_parameter_update = (not is_new_tool and
                                             processed_input is not None and
                                             len(processed_input) > 0)

                        if is_new_tool or is_parameter_update:
                            # Mark as seen for new tools
                            if is_new_tool:
                                self.seen_tool_uses.add(tool_use_id)
                                logger.info(f"[Tool Use Event] 🆕 New tool use registered: {tool_name} ({tool_use_id})")

                            # Create a copy of tool_use with processed input (don't modify original)
                            tool_use_copy = {
                                "toolUseId": tool_use_id,
                                "name": tool_name,
                                "input": processed_input
                            }

                            # Create tool execution context for new tools
                            if is_new_tool and tool_name and self.current_session_id:
                                try:
                                    from utils.tool_execution_context import tool_context_manager
                                    await tool_context_manager.create_context(tool_use_id, tool_name, self.current_session_id)
                                except ImportError:
                                    pass

                            # Register tool info for later result processing (for new tools)
                            if is_new_tool and tool_name:
                                self.tool_use_registry[tool_use_id] = {
                                    'tool_name': tool_name,
                                    'tool_use_id': tool_use_id,
                                    'session_id': self.current_session_id,
                                    'input': processed_input
                                }

                            # Yield event (new tool or parameter update)
                            logger.info(f"[Tool Use Event] 📤 Emitting tool_use event for {tool_name} with {len(processed_input)} parameter(s)")
                            yield self.formatter.create_tool_use_event(tool_use_copy)

                            await asyncio.sleep(0.1)
                
                # Handle tool streaming events (from async generator tools)
                elif event.get("tool_stream_event"):
                    tool_stream = event["tool_stream_event"]
                    stream_data = tool_stream.get("data", {})

                    # Check if this is browser session detected event
                    if isinstance(stream_data, dict) and stream_data.get("type") == "browser_session_detected":
                        browser_session_id = stream_data.get("browserSessionId")
                        browser_id = stream_data.get("browserId")
                        logger.info(f"[Live View] 🔴 Received browser session from tool stream: {browser_session_id}, browserId: {browser_id}")

                        # Update invocation_state so it's available for tool result processing
                        if browser_session_id:
                            self.invocation_state['browser_session_arn'] = browser_session_id
                            if browser_id:
                                self.invocation_state['browser_id'] = browser_id
                            logger.info(f"[Live View] Stored browser session in invocation_state for immediate Live View")

                            # Send metadata event to frontend for immediate Live View
                            metadata = {"browserSessionId": browser_session_id}
                            if browser_id:
                                metadata["browserId"] = browser_id

                            yield self.formatter.create_metadata_event(metadata)
                            logger.info(f"[Live View] ✅ Sent metadata event to frontend with browserSessionId and browserId")

                        # Also send a response message
                        yield self.formatter.create_response_event(f"\n\n*{stream_data.get('message', 'Browser session started')}*\n\n")

                    # Check if this is browser step event (real-time progress)
                    elif isinstance(stream_data, dict) and stream_data.get("type") == "browser_step":
                        step_content = stream_data.get("content", "")
                        step_number = stream_data.get("stepNumber", 0)

                        if step_content:
                            logger.info(f"[Browser Step] 🔴 Streaming browser_step_{step_number} to frontend")
                            # Send as browser_progress event (NOT response) to display in Browser Modal
                            yield self.formatter.create_browser_progress_event(step_content, step_number)

                    else:
                        # Other tool stream events (e.g., progress)
                        logger.debug(f"[Tool Stream] Received: {stream_data}")

                # Handle lifecycle events
                elif event.get("init_event_loop"):
                    yield self.formatter.create_init_event()

                elif event.get("start_event_loop"):
                    yield self.formatter.create_thinking_event()

                # Handle tool results from message events
                elif event.get("message"):
                    logger.info("[Message Event] 📨 Received message event (likely contains tool_result)")
                    async for result in self._process_message_event(event):
                        yield result

        except StopRequestedException:
            self._save_partial_response(agent, session_id)
            yield self.formatter.create_complete_event("Stream stopped by user")
            stream_completed_normally = True
            return

        except GeneratorExit:
            self._save_partial_response(agent, session_id)
            stream_completed_normally = True
            return

        except Exception as e:
            logger.error(f"Stream error: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")

            # Check if there's a pending tool that needs an error result
            # This allows the agent to self-recover from errors
            pending_tool_id = self._get_last_pending_tool_id()
            if pending_tool_id:
                logger.info(f"[Error Recovery] Emitting error as tool_result for {pending_tool_id}")
                error_tool_result = {
                    "toolUseId": pending_tool_id,
                    "status": "error",
                    "content": [{"text": f"Tool execution failed: {str(e)}"}]
                }
                yield self.formatter.create_tool_result_event(error_tool_result)
            else:
                # No pending tool, emit as error event (chat message)
                yield self.formatter.create_error_event(f"Sorry, I encountered an error: {str(e)}")

        finally:
            if not stream_completed_normally:
                self._save_partial_response(agent, session_id)

            if stream_iterator and hasattr(stream_iterator, 'aclose'):
                try:
                    await stream_iterator.aclose()
                except Exception:
                    pass

            if hasattr(self, '_active_streams'):
                self._active_streams.discard(stream_id)
    
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
            logger.info(f"[Message Event] Processing message with {len(content)} content item(s)")
            for content_item in content:
                if isinstance(content_item, dict) and "toolResult" in content_item:
                    tool_result = content_item["toolResult"]
                    tool_use_id = tool_result.get("toolUseId")
                    status = tool_result.get("status", "unknown")
                    logger.info(f"[Tool Result] 🔧 Processing tool_result - toolUseId: {tool_use_id}, status: {status}")

                    # Wrap tool result processing in try-except for graceful error handling
                    # This ensures errors are returned as tool_result for agent self-recovery
                    try:
                        async for result in self._process_single_tool_result(tool_result, tool_use_id):
                            yield result
                    except Exception as e:
                        logger.error(f"[Tool Result] ❌ Error processing tool_result {tool_use_id}: {e}")
                        # Emit error as tool_result so agent can self-recover
                        error_tool_result = {
                            "toolUseId": tool_use_id or "unknown",
                            "status": "error",
                            "content": [{"text": f"Error processing tool result: {str(e)}"}]
                        }
                        yield self.formatter.create_tool_result_event(error_tool_result)

    async def _process_single_tool_result(self, tool_result: Dict[str, Any], tool_use_id: str) -> AsyncGenerator[str, None]:
        """Process a single tool result with proper error handling"""
        # Note: browserSessionId is now handled via tool stream events (immediate)
        # No need to extract from tool result (too late)

        # Set context before tool execution and cleanup after
        if tool_use_id:
            try:
                from utils.tool_execution_context import tool_context_manager
                context = tool_context_manager.get_context(tool_use_id)
                if context:
                    # Set as current context during result processing
                    tool_context_manager.set_current_context(context)

                    # Add browser session metadata from invocation_state (for Live View)
                    self._add_browser_metadata(tool_result)

                    # Collect documents from tool result (for complete event)
                    self._collect_document_info(tool_result)

                    # Process the tool result
                    logger.info(f"[Tool Result] 📤 Emitting tool_result event for {tool_use_id}")
                    yield self.formatter.create_tool_result_event(tool_result)

                    # Clean up context after processing
                    tool_context_manager.clear_current_context()
                    await tool_context_manager.cleanup_context(tool_use_id)
                else:
                    # Add browser session metadata even if no context
                    self._add_browser_metadata(tool_result)

                    # Collect documents from tool result (for complete event)
                    self._collect_document_info(tool_result)

                    logger.info(f"[Tool Result] 📤 Emitting tool_result event for {tool_use_id} (no context)")
                    yield self.formatter.create_tool_result_event(tool_result)
            except ImportError:
                # Add browser session metadata even if import fails
                self._add_browser_metadata(tool_result)

                # Collect documents from tool result (for complete event)
                self._collect_document_info(tool_result)

                logger.info(f"[Tool Result] 📤 Emitting tool_result event for {tool_use_id} (without tool_context_manager)")
                yield self.formatter.create_tool_result_event(tool_result)
        else:
            # Collect documents from tool result (for complete event)
            self._collect_document_info(tool_result)

            logger.info(f"[Tool Result] 📤 Emitting tool_result event (no tool_use_id)")
            yield self.formatter.create_tool_result_event(tool_result)

    def _add_browser_metadata(self, tool_result: Dict[str, Any]) -> None:
        """Add browser session metadata to tool result if available"""
        if hasattr(self, 'invocation_state') and 'browser_session_arn' in self.invocation_state:
            if "metadata" not in tool_result:
                tool_result["metadata"] = {}
            tool_result["metadata"]["browserSessionId"] = self.invocation_state['browser_session_arn']
            if 'browser_id' in self.invocation_state:
                tool_result["metadata"]["browserId"] = self.invocation_state['browser_id']
            logger.info(f"[Live View] Added browserSessionId to tool result metadata: {self.invocation_state['browser_session_arn']}")

    def _collect_document_info(self, tool_result: Dict[str, Any]) -> None:
        """Collect document info from tool result for complete event"""
        if "metadata" in tool_result and "filename" in tool_result["metadata"] and "tool_type" in tool_result["metadata"]:
            doc_info = {
                "filename": tool_result["metadata"]["filename"],
                "tool_type": tool_result["metadata"]["tool_type"]
            }
            # Include user_id and session_id if available (needed for S3 path reconstruction)
            if "user_id" in tool_result["metadata"]:
                doc_info["user_id"] = tool_result["metadata"]["user_id"]
            if "session_id" in tool_result["metadata"]:
                doc_info["session_id"] = tool_result["metadata"]["session_id"]
            self.turn_documents.append(doc_info)

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
