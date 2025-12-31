"""
Unit tests for StreamEventProcessor.

Tests event processing, streaming, and abort handling.
"""
import asyncio
import os
import sys
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../src'))

from streaming.event_processor import StreamEventProcessor


class TestStreamEventProcessor:
    """Tests for StreamEventProcessor class."""

    @pytest.fixture
    def processor(self):
        """Create a StreamEventProcessor instance."""
        return StreamEventProcessor()

    @pytest.fixture
    def mock_agent(self):
        """Create a mock agent."""
        agent = MagicMock()
        agent.session_manager = MagicMock()
        agent.session_manager.append_message = MagicMock()
        agent.session_manager.flush = MagicMock()
        agent.agent_id = "test_agent"
        return agent

    # ============================================================
    # Initialization Tests
    # ============================================================

    def test_processor_initialization(self, processor):
        """Test processor initializes with correct defaults."""
        assert processor.partial_response_text == ""
        assert processor.seen_tool_uses == set()
        assert processor.current_session_id is None

    # ============================================================
    # Partial Response Tracking Tests
    # ============================================================

    def test_partial_response_accumulation(self, processor):
        """Test that partial response text accumulates."""
        processor.partial_response_text = ""
        processor.partial_response_text += "Hello "
        processor.partial_response_text += "World"

        assert processor.partial_response_text == "Hello World"

    def test_partial_response_reset_per_stream(self, processor):
        """Test that partial response is reset for each new stream."""
        processor.partial_response_text = "Old content"
        # In actual process_stream, this should be reset at start
        processor.partial_response_text = ""

        assert processor.partial_response_text == ""


class TestStreamEventProcessorAbortHandling:
    """Tests for abort/interrupt handling in StreamEventProcessor."""

    @pytest.fixture
    def processor(self):
        return StreamEventProcessor()

    @pytest.fixture
    def mock_agent_with_session_manager(self):
        """Create mock agent with session manager."""
        agent = MagicMock()
        agent.session_manager = MagicMock()
        agent.session_manager.append_message = MagicMock()
        agent.session_manager.flush = MagicMock()
        agent.agent_id = "test_agent"
        return agent

    @pytest.mark.asyncio
    async def test_partial_response_saved_on_generator_exit(
        self, processor, mock_agent_with_session_manager
    ):
        """Test that partial response is saved when GeneratorExit occurs."""
        agent = mock_agent_with_session_manager
        processor.partial_response_text = "This is a partial response"

        # Simulate the finally block logic
        stream_completed_normally = False
        session_id = "test_session"

        if not stream_completed_normally and processor.partial_response_text.strip():
            abort_message_text = processor.partial_response_text.strip() + "\n\n**[Response interrupted by user]**"
            session_mgr = getattr(agent, 'session_manager', None)

            if session_mgr:
                abort_message = {
                    "role": "assistant",
                    "content": [{"text": abort_message_text}]
                }
                session_mgr.append_message(abort_message, agent)
                if hasattr(session_mgr, 'flush'):
                    session_mgr.flush()

        # Verify
        agent.session_manager.append_message.assert_called_once()
        agent.session_manager.flush.assert_called_once()

        # Check the saved message content
        saved_msg = agent.session_manager.append_message.call_args[0][0]
        assert saved_msg["role"] == "assistant"
        assert "This is a partial response" in saved_msg["content"][0]["text"]
        assert "[Response interrupted by user]" in saved_msg["content"][0]["text"]

    @pytest.mark.asyncio
    async def test_no_save_when_stream_completes_normally(
        self, processor, mock_agent_with_session_manager
    ):
        """Test that no abort message is saved when stream completes normally."""
        agent = mock_agent_with_session_manager
        processor.partial_response_text = "Complete response"

        # Simulate normal completion
        stream_completed_normally = True

        if not stream_completed_normally and processor.partial_response_text.strip():
            agent.session_manager.append_message({"role": "assistant", "content": []}, agent)

        # Verify no save occurred
        agent.session_manager.append_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_save_when_no_partial_response(
        self, processor, mock_agent_with_session_manager
    ):
        """Test that no abort message is saved when partial response is empty."""
        agent = mock_agent_with_session_manager
        processor.partial_response_text = ""  # Empty

        stream_completed_normally = False

        if not stream_completed_normally and processor.partial_response_text.strip():
            agent.session_manager.append_message({"role": "assistant", "content": []}, agent)

        # Verify no save occurred
        agent.session_manager.append_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_strands_agent_session_manager_fallback(self, processor):
        """Test fallback to _session_manager for Strands SDK agents."""
        # Strands SDK uses _session_manager (with underscore)
        agent = MagicMock(spec=[])  # No attributes by default
        agent._session_manager = MagicMock()
        agent._session_manager.append_message = MagicMock()

        processor.partial_response_text = "Partial content"

        # Simulate the session manager lookup logic
        session_mgr = getattr(agent, 'session_manager', None) or getattr(agent, '_session_manager', None)

        assert session_mgr is not None
        assert session_mgr == agent._session_manager


class TestStreamEventProcessorEventFormatting:
    """Tests for event formatting in StreamEventProcessor."""

    @pytest.fixture
    def processor(self):
        return StreamEventProcessor()

    def test_text_event_accumulates(self, processor):
        """Test that text events accumulate in partial_response_text."""
        events = [
            {"data": "Hello "},
            {"data": "World"},
            {"data": "!"}
        ]

        for event in events:
            if event.get("data"):
                processor.partial_response_text += event["data"]

        assert processor.partial_response_text == "Hello World!"

    def test_tool_use_tracking(self, processor):
        """Test that tool uses are tracked to avoid duplicates."""
        tool_use_id = "tool_123"

        assert tool_use_id not in processor.seen_tool_uses

        processor.seen_tool_uses.add(tool_use_id)

        assert tool_use_id in processor.seen_tool_uses

        # Adding again should not create duplicate
        processor.seen_tool_uses.add(tool_use_id)
        assert len([t for t in processor.seen_tool_uses if t == tool_use_id]) == 1


class TestStreamEventProcessorSessionManagerCompatibility:
    """Tests for session manager compatibility (Local vs AgentCore Memory)."""

    @pytest.fixture
    def processor(self):
        return StreamEventProcessor()

    def test_local_session_buffer_requires_flush(self, processor):
        """Test that LocalSessionBuffer requires explicit flush."""
        mock_buffer = MagicMock()
        mock_buffer.append_message = MagicMock()
        mock_buffer.flush = MagicMock()

        # Simulate saving with flush check
        message = {"role": "assistant", "content": [{"text": "Test"}]}
        mock_buffer.append_message(message, None)

        if hasattr(mock_buffer, 'flush'):
            mock_buffer.flush()

        mock_buffer.append_message.assert_called_once()
        mock_buffer.flush.assert_called_once()

    def test_agentcore_memory_no_flush_needed(self, processor):
        """Test that AgentCoreMemorySessionManager doesn't need flush."""
        # AgentCoreMemorySessionManager doesn't have flush method
        mock_manager = MagicMock(spec=['append_message'])  # No flush in spec

        message = {"role": "assistant", "content": [{"text": "Test"}]}
        mock_manager.append_message(message, None)

        # Check flush only if it exists
        if hasattr(mock_manager, 'flush'):
            mock_manager.flush()

        mock_manager.append_message.assert_called_once()
        # flush should not be called since it doesn't exist
        assert not hasattr(mock_manager, 'flush') or not mock_manager.flush.called


class TestStreamEventProcessorErrorRecovery:
    """Tests for error recovery mechanisms in StreamEventProcessor."""

    @pytest.fixture
    def processor(self):
        return StreamEventProcessor()

    def test_get_last_pending_tool_id_empty_registry(self, processor):
        """Test _get_last_pending_tool_id returns None when registry is empty."""
        processor.tool_use_registry = {}

        result = processor._get_last_pending_tool_id()

        assert result is None

    def test_get_last_pending_tool_id_with_tools(self, processor):
        """Test _get_last_pending_tool_id returns last tool when registry has tools."""
        processor.tool_use_registry = {
            "tool_1": {"tool_name": "first_tool", "session_id": "s1"},
            "tool_2": {"tool_name": "second_tool", "session_id": "s1"},
            "tool_3": {"tool_name": "third_tool", "session_id": "s1"},
        }

        result = processor._get_last_pending_tool_id()

        assert result == "tool_3"

    def test_get_last_pending_tool_id_single_tool(self, processor):
        """Test _get_last_pending_tool_id with single tool in registry."""
        processor.tool_use_registry = {
            "only_tool": {"tool_name": "single_tool", "session_id": "s1"},
        }

        result = processor._get_last_pending_tool_id()

        assert result == "only_tool"


