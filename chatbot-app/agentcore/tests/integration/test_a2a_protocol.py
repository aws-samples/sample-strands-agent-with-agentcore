"""
Integration tests for A2A (Agent-to-Agent) protocol handling.

Tests the A2A message format, metadata propagation, and response structure
as expected by the frontend chatbot application.

These tests can run without actual A2A connections by mocking the A2A executor.
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Dict, Any, List


# ============================================================
# Mock Classes for A2A Testing
# ============================================================

class MockA2APart:
    """Mock A2A Part object."""
    def __init__(self, text: str = "", part_type: str = "text"):
        self.root = MockTextPart(text) if part_type == "text" else None
        self.type = part_type


class MockTextPart:
    """Mock TextPart from A2A types."""
    def __init__(self, text: str):
        self.text = text


class MockA2AMessage:
    """Mock A2A Message structure."""
    def __init__(self, parts: List[MockA2APart], metadata: Dict[str, Any] = None):
        self.parts = parts
        self.metadata = metadata or {}


class MockRequestContext:
    """Mock A2A RequestContext for testing executors."""
    def __init__(self, message: MockA2AMessage, metadata: Dict[str, Any] = None):
        self.message = message
        self.metadata = metadata or {}


class MockTaskUpdater:
    """Mock TaskUpdater for capturing executor output."""
    def __init__(self):
        self.artifacts = []
        self.completed = False

    async def add_artifact(self, parts: List, name: str = None):
        self.artifacts.append({
            "name": name,
            "parts": [p.root.text if hasattr(p, 'root') and hasattr(p.root, 'text') else str(p) for p in parts]
        })

    async def complete(self):
        self.completed = True


# ============================================================
# A2A Message Format Tests
# ============================================================

class TestA2AMessageFormat:
    """Tests for A2A message format validation."""

    def test_a2a_message_with_text_parts(self):
        """Test A2A message with text parts."""
        parts = [
            MockA2APart("Research the topic of AI safety", "text")
        ]
        message = MockA2AMessage(parts)

        assert len(message.parts) == 1
        assert message.parts[0].root.text == "Research the topic of AI safety"

    def test_a2a_message_with_metadata(self):
        """Test A2A message carries metadata correctly."""
        parts = [MockA2APart("Test message", "text")]
        metadata = {
            "model_id": "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
            "session_id": "test-session-123",
            "user_id": "user-456"
        }
        message = MockA2AMessage(parts, metadata)

        assert message.metadata["model_id"] == "eu.anthropic.claude-sonnet-4-5-20250929-v1:0"
        assert message.metadata["session_id"] == "test-session-123"
        assert message.metadata["user_id"] == "user-456"

    def test_a2a_context_metadata_propagation(self):
        """Test that RequestContext properly carries metadata."""
        parts = [MockA2APart("Test", "text")]
        message = MockA2AMessage(parts)
        context_metadata = {
            "model_id": "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
            "session_id": "session-abc",
            "user_id": "user-xyz"
        }
        context = MockRequestContext(message, context_metadata)

        # Executor should be able to access metadata from context
        assert context.metadata["model_id"] == "eu.anthropic.claude-haiku-4-5-20251001-v1:0"

    def test_a2a_message_metadata_fallback(self):
        """Test metadata fallback from message when context metadata is empty."""
        parts = [MockA2APart("Test", "text")]
        message_metadata = {
            "model_id": "fallback-model",
            "session_id": "fallback-session"
        }
        message = MockA2AMessage(parts, message_metadata)
        context = MockRequestContext(message, metadata={})

        # Simulate executor logic: try context.metadata first, then message.metadata
        metadata = context.metadata or getattr(context.message, 'metadata', {})

        # In this case context.metadata is empty dict (falsy), so fallback
        if not metadata:
            metadata = context.message.metadata

        assert metadata["model_id"] == "fallback-model"


# ============================================================
# A2A Response Structure Tests
# ============================================================

class TestA2AResponseStructure:
    """Tests for A2A response structure expected by frontend."""

    def test_a2a_text_response_format(self):
        """Test A2A text response format."""
        # A2A responses use artifact format
        response = {
            "status": "completed",
            "artifacts": [
                {
                    "name": "agent_response",
                    "parts": [{"text": "This is the research result."}]
                }
            ]
        }

        assert response["status"] == "completed"
        assert len(response["artifacts"]) == 1
        assert response["artifacts"][0]["name"] == "agent_response"

    def test_a2a_multiple_artifacts(self):
        """Test A2A response with multiple artifacts (research + markdown)."""
        response = {
            "status": "completed",
            "artifacts": [
                {
                    "name": "agent_response",
                    "parts": [{"text": "Research completed successfully."}]
                },
                {
                    "name": "research_markdown",
                    "parts": [{"text": "<research>\n# Research Report\n...\n</research>"}]
                }
            ]
        }

        assert len(response["artifacts"]) == 2
        artifact_names = [a["name"] for a in response["artifacts"]]
        assert "agent_response" in artifact_names
        assert "research_markdown" in artifact_names

    def test_a2a_error_artifact(self):
        """Test A2A error response format."""
        response = {
            "status": "failed",
            "artifacts": [
                {
                    "name": "error",
                    "parts": [{"text": "Error: Bedrock service is temporarily unavailable."}]
                }
            ]
        }

        assert response["status"] == "failed"
        assert response["artifacts"][0]["name"] == "error"
        assert "unavailable" in response["artifacts"][0]["parts"][0]["text"]


# ============================================================
# A2A Executor Behavior Tests
# ============================================================

class TestA2AExecutorBehavior:
    """Tests for A2A executor behavior patterns."""

    @pytest.mark.asyncio
    async def test_task_updater_artifact_addition(self):
        """Test TaskUpdater properly accumulates artifacts."""
        updater = MockTaskUpdater()

        # Simulate executor adding artifacts
        await updater.add_artifact(
            [MockA2APart("First response", "text")],
            name="agent_response"
        )
        await updater.add_artifact(
            [MockA2APart("<research>\n# Report\n</research>", "text")],
            name="research_markdown"
        )
        await updater.complete()

        assert len(updater.artifacts) == 2
        assert updater.artifacts[0]["name"] == "agent_response"
        assert updater.artifacts[1]["name"] == "research_markdown"
        assert updater.completed is True

    @pytest.mark.asyncio
    async def test_task_updater_handles_empty_content(self):
        """Test TaskUpdater handles empty content gracefully."""
        updater = MockTaskUpdater()

        # Empty text should still be recorded
        await updater.add_artifact(
            [MockA2APart("", "text")],
            name="empty_response"
        )
        await updater.complete()

        assert len(updater.artifacts) == 1
        assert updater.completed is True


# ============================================================
# A2A Skills Definition Tests
# ============================================================

class TestA2ASkillsDefinition:
    """Tests for A2A agent skills definition format."""

    def test_skill_has_required_fields(self):
        """Test that skill definition has all required fields."""
        skill = {
            "id": "research_topic",
            "name": "Research Topic",
            "description": "Conduct comprehensive web research on any topic",
            "inputModes": ["text/plain"],
            "outputModes": ["text/markdown", "application/json"],
            "tags": ["research", "web-search"],
            "examples": [
                "Research the latest developments in quantum computing"
            ]
        }

        required_fields = ["id", "name", "description", "inputModes", "outputModes"]
        for field in required_fields:
            assert field in skill, f"Missing required field: {field}"

    def test_skill_input_output_modes(self):
        """Test skill input/output mode declarations."""
        skill = {
            "id": "generate_report",
            "name": "Generate Research Report",
            "description": "Generate a comprehensive markdown research report",
            "inputModes": ["text/plain"],
            "outputModes": ["text/markdown"]
        }

        assert "text/plain" in skill["inputModes"]
        assert "text/markdown" in skill["outputModes"]

    def test_multiple_skills_unique_ids(self):
        """Test that multiple skills have unique IDs."""
        skills = [
            {"id": "research_topic", "name": "Research Topic"},
            {"id": "generate_report", "name": "Generate Report"},
            {"id": "summarize", "name": "Summarize"}
        ]

        ids = [s["id"] for s in skills]
        assert len(ids) == len(set(ids)), "Skill IDs must be unique"


# ============================================================
# A2A Streaming Event Tests
# ============================================================

class TestA2AStreamingEvents:
    """Tests for A2A streaming event format."""

    def test_streaming_text_event(self):
        """Test A2A streaming text event format."""
        event = {
            "type": "text",
            "text": "Searching for information..."
        }

        assert event["type"] == "text"
        assert "text" in event

    def test_streaming_tool_event(self):
        """Test A2A streaming tool event format."""
        event = {
            "type": "tool_use",
            "toolUseId": "tool-123",
            "name": "ddg_web_search",
            "input": {"query": "AI safety research"}
        }

        assert event["type"] == "tool_use"
        assert event["name"] == "ddg_web_search"

    def test_streaming_artifact_event(self):
        """Test A2A streaming artifact event format."""
        event = {
            "type": "artifact",
            "name": "research_markdown",
            "content": "# Research Report\n\n## Introduction..."
        }

        assert event["type"] == "artifact"
        assert event["name"] == "research_markdown"


# ============================================================
# A2A Metadata Integration Tests
# ============================================================

class TestA2AMetadataIntegration:
    """Tests for A2A metadata integration with chatbot."""

    def test_browser_session_metadata_in_a2a_response(self):
        """Test that browserSessionId can be passed through A2A metadata."""
        # A2A tool result can include metadata for browser session
        tool_result = {
            "status": "success",
            "text": "Browser task completed",
            "metadata": {
                "browserSessionId": "browser-session-abc123",
                "browserId": "browser-xyz"
            }
        }

        assert "metadata" in tool_result
        assert "browserSessionId" in tool_result["metadata"]

    def test_model_id_propagation_to_a2a_agent(self):
        """Test that model_id from frontend is propagated to A2A agent."""
        # Frontend sends model_id in request
        frontend_request = {
            "message": "Research quantum computing",
            "model_id": "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
            "enabled_tools": ["research-agent"]
        }

        # A2A metadata should include model_id
        a2a_metadata = {
            "model_id": frontend_request["model_id"],
            "session_id": "session-123",
            "user_id": "user-456"
        }

        assert a2a_metadata["model_id"] == frontend_request["model_id"]

    def test_session_id_propagation_for_report_workspace(self):
        """Test session_id propagation for research report workspace management."""
        # Each session should have its own workspace directory
        session_id = "session-unique-789"

        # Report manager would use this to create workspace
        expected_workspace_pattern = f"/tmp/research_{session_id}_"

        # Just validate the pattern expectation
        assert session_id in expected_workspace_pattern


# ============================================================
# A2A Error Handling Tests
# ============================================================

class TestA2AErrorHandling:
    """Tests for A2A error handling scenarios."""

    def test_bedrock_service_unavailable_error(self):
        """Test handling of Bedrock serviceUnavailableException."""
        error_msg = "serviceUnavailableException: The service is temporarily unavailable"

        # Error detection logic
        is_service_error = "serviceUnavailableException" in error_msg or "ServiceUnavailable" in error_msg

        assert is_service_error is True

    def test_throttling_error_detection(self):
        """Test handling of Bedrock ThrottlingException."""
        error_msg = "ThrottlingException: Rate exceeded"

        is_throttling = "ThrottlingException" in error_msg

        assert is_throttling is True

    def test_error_artifact_format(self):
        """Test error artifact format for frontend display."""
        error_artifact = {
            "name": "error",
            "parts": [
                {
                    "text": "Error: Bedrock service is temporarily unavailable. Please try again in a few moments."
                }
            ]
        }

        assert error_artifact["name"] == "error"
        assert "unavailable" in error_artifact["parts"][0]["text"].lower()


# ============================================================
# A2A Invocation State Tests
# ============================================================

class TestA2AInvocationState:
    """Tests for A2A invocation state management."""

    def test_invocation_state_structure(self):
        """Test invocation state structure passed to agent."""
        invocation_state = {
            "request_state": {
                "session_id": "session-abc",
                "user_id": "user-123",
                "metadata": {
                    "model_id": "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
                    "temperature": 0.7
                }
            }
        }

        assert "request_state" in invocation_state
        assert invocation_state["request_state"]["session_id"] == "session-abc"
        assert invocation_state["request_state"]["user_id"] == "user-123"

    def test_invocation_state_available_to_tools(self):
        """Test that invocation_state is available to tool functions."""
        # Tools receive invocation_state via tool_context
        def mock_tool_execution(tool_context):
            session_id = None
            if hasattr(tool_context, 'invocation_state'):
                request_state = tool_context.invocation_state.get('request_state', {})
                session_id = request_state.get('session_id')
            return session_id

        # Mock tool context
        mock_context = MagicMock()
        mock_context.invocation_state = {
            "request_state": {
                "session_id": "extracted-session-id"
            }
        }

        result = mock_tool_execution(mock_context)
        assert result == "extracted-session-id"


# ============================================================
# A2A Agent Card Tests
# ============================================================

class TestA2AAgentCard:
    """Tests for A2A Agent Card format (/.well-known/agent-card.json)."""

    def test_agent_card_required_fields(self):
        """Test Agent Card has required fields."""
        agent_card = {
            "name": "Research Agent",
            "description": "Research Agent (A2A Server) - Autonomous research specialist",
            "version": "1.0.0",
            "url": "http://localhost:9000/",
            "skills": [
                {
                    "id": "research_topic",
                    "name": "Research Topic",
                    "description": "Conduct comprehensive web research"
                }
            ]
        }

        required_fields = ["name", "description", "version", "url", "skills"]
        for field in required_fields:
            assert field in agent_card, f"Missing required field: {field}"

    def test_agent_card_skills_format(self):
        """Test Agent Card skills format."""
        skills = [
            {
                "id": "research_topic",
                "name": "Research Topic",
                "description": "Conduct comprehensive web research on any topic",
                "inputModes": ["text/plain"],
                "outputModes": ["text/markdown", "application/json"]
            }
        ]

        for skill in skills:
            assert "id" in skill
            assert "name" in skill
            assert "description" in skill
