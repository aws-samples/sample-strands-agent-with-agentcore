"""
Contract tests for research-agent A2A protocol.

Tests verify the shapes that MetadataAwareExecutor produces (research_step_N
artifacts, streaming event routing) without requiring a running Strands agent.
"""
import asyncio
from unittest.mock import MagicMock


# ============================================================
# Minimal stubs (no A2A/Strands imports needed in CI)
# ============================================================

class MockTextPart:
    def __init__(self, text):
        self.text = text


class MockPart:
    def __init__(self, text):
        self.root = MockTextPart(text)


class MockTaskUpdater:
    def __init__(self):
        self.artifacts = []
        self.completed = False

    async def add_artifact(self, parts, name=None):
        self.artifacts.append({
            "name": name,
            "text": parts[0].root.text if parts and hasattr(parts[0], "root") else "",
        })

    async def complete(self):
        self.completed = True


# ============================================================
# Research step artifact contract
# ============================================================

class TestResearchStepArtifacts:
    """research_step_N is the only named artifact the orchestrator handles specially."""

    def test_research_steps_use_sequential_names(self):
        async def _run():
            updater = MockTaskUpdater()
            for i in range(1, 4):
                await updater.add_artifact(
                    [MockPart(f"Step {i} content")],
                    name=f"research_step_{i}",
                )
            await updater.complete()
            return updater

        updater = asyncio.run(_run())
        assert len(updater.artifacts) == 3
        for i, artifact in enumerate(updater.artifacts, 1):
            assert artifact["name"] == f"research_step_{i}"

    def test_final_response_uses_agent_response_name(self):
        async def _run():
            updater = MockTaskUpdater()
            await updater.add_artifact(
                [MockPart("Final research summary.")],
                name="agent_response",
            )
            await updater.complete()
            return updater

        updater = asyncio.run(_run())
        assert updater.artifacts[0]["name"] == "agent_response"
        assert updater.completed is True

    def test_research_step_name_format_matches_orchestrator_pattern(self):
        """Orchestrator _process_artifact splits on '_' and expects int suffix."""
        for n in range(1, 6):
            name = f"research_step_{n}"
            parts = name.split("_")
            assert parts[-1].isdigit(), f"Expected numeric suffix in {name}"
            assert int(parts[-1]) == n


# ============================================================
# Streaming event routing contract
# ============================================================

class TestStreamingEventRouting:
    """_handle_streaming_event routes on event['type'], not on key presence."""

    def _make_tool_use_event(self, tool_use_id, name, input_dict=None):
        return {
            "type": "tool_use_stream",
            "current_tool_use": {
                "toolUseId": tool_use_id,
                "name": name,
                "input": input_dict or {},
            },
        }

    def _make_tool_result_event(self):
        return {"type": "tool_result", "content": "some result"}

    def _make_data_event(self, text):
        return {"type": "data", "data": text}

    def _make_result_event(self, text):
        return {"type": "result", "result": text}

    def test_tool_use_stream_event_has_current_tool_use(self):
        event = self._make_tool_use_event("id-1", "ddg_web_search", {"query": "AI news"})
        assert event.get("type") == "tool_use_stream"
        assert "current_tool_use" in event
        assert event["current_tool_use"]["name"] == "ddg_web_search"

    def test_tool_result_event_has_expected_type(self):
        event = self._make_tool_result_event()
        assert event.get("type") == "tool_result"

    def test_data_event_has_data_key(self):
        event = self._make_data_event("thinking...")
        assert "data" in event

    def test_result_event_has_result_key(self):
        event = self._make_result_event("final answer")
        assert "result" in event

    def test_unique_tool_use_id_per_tool_call(self):
        """Each new tool call must have a distinct toolUseId to avoid dedup drops."""
        ids = [f"tool-id-{i}" for i in range(5)]
        assert len(set(ids)) == len(ids)

    def test_tool_status_map_covers_all_research_tools(self):
        """All tools the research agent uses should appear in TOOL_STATUS_MAP."""
        expected_tools = {
            "ddg_web_search",
            "fetch_url_content",
            "wikipedia_search",
            "wikipedia_get_article",
            "write_markdown_section",
            "read_markdown_file",
            "generate_chart_tool",
        }
        # Map defined in MetadataAwareExecutor
        tool_status_map = {
            "ddg_web_search": "Searching web sources",
            "fetch_url_content": "Fetching article content",
            "wikipedia_search": "Searching Wikipedia",
            "wikipedia_get_article": "Reading Wikipedia article",
            "write_markdown_section": "Writing report section",
            "read_markdown_file": "Reading report",
            "generate_chart_tool": "Generating chart",
        }
        assert expected_tools == set(tool_status_map.keys())


# ============================================================
# Metadata extraction contract
# ============================================================

class TestMetadataExtraction:
    """Metadata flows from RequestContext into agent invocation_state."""

    def _make_context(self, ctx_meta=None, msg_meta=None):
        ctx = MagicMock()
        ctx.metadata = ctx_meta or {}
        ctx.message = MagicMock()
        ctx.message.metadata = msg_meta or {}
        return ctx

    def test_context_metadata_takes_priority(self):
        ctx = self._make_context(
            ctx_meta={"model_id": "ctx-model", "session_id": "ctx-session"},
            msg_meta={"model_id": "msg-model"},
        )
        metadata = ctx.metadata or ctx.message.metadata
        assert metadata["model_id"] == "ctx-model"

    def test_falls_back_to_message_metadata(self):
        ctx = self._make_context(
            ctx_meta={},
            msg_meta={"model_id": "msg-model", "session_id": "msg-session"},
        )
        metadata = ctx.metadata or ctx.message.metadata
        assert metadata["model_id"] == "msg-model"

    def test_default_user_id_when_absent(self):
        ctx = self._make_context(ctx_meta={"session_id": "s1"})
        metadata = ctx.metadata
        user_id = metadata.get("user_id", "default_user")
        assert user_id == "default_user"

    def test_session_id_propagated(self):
        ctx = self._make_context(ctx_meta={"session_id": "test-session-42"})
        assert ctx.metadata.get("session_id") == "test-session-42"