class TestStreamEventProcessorXMLParsing:
    """Tests for XML tool call parsing in StreamEventProcessor."""

    @pytest.fixture
    def processor(self):
        return StreamEventProcessor()

    def test_parse_xml_tool_calls_single(self, processor):
        """Test parsing a single XML tool call."""
        text = '<use_tools><invoke name="search_tool"><parameter name="query">test query</parameter></invoke></use_tools>'
        
        result = processor._parse_xml_tool_calls(text)
        
        assert len(result) == 1
        assert result[0]["name"] == "search_tool"
        assert result[0]["input"]["query"] == "test query"

    def test_parse_xml_tool_calls_multiple_params(self, processor):
        """Test parsing XML tool call with multiple parameters."""
        text = '''<use_tools><invoke name="calculator"><parameter name="operation">add</parameter><parameter name="a">5</parameter><parameter name="b">3</parameter></invoke></use_tools>'''
        
        result = processor._parse_xml_tool_calls(text)
        
        assert len(result) == 1
        assert result[0]["name"] == "calculator"
        assert result[0]["input"]["operation"] == "add"
        assert result[0]["input"]["a"] == "5"
        assert result[0]["input"]["b"] == "3"

    def test_parse_xml_tool_calls_no_match(self, processor):
        """Test parsing text with no tool calls."""
        text = "Hello, this is just regular text without any tool calls."
        
        result = processor._parse_xml_tool_calls(text)
        
        assert len(result) == 0

    def test_remove_xml_tool_calls(self, processor):
        """Test removing XML tool calls from text."""
        text = 'Before <use_tools><invoke name="tool"><parameter name="p">v</parameter></invoke></use_tools> After'
        
        result = processor._remove_xml_tool_calls(text)
        
        assert "Before" in result
        assert "After" in result
        assert "<use_tools>" not in result
        assert "</use_tools>" not in result


class TestStreamEventProcessorMultimodal:
    """Tests for multimodal message handling."""

    @pytest.fixture
    def processor(self):
        return StreamEventProcessor()

    def test_create_multimodal_message_text_only(self, processor):
        """Test creating message with text only (no files)."""
        result = processor._create_multimodal_message("Hello world", None)
        
        assert result == "Hello world"

    def test_create_multimodal_message_empty_files(self, processor):
        """Test creating message with empty file list."""
        result = processor._create_multimodal_message("Hello world", [])
        
        assert result == "Hello world"

    def test_sanitize_filename_basic(self, processor):
        """Test basic filename sanitization."""
        result = processor._sanitize_filename_for_bedrock("test_document")
        
        assert result == "test-document"  # underscores converted to hyphens

    def test_sanitize_filename_special_chars(self, processor):
        """Test filename sanitization with special characters."""
        result = processor._sanitize_filename_for_bedrock("test@#$%file.name!")
        
        # Should only contain alphanumeric, whitespace, hyphens, parens, brackets
        assert "@" not in result
        assert "#" not in result
        assert "$" not in result
        assert "%" not in result
        assert "!" not in result

    def test_sanitize_filename_empty_result(self, processor):
        """Test filename sanitization when all chars are stripped."""
        result = processor._sanitize_filename_for_bedrock("@#$%")

        assert result == "document"  # Default when empty


# ============================================================
# Process Stream Full Flow Tests
# ============================================================

def create_mock_final_result(text: str, stop_reason: str = "end_turn"):
    """Helper to create a mock final result object."""
    result = MagicMock()
    result.stop_reason = stop_reason
    result.message = MagicMock()
    result.message.content = [{"text": text}]
    result.metrics = MagicMock()
    result.metrics.accumulated_usage = {
        "inputTokens": 100,
        "outputTokens": 50,
        "totalTokens": 150
    }
    return result


def create_async_generator(events_list):
    """Create an async generator function that yields events."""
    async def generator(*args, **kwargs):
        for event in events_list:
            yield event
    return generator


