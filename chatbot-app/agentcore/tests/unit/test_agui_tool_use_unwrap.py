"""SSE unwrap: _format_tool_use should expose the effective tool name for
skill_executor, and leave everything else alone."""

import json

import pytest
from ag_ui.encoder import EventEncoder

from streaming.agui_event_formatter import AGUIStreamEventFormatter


def _parse_sse_events(blob: str) -> list[dict]:
    events = []
    for frame in blob.split("\n\n"):
        for line in frame.splitlines():
            if line.startswith("data:"):
                events.append(json.loads(line[len("data:"):].strip()))
    return events


@pytest.fixture
def formatter():
    return AGUIStreamEventFormatter(EventEncoder(), thread_id="t", run_id="r")


def test_skill_executor_unwraps_to_inner_tool_name(formatter):
    blob = formatter.format_event(
        "tool_use",
        tool_use={
            "toolUseId": "tu-1",
            "name": "skill_executor",
            "input": {
                "skill_name": "arxiv-search",
                "tool_name": "arxiv_search",
                "tool_input": '{"query": "mamba"}',
            },
        },
    )
    starts = [e for e in _parse_sse_events(blob) if e.get("type") == "TOOL_CALL_START"]
    assert len(starts) == 1
    assert starts[0]["toolCallName"] == "arxiv_search"
    assert starts[0]["toolCallId"] == "tu-1"


def test_skill_dispatcher_is_not_unwrapped(formatter):
    """Dispatcher returns SKILL.md instructions; its meta-tool UX is legit."""
    blob = formatter.format_event(
        "tool_use",
        tool_use={
            "toolUseId": "tu-2",
            "name": "skill_dispatcher",
            "input": {"skill_name": "arxiv-search"},
        },
    )
    starts = [e for e in _parse_sse_events(blob) if e.get("type") == "TOOL_CALL_START"]
    assert starts[0]["toolCallName"] == "skill_dispatcher"


def test_regular_tool_passes_through(formatter):
    blob = formatter.format_event(
        "tool_use",
        tool_use={
            "toolUseId": "tu-3",
            "name": "create_visualization",
            "input": {"title": "x"},
        },
    )
    starts = [e for e in _parse_sse_events(blob) if e.get("type") == "TOOL_CALL_START"]
    assert starts[0]["toolCallName"] == "create_visualization"


def test_skill_executor_without_tool_name_falls_back(formatter):
    """Defensive: if tool_input is missing tool_name, emit the wrapper name
    rather than a blank/broken event."""
    blob = formatter.format_event(
        "tool_use",
        tool_use={
            "toolUseId": "tu-4",
            "name": "skill_executor",
            "input": {"skill_name": "arxiv-search"},
        },
    )
    starts = [e for e in _parse_sse_events(blob) if e.get("type") == "TOOL_CALL_START"]
    assert starts[0]["toolCallName"] == "skill_executor"


def test_args_payload_still_contains_inner_fields(formatter):
    """The args delta must still carry skill_name / tool_name / tool_input —
    frontends that key off those fields (e.g. dispatcher icon resolution,
    result parsing) stay intact."""
    blob = formatter.format_event(
        "tool_use",
        tool_use={
            "toolUseId": "tu-5",
            "name": "skill_executor",
            "input": {
                "skill_name": "weather",
                "tool_name": "weather_lookup",
                "tool_input": '{"city": "Seoul"}',
            },
        },
    )
    args_events = [
        e for e in _parse_sse_events(blob) if e.get("type") == "TOOL_CALL_ARGS"
    ]
    assert args_events
    delta = json.loads(args_events[0]["delta"])
    assert delta["tool_name"] == "weather_lookup"
    assert delta["skill_name"] == "weather"
