import json
import uuid
import logging
from typing import Any, Dict, List, Optional

from ag_ui.core import (
    RunStartedEvent,
    RunFinishedEvent,
    RunErrorEvent,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    ToolCallStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    StateSnapshotEvent,
    CustomEvent,
    EventType,
)
from ag_ui.encoder import EventEncoder

from .event_formatter import StreamEventFormatter

logger = logging.getLogger(__name__)


class AGUIStreamEventFormatter:
    """
    Formats streaming events as AG-UI protocol SSE blobs.

    Stateful: tracks the current run_id, thread_id, and any open text message
    so that AG-UI start/end pairs are always properly matched.

    All parsing/extraction logic (Lambda envelope unwrapping, image extraction,
    metadata merging, etc.) is preserved by delegating to StreamEventFormatter
    static helpers.  Only the final SSE output format changes.

    Usage::

        encoder = EventEncoder()
        formatter = AGUIStreamEventFormatter(encoder)
        sse = formatter.format_event("init")
        sse += formatter.format_event("response", text="Hello")
        sse += formatter.format_event("complete", message="Hello", images=None, usage=None)
    """

    def __init__(self, encoder: EventEncoder, thread_id: Optional[str] = None, run_id: Optional[str] = None) -> None:
        self.encoder = encoder
        self._thread_id: str = thread_id or str(uuid.uuid4())
        self._initial_run_id: Optional[str] = run_id
        self._run_id: Optional[str] = None
        self._current_message_id: Optional[str] = None
        self._message_open: bool = False

    # ------------------------------------------------------------------ #
    # Internal helpers                                                     #
    # ------------------------------------------------------------------ #

    def _encode(self, event) -> str:
        return self.encoder.encode(event)

    def _close_open_message(self) -> str:
        """Emit TextMessageEndEvent if a text message is currently open."""
        if self._message_open and self._current_message_id:
            encoded = self._encode(TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=self._current_message_id,
            ))
            self._message_open = False
            self._current_message_id = None
            return encoded
        return ""

    # ------------------------------------------------------------------ #
    # Public dispatch                                                      #
    # ------------------------------------------------------------------ #

    def format_event(self, event_type: str, **kwargs) -> str:
        """Return an AG-UI–encoded SSE string for the given event type.

        Maps custom event types to AG-UI equivalents:
          init                → RunStartedEvent
          thinking            → CustomEvent(name='thinking')
          reasoning           → CustomEvent(name='reasoning')
          response            → TextMessageStartEvent + TextMessageContentEvent
          complete            → (TextMessageEndEvent if message open, else TextMessage if message kwarg provided) + RunFinishedEvent
          tool_use            → ToolCallStartEvent + ToolCallArgsEvent + ToolCallEndEvent
          tool_result         → ToolCallResultEvent
          error               → RunErrorEvent
          <all others>        → CustomEvent(name=<original_type>, value=<payload>)
        """
        _dispatch: Dict[str, Any] = {
            "init":        self._format_init,
            "thinking":    self._format_thinking,
            "reasoning":   self._format_reasoning,
            "response":    self._format_response,
            "complete":    self._format_complete,
            "stop":        self._format_stop,
            "tool_use":    self._format_tool_use,
            "tool_result": self._format_tool_result,
            "error":       self._format_error,
        }
        handler = _dispatch.get(event_type, self._format_custom)
        return handler(event_type=event_type, **kwargs)

    # ------------------------------------------------------------------ #
    # Core AG-UI event formatters                                          #
    # ------------------------------------------------------------------ #

    def _format_init(self, event_type: str = "init", **kwargs) -> str:
        self._run_id = self._initial_run_id or str(uuid.uuid4())
        self._initial_run_id = None  # consume once; subsequent calls (shouldn't happen) get a fresh uuid
        self._message_open = False
        self._current_message_id = None
        return self._encode(RunStartedEvent(
            type=EventType.RUN_STARTED,
            thread_id=self._thread_id,
            run_id=self._run_id,
        ))

    def _format_thinking(self, event_type: str = "thinking", **kwargs) -> str:
        return self._encode(CustomEvent(
            type=EventType.CUSTOM,
            name="thinking",
            value={"message": kwargs.get("message", "Processing your request...")},
        ))

    def _format_reasoning(self, event_type: str = "reasoning", **kwargs) -> str:
        return self._encode(CustomEvent(
            type=EventType.CUSTOM,
            name="reasoning",
            value={
                "text": kwargs.get("reasoning_text", kwargs.get("text", "")),
                "step": kwargs.get("step", "thinking"),
            },
        ))

    def _format_response(self, event_type: str = "response", **kwargs) -> str:
        text = kwargs.get("text", "")
        result = ""
        if not self._message_open:
            self._current_message_id = str(uuid.uuid4())
            self._message_open = True
            result += self._encode(TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=self._current_message_id,
                role="assistant",
            ))
        result += self._encode(TextMessageContentEvent(
            type=EventType.TEXT_MESSAGE_CONTENT,
            message_id=self._current_message_id,
            delta=text,
        ))
        return result

    def _format_complete(self, event_type: str = "complete", **kwargs) -> str:
        message: str = kwargs.get("message", "")
        result = ""

        if message and not self._message_open:
            # No incremental text was streamed — emit the final result text as a
            # complete text message now so it is not silently dropped.
            msg_id = str(uuid.uuid4())
            result += self._encode(TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=msg_id,
                role="assistant",
            ))
            result += self._encode(TextMessageContentEvent(
                type=EventType.TEXT_MESSAGE_CONTENT,
                message_id=msg_id,
                delta=message,
            ))
            result += self._encode(TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=msg_id,
            ))
        else:
            # Close any message that was built up through incremental response events.
            result += self._close_open_message()

        run_id = self._run_id or str(uuid.uuid4())
        result += self._encode(RunFinishedEvent(
            type=EventType.RUN_FINISHED,
            thread_id=self._thread_id,
            run_id=run_id,
        ))
        # Images and usage have no standard AG-UI home; relay as a CustomEvent
        # so consumers that understand the schema can still act on them.
        images = kwargs.get("images")
        usage = kwargs.get("usage")
        if images or usage:
            extra: Dict[str, Any] = {}
            if images:
                extra["images"] = images
            if usage:
                extra["usage"] = usage
            result += self._encode(CustomEvent(
                type=EventType.CUSTOM,
                name="complete_metadata",
                value=extra,
            ))
        return result

    def _format_tool_use(self, event_type: str = "tool_use", **kwargs) -> str:
        # Accept either format_event("tool_use", tool_use={...})
        # or     format_event("tool_use", toolUseId=..., name=..., input=...)
        tool_use = kwargs.get("tool_use")
        if not isinstance(tool_use, dict):
            tool_use = kwargs
        tool_use_id: str = tool_use.get("toolUseId") or str(uuid.uuid4())
        tool_name: str = tool_use.get("name", "unknown")
        tool_input = tool_use.get("input", {})

        # Close any open text message before a tool call sequence
        result = self._close_open_message()
        result += self._encode(ToolCallStartEvent(
            type=EventType.TOOL_CALL_START,
            tool_call_id=tool_use_id,
            tool_call_name=tool_name,
            parent_message_id=None,
        ))
        result += self._encode(ToolCallArgsEvent(
            type=EventType.TOOL_CALL_ARGS,
            tool_call_id=tool_use_id,
            delta=json.dumps(tool_input),
        ))
        result += self._encode(ToolCallEndEvent(
            type=EventType.TOOL_CALL_END,
            tool_call_id=tool_use_id,
        ))
        return result

    def _format_tool_result(self, event_type: str = "tool_result", **kwargs) -> str:
        # Accept either format_event("tool_result", tool_result={...})
        # or     format_event("tool_result", toolUseId=..., content=[...], ...)
        tool_result = kwargs.get("tool_result")
        if tool_result is None:
            tool_result = kwargs

        # Handle the rare case where tool_result arrives as a JSON string
        if isinstance(tool_result, str):
            try:
                tool_result = json.loads(tool_result)
            except json.JSONDecodeError:
                tool_result = {"toolUseId": "unknown", "content": [{"text": tool_result}]}

        # Shallow copy so we don't mutate the caller's dict
        tool_result = dict(tool_result)

        # Unwrap Lambda response envelope (Gateway tools)
        # Lambda format: content[0].text = '{"statusCode":200,"body":"..."}'
        if "content" in tool_result and isinstance(tool_result["content"], list):
            if tool_result["content"]:
                first = tool_result["content"][0]
                if isinstance(first, dict) and "text" in first:
                    text_content = first["text"]
                    if text_content and text_content.strip():
                        try:
                            parsed = json.loads(text_content)
                            if isinstance(parsed, dict) and "statusCode" in parsed and "body" in parsed:
                                body = (
                                    json.loads(parsed["body"])
                                    if isinstance(parsed["body"], str)
                                    else parsed["body"]
                                )
                                if "content" in body:
                                    tool_result["content"] = body["content"]
                        except (json.JSONDecodeError, KeyError):
                            pass

        # Delegate the full parsing pipeline to StreamEventFormatter static helpers:
        # image extraction, JSON content unwrapping, screenshot handling, etc.
        result_text, result_images = StreamEventFormatter._extract_all_content(tool_result)
        StreamEventFormatter._handle_tool_storage(tool_result, result_text)
        result_text = StreamEventFormatter._extract_metadata_from_json_result(tool_result, result_text)

        # Build a structured payload that carries all the same fields the original
        # tool_result SSE blob would have contained.
        payload: Dict[str, Any] = {"result": result_text}
        if result_images:
            payload["images"] = result_images
        if "status" in tool_result:
            payload["status"] = tool_result["status"]
        if "metadata" in tool_result:
            payload["metadata"] = tool_result["metadata"]

        return self._encode(ToolCallResultEvent(
            type=EventType.TOOL_CALL_RESULT,
            message_id=str(uuid.uuid4()),
            tool_call_id=tool_result.get("toolUseId", "unknown"),
            content=json.dumps(payload),
        ))

    def _format_stop(self, event_type: str = "stop", **kwargs) -> str:
        """Emitted when the stream is gracefully stopped by the user.

        Closes any open text message, emits RunFinishedEvent, then signals
        the frontend via CustomEvent(name='stream_stopped') so it can reset
        state without showing the stop message as a chat bubble.
        """
        result = self._close_open_message()
        run_id = self._run_id or str(uuid.uuid4())
        result += self._encode(RunFinishedEvent(
            type=EventType.RUN_FINISHED,
            thread_id=self._thread_id,
            run_id=run_id,
        ))
        result += self._encode(CustomEvent(
            type=EventType.CUSTOM,
            name="stream_stopped",
            value={"message": "Stream stopped by user"},
        ))
        return result

    def _format_error(self, event_type: str = "error", **kwargs) -> str:
        result = self._close_open_message()
        result += self._encode(RunErrorEvent(
            type=EventType.RUN_ERROR,
            message=kwargs.get("error_message", kwargs.get("message", "Unknown error")),
        ))
        return result

    # ------------------------------------------------------------------ #
    # App-specific events → CustomEvent passthrough                        #
    # ------------------------------------------------------------------ #

    def _format_custom(self, event_type: str = "custom", **kwargs) -> str:
        """Handles all app-specific events without a standard AG-UI equivalent.

        Covers: interrupt, warning, metadata, oauth_elicitation,
        browser_progress, research_progress, code_step, code_todo_update,
        code_result_meta, artifact_created, start, end.
        """
        return self._encode(CustomEvent(
            type=EventType.CUSTOM,
            name=event_type,
            value=kwargs,
        ))