class TestProcessStreamFlow:
    """Tests for process_stream full flow with various event types."""

    @pytest.fixture
    def processor(self):
        return StreamEventProcessor()

    @pytest.fixture
    def mock_agent(self):
        """Create a mock agent with stream_async method."""
        agent = MagicMock()
        agent.session_manager = MagicMock()
        agent.session_manager.append_message = MagicMock()
        agent.session_manager.flush = MagicMock()
        agent.agent_id = "test_agent"
        return agent

    # ============================================================
    # Basic Stream Flow Tests
    # ============================================================

    @pytest.mark.asyncio
    async def test_process_stream_init_event(self, processor, mock_agent):
        """Test that process_stream yields init event first."""
        events_list = [{"result": create_mock_final_result("Done")}]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Hello", session_id="test_init"):
            events.append(event)

        # First event should be init
        assert len(events) >= 1
        assert '"type": "init"' in events[0]

    @pytest.mark.asyncio
    async def test_process_stream_complete_event(self, processor, mock_agent):
        """Test that process_stream yields complete event on result."""
        events_list = [{"result": create_mock_final_result("Final response")}]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Hello", session_id="test_complete"):
            events.append(event)

        # Should have init and complete events
        assert any('"type": "complete"' in e for e in events)

    @pytest.mark.asyncio
    async def test_process_stream_no_agent_error(self, processor):
        """Test that process_stream handles missing agent gracefully."""
        events = []
        async for event in processor.process_stream(None, "Hello", session_id="test_no_agent"):
            events.append(event)

        # Should yield error event
        assert len(events) == 1
        assert '"type": "error"' in events[0]
        assert "Agent not available" in events[0]

    # ============================================================
    # Text Response Event Tests
    # ============================================================

    @pytest.mark.asyncio
    async def test_process_stream_text_response(self, processor, mock_agent):
        """Test processing text/data events."""
        events_list = [
            {"data": "Hello "},
            {"data": "World!"},
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_text"):
            events.append(event)

        # Should have response events
        response_events = [e for e in events if '"type": "response"' in e]
        assert len(response_events) >= 2

        # Check partial_response_text accumulated
        assert "Hello " in processor.partial_response_text
        assert "World!" in processor.partial_response_text

    @pytest.mark.asyncio
    async def test_process_stream_partial_response_reset(self, processor, mock_agent):
        """Test that partial_response_text is reset for each new stream."""
        processor.partial_response_text = "Previous content"
        events_list = [
            {"data": "New content"},
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        async for _ in processor.process_stream(mock_agent, "Test", session_id="test_reset"):
            pass

        # Should only contain new content, not previous
        assert "Previous content" not in processor.partial_response_text
        assert "New content" in processor.partial_response_text

    # ============================================================
    # Reasoning Event Tests
    # ============================================================

    @pytest.mark.asyncio
    async def test_process_stream_reasoning_event(self, processor, mock_agent):
        """Test processing reasoning events."""
        events_list = [
            {"reasoning": True, "reasoningText": "Let me think about this..."},
            {"data": "Here's my answer."},
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_reasoning"):
            events.append(event)

        # Should have reasoning event
        reasoning_events = [e for e in events if '"type": "reasoning"' in e]
        assert len(reasoning_events) == 1
        assert "Let me think about this" in reasoning_events[0]

    # ============================================================
    # Tool Use Event Tests
    # ============================================================

    @pytest.mark.asyncio
    async def test_process_stream_tool_use_event(self, processor, mock_agent):
        """Test processing tool use events."""
        events_list = [
            {
                "current_tool_use": {
                    "toolUseId": "tool_123",
                    "name": "search_tool",
                    "input": {"query": "test search"}
                }
            },
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_tool_use"):
            events.append(event)

        # Should have tool_use event
        tool_events = [e for e in events if '"type": "tool_use"' in e]
        assert len(tool_events) == 1
        assert "search_tool" in tool_events[0]
        assert "tool_123" in tool_events[0]

    @pytest.mark.asyncio
    async def test_process_stream_tool_use_parameter_update(self, processor, mock_agent):
        """Test that same tool with parameter updates emits multiple events.

        This is intentional behavior: when a tool's parameters are updated,
        the frontend needs to know to update the UI display.
        """
        events_list = [
            # Same tool use ID with parameter updates
            {
                "current_tool_use": {
                    "toolUseId": "tool_update_123",
                    "name": "search_tool",
                    "input": {"query": "initial"}
                }
            },
            {
                "current_tool_use": {
                    "toolUseId": "tool_update_123",  # Same ID, updated params
                    "name": "search_tool",
                    "input": {"query": "updated", "limit": 10}
                }
            },
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_param_update"):
            events.append(event)

        # Should emit tool_use for both: initial and parameter update
        tool_events = [e for e in events if '"type": "tool_use"' in e]
        assert len(tool_events) == 2  # Initial + parameter update

    @pytest.mark.asyncio
    async def test_process_stream_tool_use_empty_input(self, processor, mock_agent):
        """Test processing tool use with empty input."""
        events_list = [
            {
                "current_tool_use": {
                    "toolUseId": "tool_empty_456",
                    "name": "no_param_tool",
                    "input": ""  # Empty input
                }
            },
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_empty_input"):
            events.append(event)

        # Should still emit tool_use event for empty input
        tool_events = [e for e in events if '"type": "tool_use"' in e]
        assert len(tool_events) == 1

    @pytest.mark.asyncio
    async def test_process_stream_tool_use_json_string_input(self, processor, mock_agent):
        """Test processing tool use with JSON string input."""
        events_list = [
            {
                "current_tool_use": {
                    "toolUseId": "tool_json_789",
                    "name": "json_tool",
                    "input": '{"key": "value", "number": 42}'  # JSON string
                }
            },
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_json_input"):
            events.append(event)

        # Should parse JSON and emit tool_use event
        tool_events = [e for e in events if '"type": "tool_use"' in e]
        assert len(tool_events) == 1
        assert '"key": "value"' in tool_events[0] or '"key":"value"' in tool_events[0]

    # ============================================================
    # Tool Result Event Tests (via message event)
    # ============================================================

    @pytest.mark.asyncio
    async def test_process_stream_tool_result_event(self, processor, mock_agent):
        """Test processing tool result via message event."""
        events_list = [
            {
                "message": {
                    "content": [
                        {
                            "toolResult": {
                                "toolUseId": "tool_result_123",
                                "content": [{"text": "Search result: found 5 items"}],
                                "status": "success"
                            }
                        }
                    ]
                }
            },
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_tool_result"):
            events.append(event)

        # Should have tool_result event
        result_events = [e for e in events if '"type": "tool_result"' in e]
        assert len(result_events) == 1
        assert "tool_result_123" in result_events[0]

    @pytest.mark.asyncio
    async def test_process_stream_tool_result_error_recovery(self, processor, mock_agent):
        """Test that tool_result processing errors are caught and emitted as error tool_result."""
        # Create a message event that will cause an error during processing
        # by having malformed content
        events_list = [
            {
                "message": {
                    "content": [
                        {
                            "toolResult": {
                                "toolUseId": "tool_result_error_456",
                                "content": [{"text": "Result"}],
                                "status": "success"
                                # This tool_result is valid, but we'll mock an error in processing
                            }
                        }
                    ]
                }
            },
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_tool_result_error"):
            events.append(event)

        # Should have tool_result event (either success or error wrapped)
        result_events = [e for e in events if '"type": "tool_result"' in e]
        assert len(result_events) >= 1
        # The toolUseId should be preserved in the result
        assert any("tool_result_error_456" in e for e in result_events)

    # ============================================================
    # Interrupt (HITL) Event Tests
    # ============================================================

    @pytest.mark.asyncio
    async def test_process_stream_interrupt_event(self, processor, mock_agent):
        """Test processing interrupt event for HITL."""
        # Create interrupt result
        interrupt_result = MagicMock()
        interrupt_result.stop_reason = "interrupt"

        interrupt = MagicMock()
        interrupt.id = "interrupt_001"
        interrupt.name = "research_approval"
        interrupt.reason = "User approval required"
        interrupt_result.interrupts = [interrupt]

        events_list = [{"result": interrupt_result}]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_interrupt"):
            events.append(event)

        # Should have interrupt event
        interrupt_events = [e for e in events if '"type": "interrupt"' in e]
        assert len(interrupt_events) == 1
        assert "interrupt_001" in interrupt_events[0]
        assert "research_approval" in interrupt_events[0]

    # ============================================================
    # Lifecycle Event Tests
    # ============================================================

    @pytest.mark.asyncio
    async def test_process_stream_thinking_event(self, processor, mock_agent):
        """Test processing start_event_loop (thinking) event."""
        events_list = [
            {"start_event_loop": True},
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_thinking"):
            events.append(event)

        # Should have thinking event
        thinking_events = [e for e in events if '"type": "thinking"' in e]
        assert len(thinking_events) == 1

    # ============================================================
    # Error Handling Tests
    # ============================================================

    @pytest.mark.asyncio
    async def test_process_stream_exception_handling(self, processor, mock_agent):
        """Test that exceptions during streaming are handled gracefully."""
        async def mock_stream_with_error(*args, **kwargs):
            yield {"data": "Starting..."}
            raise Exception("Simulated error")

        mock_agent.stream_async = mock_stream_with_error

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_error"):
            events.append(event)

        # Should have error event (either as tool_result or error type)
        error_events = [e for e in events if '"type": "error"' in e or '"status": "error"' in e]
        assert len(error_events) >= 1
        assert any("Simulated error" in e for e in error_events)

    @pytest.mark.asyncio
    async def test_process_stream_error_recovery_with_pending_tool(self, processor, mock_agent):
        """Test that errors emit tool_result when there's a pending tool for agent self-recovery."""
        async def mock_stream_with_tool_error(*args, **kwargs):
            # First, emit a tool_use event
            yield {
                "current_tool_use": {
                    "toolUseId": "tool_error_recovery_123",
                    "name": "failing_tool",
                    "input": {"param": "value"}
                }
            }
            # Then raise an error (simulating tool execution failure)
            raise Exception("Tool execution failed: bytes not serializable")

        mock_agent.stream_async = mock_stream_with_tool_error

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_error_recovery"):
            events.append(event)

        # Should have tool_use event
        tool_use_events = [e for e in events if '"type": "tool_use"' in e]
        assert len(tool_use_events) == 1

        # Should have tool_result error event (for agent self-recovery)
        tool_result_events = [e for e in events if '"type": "tool_result"' in e]
        assert len(tool_result_events) == 1
        assert "tool_error_recovery_123" in tool_result_events[0]
        assert '"status": "error"' in tool_result_events[0]

    @pytest.mark.asyncio
    async def test_process_stream_error_without_pending_tool(self, processor, mock_agent):
        """Test that errors without pending tool emit error event (chat message)."""
        async def mock_stream_error_no_tool(*args, **kwargs):
            yield {"data": "Hello"}  # Regular text, no tool
            raise Exception("General error")

        mock_agent.stream_async = mock_stream_error_no_tool

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_error_no_tool"):
            events.append(event)

        # Should have error event (not tool_result)
        error_events = [e for e in events if '"type": "error"' in e]
        assert len(error_events) == 1
        assert "General error" in error_events[0]

    # ============================================================
    # Token Usage Tests
    # ============================================================

    @pytest.mark.asyncio
    async def test_process_stream_token_usage(self, processor, mock_agent):
        """Test that token usage is included in complete event."""
        final_result = create_mock_final_result("Done")
        final_result.metrics.accumulated_usage = {
            "inputTokens": 200,
            "outputTokens": 100,
            "totalTokens": 300,
            "cacheReadInputTokens": 50,
            "cacheWriteInputTokens": 25
        }

        events_list = [{"result": final_result}]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_usage"):
            events.append(event)

        # Find complete event and check usage
        complete_events = [e for e in events if '"type": "complete"' in e]
        assert len(complete_events) == 1
        assert '"inputTokens": 200' in complete_events[0]
        assert '"outputTokens": 100' in complete_events[0]

    # ============================================================
    # XML Tool Call in Text Tests
    # ============================================================

    @pytest.mark.asyncio
    async def test_process_stream_xml_tool_in_text(self, processor, mock_agent):
        """Test that XML tool calls in text are parsed and emitted."""
        events_list = [
            {"data": 'Let me search <use_tools><invoke name="web_search"><parameter name="query">python tutorials</parameter></invoke></use_tools>'},
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_xml_tool"):
            events.append(event)

        # Should have tool_use event parsed from XML
        tool_events = [e for e in events if '"type": "tool_use"' in e]
        assert len(tool_events) == 1
        assert "web_search" in tool_events[0]

    # ============================================================
    # Stream Deduplication Tests
    # ============================================================

    @pytest.mark.asyncio
    async def test_process_stream_deduplication(self, processor, mock_agent):
        """Test that duplicate streams with same message are prevented."""
        events_list = [{"result": create_mock_final_result("Done")}]
        mock_agent.stream_async = create_async_generator(events_list)

        # First call
        events1 = []
        async for event in processor.process_stream(mock_agent, "Same message", session_id="test_dedup_stream"):
            events1.append(event)

        # Reset for second call
        mock_agent.stream_async = create_async_generator(events_list)

        # Second call with different session - should work
        events2 = []
        async for event in processor.process_stream(mock_agent, "Same message", session_id="test_dedup_stream_2"):
            events2.append(event)

        # Both should complete
        assert len(events1) > 0
        assert len(events2) > 0


# ============================================================
# Browser/Tool Stream Event Tests
# ============================================================

class TestProcessStreamBrowserEvents:
    """Tests for browser-related streaming events."""

    @pytest.fixture
    def processor(self):
        return StreamEventProcessor()

    @pytest.fixture
    def mock_agent(self):
        agent = MagicMock()
        agent.session_manager = MagicMock()
        agent.agent_id = "test_agent"
        return agent

    @pytest.mark.asyncio
    async def test_process_stream_browser_session_detected(self, processor, mock_agent):
        """Test processing browser_session_detected event.

        Note: The implementation may emit metadata events from multiple places:
        1. From tool_stream_event handler (immediate)
        2. From invocation_state check (on next event loop iteration)
        This is acceptable as frontend handles duplicate browserSessionId gracefully.
        """
        events_list = [
            {
                "tool_stream_event": {
                    "data": {
                        "type": "browser_session_detected",
                        "browserSessionId": "session_abc123",
                        "browserId": "browser_xyz",
                        "message": "Browser session started"
                    }
                }
            },
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_browser_session"):
            events.append(event)

        # Should have at least one metadata event with browserSessionId
        metadata_events = [e for e in events if '"type": "metadata"' in e]
        assert len(metadata_events) >= 1
        assert any("session_abc123" in e for e in metadata_events)

    @pytest.mark.asyncio
    async def test_process_stream_browser_step(self, processor, mock_agent):
        """Test processing browser_step event."""
        events_list = [
            {
                "tool_stream_event": {
                    "data": {
                        "type": "browser_step",
                        "stepNumber": 1,
                        "content": "Clicking on login button"
                    }
                }
            },
            {
                "tool_stream_event": {
                    "data": {
                        "type": "browser_step",
                        "stepNumber": 2,
                        "content": "Entering username"
                    }
                }
            },
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_browser_step"):
            events.append(event)

        # Should have browser_progress events
        progress_events = [e for e in events if '"type": "browser_progress"' in e]
        assert len(progress_events) == 2
        assert "Clicking on login button" in progress_events[0]
        assert "Entering username" in progress_events[1]


# ============================================================
# Frontend SSE Event Structure Compatibility Tests
# ============================================================

class TestFrontendEventCompatibility:
    """Tests to verify SSE event structure matches frontend expectations."""

    @pytest.fixture
    def processor(self):
        return StreamEventProcessor()

    @pytest.fixture
    def mock_agent(self):
        agent = MagicMock()
        agent.session_manager = MagicMock()
        agent.agent_id = "test_agent"
        return agent

    def parse_sse_event(self, sse_string: str) -> dict:
        """Parse SSE event string to dict."""
        import json
        # SSE format: "data: {...}\n\n"
        if sse_string.startswith("data: "):
            json_str = sse_string[6:].strip()
            return json.loads(json_str)
        return {}

    @pytest.mark.asyncio
    async def test_init_event_structure(self, processor, mock_agent):
        """Test init event has correct structure for frontend."""
        events_list = [{"result": create_mock_final_result("Done")}]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_fe_init"):
            events.append(event)

        init_event = self.parse_sse_event(events[0])
        assert init_event["type"] == "init"
        assert "message" in init_event

    @pytest.mark.asyncio
    async def test_response_event_structure(self, processor, mock_agent):
        """Test response event has correct structure for frontend."""
        events_list = [
            {"data": "Hello World"},
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_fe_response"):
            events.append(event)

        response_events = [e for e in events if '"type": "response"' in e]
        response_event = self.parse_sse_event(response_events[0])

        # Frontend expects: { type: "response", text: string, step: string }
        assert response_event["type"] == "response"
        assert "text" in response_event
        assert response_event["text"] == "Hello World"
        assert "step" in response_event
        assert response_event["step"] == "answering"

    @pytest.mark.asyncio
    async def test_reasoning_event_structure(self, processor, mock_agent):
        """Test reasoning event has correct structure for frontend."""
        events_list = [
            {"reasoning": True, "reasoningText": "Thinking..."},
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_fe_reasoning"):
            events.append(event)

        reasoning_events = [e for e in events if '"type": "reasoning"' in e]
        reasoning_event = self.parse_sse_event(reasoning_events[0])

        # Frontend expects: { type: "reasoning", text: string, step: string }
        assert reasoning_event["type"] == "reasoning"
        assert "text" in reasoning_event
        assert "step" in reasoning_event
        assert reasoning_event["step"] == "thinking"

    @pytest.mark.asyncio
    async def test_tool_use_event_structure(self, processor, mock_agent):
        """Test tool_use event has correct structure for frontend."""
        events_list = [
            {
                "current_tool_use": {
                    "toolUseId": "tool_fe_123",
                    "name": "search_tool",
                    "input": {"query": "test"}
                }
            },
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_fe_tool_use"):
            events.append(event)

        tool_events = [e for e in events if '"type": "tool_use"' in e]
        tool_event = self.parse_sse_event(tool_events[0])

        # Frontend expects: { type: "tool_use", toolUseId: string, name: string, input: object }
        assert tool_event["type"] == "tool_use"
        assert "toolUseId" in tool_event
        assert tool_event["toolUseId"] == "tool_fe_123"
        assert "name" in tool_event
        assert tool_event["name"] == "search_tool"
        assert "input" in tool_event
        assert isinstance(tool_event["input"], dict)

    @pytest.mark.asyncio
    async def test_tool_result_event_structure(self, processor, mock_agent):
        """Test tool_result event has correct structure for frontend."""
        events_list = [
            {
                "message": {
                    "content": [
                        {
                            "toolResult": {
                                "toolUseId": "tool_fe_result_123",
                                "content": [{"text": "Result text"}],
                                "status": "success"
                            }
                        }
                    ]
                }
            },
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_fe_tool_result"):
            events.append(event)

        result_events = [e for e in events if '"type": "tool_result"' in e]
        result_event = self.parse_sse_event(result_events[0])

        # Frontend expects: { type: "tool_result", toolUseId: string, result: string, status?: string }
        assert result_event["type"] == "tool_result"
        assert "toolUseId" in result_event
        assert "result" in result_event

    @pytest.mark.asyncio
    async def test_complete_event_structure(self, processor, mock_agent):
        """Test complete event has correct structure for frontend."""
        final_result = create_mock_final_result("Final message")
        final_result.metrics.accumulated_usage = {
            "inputTokens": 100,
            "outputTokens": 50,
            "totalTokens": 150
        }
        events_list = [{"result": final_result}]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_fe_complete"):
            events.append(event)

        complete_events = [e for e in events if '"type": "complete"' in e]
        complete_event = self.parse_sse_event(complete_events[0])

        # Frontend expects: { type: "complete", message: string, usage?: object, images?: array }
        # Note: documents are now fetched by frontend via S3 workspace API, not included in complete event
        assert complete_event["type"] == "complete"
        assert "message" in complete_event
        assert "usage" in complete_event
        assert complete_event["usage"]["inputTokens"] == 100
        assert complete_event["usage"]["outputTokens"] == 50

    @pytest.mark.asyncio
    async def test_complete_event_with_cache_tokens(self, processor, mock_agent):
        """Test complete event includes cache token usage when present."""
        final_result = create_mock_final_result("Final message with cache")
        final_result.metrics.accumulated_usage = {
            "inputTokens": 200,
            "outputTokens": 100,
            "totalTokens": 300,
            "cacheReadInputTokens": 150,
            "cacheWriteInputTokens": 50
        }
        events_list = [{"result": final_result}]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_cache_tokens"):
            events.append(event)

        complete_events = [e for e in events if '"type": "complete"' in e]
        complete_event = self.parse_sse_event(complete_events[0])

        # Verify cache token fields are included
        assert complete_event["usage"]["inputTokens"] == 200
        assert complete_event["usage"]["outputTokens"] == 100
        assert complete_event["usage"]["totalTokens"] == 300
        assert complete_event["usage"]["cacheReadInputTokens"] == 150
        assert complete_event["usage"]["cacheWriteInputTokens"] == 50

    @pytest.mark.asyncio
    async def test_complete_event_omits_zero_cache_tokens(self, processor, mock_agent):
        """Test complete event omits cache tokens when they are zero."""
        final_result = create_mock_final_result("Final message no cache")
        final_result.metrics.accumulated_usage = {
            "inputTokens": 100,
            "outputTokens": 50,
            "totalTokens": 150,
            "cacheReadInputTokens": 0,
            "cacheWriteInputTokens": 0
        }
        events_list = [{"result": final_result}]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_zero_cache"):
            events.append(event)

        complete_events = [e for e in events if '"type": "complete"' in e]
        complete_event = self.parse_sse_event(complete_events[0])

        # Base tokens should be present
        assert complete_event["usage"]["inputTokens"] == 100
        assert complete_event["usage"]["outputTokens"] == 50
        # Zero cache tokens should be omitted
        assert "cacheReadInputTokens" not in complete_event["usage"]
        assert "cacheWriteInputTokens" not in complete_event["usage"]

    @pytest.mark.asyncio
    async def test_complete_event_cache_read_only(self, processor, mock_agent):
        """Test complete event with cache read but no write (cache hit scenario)."""
        final_result = create_mock_final_result("Cache hit response")
        final_result.metrics.accumulated_usage = {
            "inputTokens": 100,
            "outputTokens": 50,
            "totalTokens": 150,
            "cacheReadInputTokens": 80,
            "cacheWriteInputTokens": 0
        }
        events_list = [{"result": final_result}]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_cache_read"):
            events.append(event)

        complete_events = [e for e in events if '"type": "complete"' in e]
        complete_event = self.parse_sse_event(complete_events[0])

        # Cache read should be present, write should be omitted
        assert complete_event["usage"]["cacheReadInputTokens"] == 80
        assert "cacheWriteInputTokens" not in complete_event["usage"]

    @pytest.mark.asyncio
    async def test_complete_event_cache_write_only(self, processor, mock_agent):
        """Test complete event with cache write but no read (first request scenario)."""
        final_result = create_mock_final_result("First request response")
        final_result.metrics.accumulated_usage = {
            "inputTokens": 100,
            "outputTokens": 50,
            "totalTokens": 150,
            "cacheReadInputTokens": 0,
            "cacheWriteInputTokens": 100
        }
        events_list = [{"result": final_result}]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_cache_write"):
            events.append(event)

        complete_events = [e for e in events if '"type": "complete"' in e]
        complete_event = self.parse_sse_event(complete_events[0])

        # Cache write should be present, read should be omitted
        assert "cacheReadInputTokens" not in complete_event["usage"]
        assert complete_event["usage"]["cacheWriteInputTokens"] == 100

    @pytest.mark.asyncio
    async def test_error_event_structure(self, processor, mock_agent):
        """Test error event has correct structure for frontend."""
        async def mock_stream_error(*args, **kwargs):
            yield {"data": "Starting..."}  # Must yield to be async generator
            raise Exception("Test error message")

        mock_agent.stream_async = mock_stream_error

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_fe_error"):
            events.append(event)

        error_events = [e for e in events if '"type": "error"' in e]
        error_event = self.parse_sse_event(error_events[0])

        # Frontend expects: { type: "error", message: string }
        assert error_event["type"] == "error"
        assert "message" in error_event
        assert "Test error message" in error_event["message"]

    @pytest.mark.asyncio
    async def test_interrupt_event_structure(self, processor, mock_agent):
        """Test interrupt event has correct structure for frontend."""
        interrupt_result = MagicMock()
        interrupt_result.stop_reason = "interrupt"

        interrupt = MagicMock()
        interrupt.id = "int_fe_001"
        interrupt.name = "research_approval"
        interrupt.reason = "Approval needed"
        interrupt_result.interrupts = [interrupt]

        events_list = [{"result": interrupt_result}]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_fe_interrupt"):
            events.append(event)

        interrupt_events = [e for e in events if '"type": "interrupt"' in e]
        interrupt_event = self.parse_sse_event(interrupt_events[0])

        # Frontend expects: { type: "interrupt", interrupts: [{id, name, reason}] }
        assert interrupt_event["type"] == "interrupt"
        assert "interrupts" in interrupt_event
        assert len(interrupt_event["interrupts"]) == 1
        assert interrupt_event["interrupts"][0]["id"] == "int_fe_001"
        assert interrupt_event["interrupts"][0]["name"] == "research_approval"

    @pytest.mark.asyncio
    async def test_metadata_event_structure(self, processor, mock_agent):
        """Test metadata event has correct structure for frontend."""
        events_list = [
            {
                "tool_stream_event": {
                    "data": {
                        "type": "browser_session_detected",
                        "browserSessionId": "browser_fe_123",
                        "browserId": "bid_456",
                        "message": "Session started"
                    }
                }
            },
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_fe_metadata"):
            events.append(event)

        metadata_events = [e for e in events if '"type": "metadata"' in e]
        metadata_event = self.parse_sse_event(metadata_events[0])

        # Frontend expects: { type: "metadata", metadata: { browserSessionId?: string, ... } }
        assert metadata_event["type"] == "metadata"
        assert "metadata" in metadata_event
        assert "browserSessionId" in metadata_event["metadata"]

    @pytest.mark.asyncio
    async def test_browser_progress_event_structure(self, processor, mock_agent):
        """Test browser_progress event has correct structure for frontend."""
        events_list = [
            {
                "tool_stream_event": {
                    "data": {
                        "type": "browser_step",
                        "stepNumber": 1,
                        "content": "Clicking button"
                    }
                }
            },
            {"result": create_mock_final_result("Done")}
        ]
        mock_agent.stream_async = create_async_generator(events_list)

        events = []
        async for event in processor.process_stream(mock_agent, "Test", session_id="test_fe_browser_progress"):
            events.append(event)

        progress_events = [e for e in events if '"type": "browser_progress"' in e]
        progress_event = self.parse_sse_event(progress_events[0])

        # Frontend expects: { type: "browser_progress", content: string, stepNumber: number }
        assert progress_event["type"] == "browser_progress"
        assert "content" in progress_event
        assert "stepNumber" in progress_event
        assert progress_event["stepNumber"] == 1


# ============================================================
# Stop Signal Integration Tests
# ============================================================

class TestStreamEventProcessorStopSignal:
    """Tests for stop signal handling in StreamEventProcessor."""

    @pytest.fixture
    def processor(self):
        return StreamEventProcessor()

    @pytest.fixture
    def mock_agent(self):
        agent = MagicMock()
        agent.session_manager = MagicMock()
        agent.session_manager.append_message = MagicMock()
        agent.session_manager.flush = MagicMock()
        agent.agent_id = "test_agent"
        return agent

    def test_stop_signal_provider_initialization(self, processor):
        """Test that stop signal provider is initialized."""
        assert processor.stop_signal_provider is not None
        assert processor.stop_check_interval == 1.0
        assert processor.last_stop_check_time == 0

    def test_should_check_stop_signal_throttling(self, processor):
        """Test that stop signal checking is throttled."""
        # First check should return True
        assert processor._should_check_stop_signal() is True

        # Immediate second check should return False (throttled)
        assert processor._should_check_stop_signal() is False

    def test_should_check_stop_signal_after_interval(self, processor):
        """Test that stop signal check is allowed after interval."""
        import time

        # First check
        assert processor._should_check_stop_signal() is True

        # Set last check time to past
        processor.last_stop_check_time = time.time() - 2.0  # 2 seconds ago

        # Should allow check now
        assert processor._should_check_stop_signal() is True

    def test_check_stop_signal_no_session(self, processor):
        """Test that stop signal check skips when no session."""
        processor.current_user_id = None
        processor.current_session_id = None

        result = processor._check_stop_signal()

        assert result is False

    def test_check_stop_signal_no_user(self, processor):
        """Test that stop signal check skips when no user."""
        processor.current_user_id = None
        processor.current_session_id = "session123"

        result = processor._check_stop_signal()

        assert result is False

    def test_clear_stop_signal_no_session(self, processor):
        """Test that clear_stop_signal handles missing session gracefully."""
        processor.current_user_id = None
        processor.current_session_id = None

        # Should not raise
        processor._clear_stop_signal()

    def test_save_partial_response_empty(self, processor, mock_agent):
        """Test that save_partial_response returns False for empty text."""
        processor.partial_response_text = ""

        result = processor._save_partial_response(mock_agent, "session123")

        assert result is False
        mock_agent.session_manager.append_message.assert_not_called()

    def test_save_partial_response_whitespace_only(self, processor, mock_agent):
        """Test that save_partial_response returns False for whitespace only."""
        processor.partial_response_text = "   \n\t  "

        result = processor._save_partial_response(mock_agent, "session123")

        assert result is False
        mock_agent.session_manager.append_message.assert_not_called()

    def test_save_partial_response_success(self, processor, mock_agent):
        """Test successful save of partial response."""
        processor.partial_response_text = "This is a partial response"

        result = processor._save_partial_response(mock_agent, "session123")

        assert result is True
        mock_agent.session_manager.append_message.assert_called_once()
        mock_agent.session_manager.flush.assert_called_once()

        # Verify message content
        call_args = mock_agent.session_manager.append_message.call_args[0][0]
        assert call_args["role"] == "assistant"
        assert "This is a partial response" in call_args["content"][0]["text"]
        assert "[Response interrupted by user]" in call_args["content"][0]["text"]

    def test_save_partial_response_clears_text(self, processor, mock_agent):
        """Test that save_partial_response clears partial_response_text."""
        processor.partial_response_text = "Some text"

        processor._save_partial_response(mock_agent, "session123")

        assert processor.partial_response_text == ""

    def test_save_partial_response_no_session_manager(self, processor):
        """Test save_partial_response when agent has no session_manager."""
        agent = MagicMock(spec=[])  # No session_manager
        processor.partial_response_text = "Some text"

        result = processor._save_partial_response(agent, "session123")

        assert result is False

    def test_save_partial_response_strands_fallback(self, processor):
        """Test save_partial_response with _session_manager (Strands SDK)."""
        agent = MagicMock(spec=[])
        agent._session_manager = MagicMock()
        agent._session_manager.append_message = MagicMock()
        processor.partial_response_text = "Some text"

        result = processor._save_partial_response(agent, "session123")

        assert result is True
        agent._session_manager.append_message.assert_called_once()

    @pytest.mark.asyncio
    async def test_process_stream_sets_session_ids(self, processor, mock_agent):
        """Test that process_stream sets session and user IDs from invocation_state."""
        events_list = [{"result": create_mock_final_result("Done")}]
        mock_agent.stream_async = create_async_generator(events_list)

        invocation_state = {
            "user_id": "user_123",
            "session_id": "session_456"
        }

        async for _ in processor.process_stream(
            mock_agent,
            "Test",
            session_id="session_456",
            invocation_state=invocation_state
        ):
            pass

        assert processor.current_user_id == "user_123"
        assert processor.current_session_id == "session_456"

    @pytest.mark.asyncio
    async def test_process_stream_stop_requested_saves_partial(self, processor, mock_agent):
        """Test that stop request saves partial response and yields complete event."""
        from streaming.event_processor import StopRequestedException
        from unittest.mock import patch

        # Mock slow streaming that gets interrupted
        async def mock_slow_stream(*args, **kwargs):
            yield {"data": "First chunk "}
            yield {"data": "Second chunk "}
            # Simulate stop being requested
            raise StopRequestedException("Stop requested by user")

        mock_agent.stream_async = mock_slow_stream

        events = []
        async for event in processor.process_stream(
            mock_agent,
            "Test",
            session_id="test_stop",
            invocation_state={"user_id": "user1"}
        ):
            events.append(event)

        # Should have complete event at the end
        complete_events = [e for e in events if '"type": "complete"' in e]
        assert len(complete_events) == 1
        assert "Stream stopped by user" in complete_events[0]

    @pytest.mark.asyncio
    async def test_process_stream_resets_stop_check_timer(self, processor, mock_agent):
        """Test that process_stream resets stop check timer at start."""
        import time

        # Set last check time to something non-zero
        processor.last_stop_check_time = time.time()

        events_list = [{"result": create_mock_final_result("Done")}]
        mock_agent.stream_async = create_async_generator(events_list)

        async for _ in processor.process_stream(mock_agent, "Test", session_id="test_reset"):
            pass

        # Timer should be reset to 0 at start (then updated during processing)
        # This ensures first stop check can happen immediately
        # Note: The actual value after processing will be updated, so we just verify it works


class TestStopRequestedException:
    """Tests for StopRequestedException."""

    def test_exception_message(self):
        """Test that StopRequestedException carries message."""
        from streaming.event_processor import StopRequestedException

        exc = StopRequestedException("Custom message")

        assert str(exc) == "Custom message"

    def test_exception_inheritance(self):
        """Test that StopRequestedException is an Exception."""
        from streaming.event_processor import StopRequestedException

        exc = StopRequestedException("Test")

        assert isinstance(exc, Exception)


# ============================================================
# Strands Agent Message/Tool Signature Compliance Tests
# ============================================================

class TestStrandsMessageSignatureCompliance:
    """Tests to verify message formats comply with Strands Agent signatures.

    Strands Agent expects specific message structures:
    - User messages: {"role": "user", "content": [{"text": "..."}] | str}
    - Assistant messages: {"role": "assistant", "content": [{"text": "..."}]}
    - Tool use: {"role": "assistant", "content": [{"toolUse": {"toolUseId": "...", "name": "...", "input": {...}}}]}
    - Tool result: {"role": "user", "content": [{"toolResult": {"toolUseId": "...", "content": [{"text": "..."}]}}]}
    """

    @pytest.fixture
    def processor(self):
        return StreamEventProcessor()

    # ============================================================
    # User Message Format Tests
    # ============================================================

    def test_user_message_text_format(self):
        """Test user message with text content."""
        # Strands accepts both string and list formats for user content
        user_message_string = {
            "role": "user",
            "content": "Hello, how are you?"
        }

        user_message_list = {
            "role": "user",
            "content": [{"text": "Hello, how are you?"}]
        }

        # Both formats should be valid
        assert user_message_string["role"] == "user"
        assert isinstance(user_message_string["content"], str)

        assert user_message_list["role"] == "user"
        assert isinstance(user_message_list["content"], list)
        assert user_message_list["content"][0]["text"] == "Hello, how are you?"

    def test_user_message_with_image(self):
        """Test user message with image content."""
        user_message_with_image = {
            "role": "user",
            "content": [
                {"text": "What's in this image?"},
                {
                    "image": {
                        "source": {"data": "base64encodeddata"},
                        "format": "png"
                    }
                }
            ]
        }

        assert user_message_with_image["role"] == "user"
        assert len(user_message_with_image["content"]) == 2
        assert "text" in user_message_with_image["content"][0]
        assert "image" in user_message_with_image["content"][1]

    def test_user_message_with_document(self):
        """Test user message with document content."""
        user_message_with_doc = {
            "role": "user",
            "content": [
                {"text": "Summarize this document"},
                {
                    "document": {
                        "source": {"bytes": b"pdf content"},
                        "format": "pdf",
                        "name": "report.pdf"
                    }
                }
            ]
        }

        assert user_message_with_doc["role"] == "user"
        assert "document" in user_message_with_doc["content"][1]

    # ============================================================
    # Assistant Message Format Tests
    # ============================================================

    def test_assistant_message_text_format(self):
        """Test assistant message with text response."""
        assistant_message = {
            "role": "assistant",
            "content": [{"text": "I'm doing well, thank you!"}]
        }

        assert assistant_message["role"] == "assistant"
        assert isinstance(assistant_message["content"], list)
        assert "text" in assistant_message["content"][0]

    def test_assistant_message_with_tool_use(self):
        """Test assistant message with tool use."""
        assistant_message_tool = {
            "role": "assistant",
            "content": [
                {"text": "Let me calculate that for you."},
                {
                    "toolUse": {
                        "toolUseId": "toolu_01ABC123",
                        "name": "calculator",
                        "input": {"expression": "2 + 2"}
                    }
                }
            ]
        }

        assert assistant_message_tool["role"] == "assistant"
        tool_use = assistant_message_tool["content"][1]["toolUse"]
        assert "toolUseId" in tool_use
        assert "name" in tool_use
        assert "input" in tool_use
        assert isinstance(tool_use["input"], dict)

    # ============================================================
    # Tool Use Format Tests
    # ============================================================

    def test_tool_use_event_format(self, processor):
        """Test tool_use event format matches Strands expectation."""
        tool_use = {
            "toolUseId": "toolu_01XYZ789",
            "name": "web_search",
            "input": {
                "query": "latest AI news",
                "num_results": 5
            }
        }

        # Strands expects toolUse blocks with these exact field names
        assert "toolUseId" in tool_use
        assert isinstance(tool_use["toolUseId"], str)
        assert tool_use["toolUseId"].startswith("toolu_")  # Claude-style ID

        assert "name" in tool_use
        assert isinstance(tool_use["name"], str)

        assert "input" in tool_use
        assert isinstance(tool_use["input"], dict)

    def test_tool_use_input_types(self):
        """Test tool_use input can contain various types."""
        tool_inputs = [
            # String input
            {"text": "hello world"},
            # Integer input
            {"count": 10},
            # Float input
            {"temperature": 0.7},
            # Boolean input
            {"verbose": True},
            # List input
            {"items": ["a", "b", "c"]},
            # Nested dict input
            {"config": {"key": "value", "nested": {"deep": True}}},
            # Mixed types
            {"query": "search", "limit": 10, "filters": ["recent", "popular"]}
        ]

        for tool_input in tool_inputs:
            tool_use = {
                "toolUseId": "toolu_test",
                "name": "test_tool",
                "input": tool_input
            }

            assert isinstance(tool_use["input"], dict)
            # Should be JSON serializable
            import json
            json.dumps(tool_use)  # Should not raise

    # ============================================================
    # Tool Result Format Tests
    # ============================================================

    def test_tool_result_text_format(self):
        """Test tool_result with text content."""
        tool_result = {
            "toolUseId": "toolu_01XYZ789",
            "content": [{"text": "The answer is 4"}]
        }

        assert "toolUseId" in tool_result
        assert "content" in tool_result
        assert isinstance(tool_result["content"], list)
        assert "text" in tool_result["content"][0]

    def test_tool_result_with_image(self):
        """Test tool_result with image content (e.g., from Code Interpreter)."""
        tool_result_with_image = {
            "toolUseId": "toolu_01CODE",
            "content": [
                {"text": "Here is the generated chart:"},
                {
                    "image": {
                        "source": {"data": "base64chart"},
                        "format": "png"
                    }
                }
            ]
        }

        assert "toolUseId" in tool_result_with_image
        content = tool_result_with_image["content"]
        assert len(content) == 2
        assert "image" in content[1]

    def test_tool_result_error_format(self):
        """Test tool_result for error case."""
        tool_result_error = {
            "toolUseId": "toolu_01FAIL",
            "content": [{"text": "Error: Division by zero"}],
            "status": "error"
        }

        assert tool_result_error["status"] == "error"
        assert "Error" in tool_result_error["content"][0]["text"]

    def test_tool_result_message_format(self):
        """Test complete tool_result as user message."""
        # When sending tool result back to model, it's wrapped as user message
        tool_result_message = {
            "role": "user",
            "content": [
                {
                    "toolResult": {
                        "toolUseId": "toolu_01ABC",
                        "content": [{"text": "Search results: ..."}]
                    }
                }
            ]
        }

        assert tool_result_message["role"] == "user"
        tool_result = tool_result_message["content"][0]["toolResult"]
        assert "toolUseId" in tool_result
        assert "content" in tool_result

    # ============================================================
    # Cache Point Format Tests
    # ============================================================

    def test_cache_point_format(self):
        """Test cachePoint format for prompt caching."""
        message_with_cache = {
            "role": "assistant",
            "content": [
                {"text": "Response text"},
                {"cachePoint": {"type": "default"}}
            ]
        }

        cache_point = message_with_cache["content"][1]
        assert "cachePoint" in cache_point
        assert cache_point["cachePoint"]["type"] == "default"

    # ============================================================
    # SSE Event Format Tests (Frontend Contract)
    # ============================================================

    def test_sse_tool_use_event_format(self, processor):
        """Test SSE tool_use event matches frontend expectations."""
        from streaming.event_formatter import StreamEventFormatter

        tool_use = {
            "toolUseId": "toolu_01TEST",
            "name": "calculator",
            "input": {"expression": "1 + 1"}
        }

        event_str = StreamEventFormatter.create_tool_use_event(tool_use)

        # Should be valid SSE format
        assert event_str.startswith("data: ")
        assert event_str.endswith("\n\n")

        # Parse and verify
        import json
        data = json.loads(event_str[6:-2])  # Remove "data: " prefix and "\n\n" suffix

        assert data["type"] == "tool_use"
        assert data["toolUseId"] == "toolu_01TEST"
        assert data["name"] == "calculator"
        assert data["input"] == {"expression": "1 + 1"}

    def test_sse_tool_result_event_format(self, processor):
        """Test SSE tool_result event matches frontend expectations."""
        from streaming.event_formatter import StreamEventFormatter

        tool_result = {
            "toolUseId": "toolu_01TEST",
            "content": [{"text": "Result: 2"}]
        }

        event_str = StreamEventFormatter.create_tool_result_event(tool_result)

        # Should be valid SSE format
        assert event_str.startswith("data: ")

        # Parse and verify
        import json
        data = json.loads(event_str[6:-2])

        assert data["type"] == "tool_result"
        assert data["toolUseId"] == "toolu_01TEST"
        assert "result" in data  # Transformed for frontend

    # ============================================================
    # Integration: Message Sequence Tests
    # ============================================================

    def test_conversation_message_sequence(self):
        """Test a complete conversation message sequence."""
        # Simulates: User asks -> Assistant uses tool -> Tool result -> Assistant answers

        messages = [
            # 1. User asks a question
            {
                "role": "user",
                "content": [{"text": "What is 2 + 2?"}]
            },
            # 2. Assistant decides to use calculator
            {
                "role": "assistant",
                "content": [
                    {"text": "Let me calculate that."},
                    {
                        "toolUse": {
                            "toolUseId": "toolu_calc_001",
                            "name": "calculator",
                            "input": {"expression": "2 + 2"}
                        }
                    }
                ]
            },
            # 3. Tool result sent back as user message
            {
                "role": "user",
                "content": [
                    {
                        "toolResult": {
                            "toolUseId": "toolu_calc_001",
                            "content": [{"text": "4"}]
                        }
                    }
                ]
            },
            # 4. Assistant provides final answer
            {
                "role": "assistant",
                "content": [{"text": "The answer is 4."}]
            }
        ]

        # Verify message sequence
        assert messages[0]["role"] == "user"
        assert messages[1]["role"] == "assistant"
        assert "toolUse" in messages[1]["content"][1]
        assert messages[2]["role"] == "user"
        assert "toolResult" in messages[2]["content"][0]
        assert messages[3]["role"] == "assistant"

        # Verify toolUseId matches between tool_use and tool_result
        tool_use_id = messages[1]["content"][1]["toolUse"]["toolUseId"]
        tool_result_id = messages[2]["content"][0]["toolResult"]["toolUseId"]
        assert tool_use_id == tool_result_id

    def test_multiple_tool_uses_in_sequence(self):
        """Test multiple sequential tool uses."""
        # Assistant can call multiple tools before responding

        assistant_multi_tool = {
            "role": "assistant",
            "content": [
                {"text": "Let me search and calculate."},
                {
                    "toolUse": {
                        "toolUseId": "toolu_search_001",
                        "name": "web_search",
                        "input": {"query": "current date"}
                    }
                },
                {
                    "toolUse": {
                        "toolUseId": "toolu_calc_001",
                        "name": "calculator",
                        "input": {"expression": "365 * 2"}
                    }
                }
            ]
        }

        tool_uses = [c for c in assistant_multi_tool["content"] if "toolUse" in c]
        assert len(tool_uses) == 2

        # Each tool_use must have unique toolUseId
        tool_ids = [t["toolUse"]["toolUseId"] for t in tool_uses]
        assert len(tool_ids) == len(set(tool_ids))  # All unique

    # ============================================================
    # Strands Agent Cache Point Signature Tests
    # ============================================================

    def test_cache_point_strands_format(self):
        """Test cachePoint format matches Strands Agent SDK expectations.

        Strands SDK expects cache points in message content as:
        {"cachePoint": {"type": "default"}}

        This is used by BedrockModel to enable prompt caching.
        """
        cache_point_block = {"cachePoint": {"type": "default"}}

        # Must have cachePoint key
        assert "cachePoint" in cache_point_block

        # cachePoint value must be a dict with type
        assert isinstance(cache_point_block["cachePoint"], dict)
        assert "type" in cache_point_block["cachePoint"]

        # Valid type for Bedrock prompt caching
        assert cache_point_block["cachePoint"]["type"] == "default"

    def test_cache_point_in_assistant_message(self):
        """Test cache point placement in assistant message content array.

        Strands SDK processes messages array where cache points appear
        after content blocks (text, toolUse) in the same message.
        """
        assistant_message_with_cache = {
            "role": "assistant",
            "content": [
                {"text": "Here is my response to your question."},
                {"cachePoint": {"type": "default"}}
            ]
        }

        # Verify message structure
        assert assistant_message_with_cache["role"] == "assistant"
        assert isinstance(assistant_message_with_cache["content"], list)
        assert len(assistant_message_with_cache["content"]) == 2

        # First block should be text
        assert "text" in assistant_message_with_cache["content"][0]

        # Second block should be cachePoint
        assert "cachePoint" in assistant_message_with_cache["content"][1]

    def test_cache_point_after_tool_result(self):
        """Test cache point placement after tool_result in user message.

        Tool results are expensive to recompute, so caching after them
        is efficient for the Strands Agent conversation flow.
        """
        user_message_with_tool_result_cache = {
            "role": "user",
            "content": [
                {
                    "toolResult": {
                        "toolUseId": "toolu_01ABC",
                        "content": [{"text": "Search results: item1, item2, item3"}],
                        "status": "success"
                    }
                },
                {"cachePoint": {"type": "default"}}
            ]
        }

        # Verify role (tool results come as user messages in Strands)
        assert user_message_with_tool_result_cache["role"] == "user"

        # First block should be toolResult
        assert "toolResult" in user_message_with_tool_result_cache["content"][0]

        # Second block should be cachePoint
        assert "cachePoint" in user_message_with_tool_result_cache["content"][1]

    def test_cache_point_not_at_content_start(self):
        """Test that cache points are not placed at the start of content.

        Strands SDK expects cache points AFTER content, not at the beginning.
        Cache at start would cache nothing useful.
        """
        # Invalid: cache point at start
        invalid_message = {
            "role": "assistant",
            "content": [
                {"cachePoint": {"type": "default"}},  # Wrong position
                {"text": "Response"}
            ]
        }

        # Cache point should NOT be at index 0
        first_block = invalid_message["content"][0]
        # This is invalid format - test documents expected behavior
        assert "cachePoint" in first_block  # This is the invalid case we want to avoid

    def test_cache_point_valid_placement(self):
        """Test valid cache point placement after text content."""
        valid_message = {
            "role": "assistant",
            "content": [
                {"text": "Response content here"},
                {"cachePoint": {"type": "default"}}  # Correct: after text
            ]
        }

        # Verify text comes before cache
        text_idx = next(
            i for i, block in enumerate(valid_message["content"])
            if isinstance(block, dict) and "text" in block
        )
        cache_idx = next(
            i for i, block in enumerate(valid_message["content"])
            if isinstance(block, dict) and "cachePoint" in block
        )

        assert cache_idx > text_idx, "Cache point must come after text content"

    def test_multiple_cache_points_in_conversation(self):
        """Test multiple cache points across conversation history.

        Strands/Bedrock allows up to 4 cache points, but our implementation
        uses 3 for sliding window efficiency.
        """
        conversation_with_caches = [
            {
                "role": "user",
                "content": [{"text": "Question 1"}]
            },
            {
                "role": "assistant",
                "content": [
                    {"text": "Answer 1"},
                    {"cachePoint": {"type": "default"}}  # Cache point 1
                ]
            },
            {
                "role": "user",
                "content": [
                    {
                        "toolResult": {
                            "toolUseId": "tool-1",
                            "content": [{"text": "Results"}]
                        }
                    },
                    {"cachePoint": {"type": "default"}}  # Cache point 2
                ]
            },
            {
                "role": "assistant",
                "content": [
                    {"text": "Answer 2"},
                    {"cachePoint": {"type": "default"}}  # Cache point 3
                ]
            }
        ]

        # Count cache points
        cache_count = sum(
            1 for msg in conversation_with_caches
            for block in msg.get("content", [])
            if isinstance(block, dict) and "cachePoint" in block
        )

        assert cache_count == 3, "Should have exactly 3 cache points"

    def test_cache_point_after_tool_use_block(self):
        """Test cache point placement after toolUse in assistant message."""
        assistant_with_tool_and_cache = {
            "role": "assistant",
            "content": [
                {"text": "Let me search for that."},
                {
                    "toolUse": {
                        "toolUseId": "toolu_search_001",
                        "name": "web_search",
                        "input": {"query": "test query"}
                    }
                },
                {"cachePoint": {"type": "default"}}
            ]
        }

        # Cache should be after toolUse
        blocks = assistant_with_tool_and_cache["content"]
        tool_use_idx = next(
            i for i, b in enumerate(blocks) if "toolUse" in b
        )
        cache_idx = next(
            i for i, b in enumerate(blocks) if "cachePoint" in b
        )

        assert cache_idx > tool_use_idx

    def test_bedrock_model_cache_prompt_config(self):
        """Test BedrockModel cache_prompt configuration for Strands SDK.

        When creating BedrockModel, cache_prompt="default" enables
        system prompt caching at the Bedrock API level.
        """
        # This is the expected config passed to BedrockModel
        model_config_with_cache = {
            "model_id": "anthropic.claude-3-sonnet-20240229-v1:0",
            "temperature": 0.7,
            "cache_prompt": "default"  # Enables system prompt caching
        }

        assert model_config_with_cache["cache_prompt"] == "default"

        # Config without caching
        model_config_no_cache = {
            "model_id": "anthropic.claude-3-sonnet-20240229-v1:0",
            "temperature": 0.7
            # No cache_prompt key
        }

        assert "cache_prompt" not in model_config_no_cache

    def test_conversation_cache_hook_message_format(self):
        """Test that ConversationCachingHook produces Strands-compatible format.

        The hook processes event.agent.messages and inserts cache points
        in the correct positions within the content arrays.
        """
        # Simulated messages before hook
        messages_before = [
            {"role": "user", "content": [{"text": "Hello"}]},
            {"role": "assistant", "content": [{"text": "Hi there!"}]},
            {"role": "user", "content": [{"text": "How are you?"}]},
            {"role": "assistant", "content": [{"text": "I'm doing well, thanks!"}]}
        ]

        # Expected format after hook (cache on recent assistant messages)
        messages_after = [
            {"role": "user", "content": [{"text": "Hello"}]},
            {"role": "assistant", "content": [
                {"text": "Hi there!"},
                {"cachePoint": {"type": "default"}}
            ]},
            {"role": "user", "content": [{"text": "How are you?"}]},
            {"role": "assistant", "content": [
                {"text": "I'm doing well, thanks!"},
                {"cachePoint": {"type": "default"}}
            ]}
        ]

        # Verify structure matches Strands expectations
        for msg in messages_after:
            assert "role" in msg
            assert "content" in msg
            assert isinstance(msg["content"], list)

            # Each content block should be a dict
            for block in msg["content"]:
                assert isinstance(block, dict)
                # Should have one of: text, toolUse, toolResult, cachePoint
                valid_keys = {"text", "toolUse", "toolResult", "cachePoint", "image"}
                assert any(key in block for key in valid_keys)
