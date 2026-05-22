"""
Unit tests for _drain_skill_queue in AGUIEventProcessor.

Verifies that research_step events are forwarded as research_progress SSE,
alongside the existing code_step and code_agent_heartbeat events.
"""
import asyncio
import os
import sys
import pytest
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../src'))


def _make_processor():
    """Build a minimal AGUIStreamEventProcessor with mocked dependencies."""
    from streaming.agui_event_processor import AGUIStreamEventProcessor
    proc = AGUIStreamEventProcessor.__new__(AGUIStreamEventProcessor)
    proc._code_agent_active = False
    proc._code_agent_start_time = None
    proc._last_skill_event_time = None

    formatter = MagicMock()
    formatter.format_event.side_effect = lambda event_type, **kw: {"event": event_type, **kw}
    proc.formatter = formatter
    return proc


async def _drain(proc, session_id):
    results = []
    async for item in proc._drain_skill_queue(session_id):
        results.append(item)
    return results


class TestDrainSkillQueueResearchStep:
    def setup_method(self):
        # Import and set up a real skill_event_bus queue
        from streaming import skill_event_bus
        self.bus = skill_event_bus

    def teardown_method(self):
        self.bus.remove_queue("test-session")

    def test_research_step_emits_research_progress(self):
        self.bus.get_or_create_queue("test-session")
        self.bus.get_queue("test-session").put_nowait(
            {"type": "research_step", "content": "Searching web sources: quantum computing", "stepNumber": 1}
        )

        proc = _make_processor()
        results = asyncio.run(_drain(proc, "test-session"))

        assert len(results) == 1
        proc.formatter.format_event.assert_called_once_with(
            "research_progress", content="Searching web sources: quantum computing", stepNumber=1
        )

    def test_multiple_research_steps_all_forwarded(self):
        self.bus.get_or_create_queue("test-session")
        q = self.bus.get_queue("test-session")
        for i in range(1, 4):
            q.put_nowait({"type": "research_step", "content": f"Step {i}", "stepNumber": i})

        proc = _make_processor()
        results = asyncio.run(_drain(proc, "test-session"))

        assert len(results) == 3
        calls = proc.formatter.format_event.call_args_list
        assert all(c.args[0] == "research_progress" for c in calls)
        step_numbers = [c.kwargs["stepNumber"] for c in calls]
        assert step_numbers == [1, 2, 3]

    def test_research_step_and_code_step_both_forwarded(self):
        self.bus.get_or_create_queue("test-session")
        q = self.bus.get_queue("test-session")
        q.put_nowait({"type": "research_step", "content": "Searching web", "stepNumber": 1})
        q.put_nowait({"type": "code_step", "content": "Writing code", "stepNumber": 1})

        proc = _make_processor()
        results = asyncio.run(_drain(proc, "test-session"))

        assert len(results) == 2
        event_types = [c.args[0] for c in proc.formatter.format_event.call_args_list]
        assert "research_progress" in event_types
        assert "code_step" in event_types

    def test_no_events_returns_empty(self):
        self.bus.get_or_create_queue("test-session")

        proc = _make_processor()
        results = asyncio.run(_drain(proc, "test-session"))

        assert results == []

    def test_none_session_id_returns_empty(self):
        proc = _make_processor()
        results = asyncio.run(_drain(proc, None))

        assert results == []
        proc.formatter.format_event.assert_not_called()
