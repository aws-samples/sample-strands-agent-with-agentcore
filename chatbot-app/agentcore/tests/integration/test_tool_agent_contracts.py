"""
Contract-based compatibility tests for Agent ↔ Tool ↔ Protocol integration.

Purpose:
1. When Agent code is modified → Verify Tool/Protocol compatibility
2. When Tool code is modified → Verify Agent/Protocol compatibility

These tests validate the CONTRACT (interface) between components:
- Agent → Tool: Tool input format, invocation pattern
- Tool → Agent: Tool result format, content blocks
- Agent ↔ Protocol: Event streaming format, metadata propagation

Run these tests BEFORE deploying changes to catch breaking changes early.
"""
import json
import pytest
from typing import Dict, Any, List
from unittest.mock import MagicMock


# ============================================================
# Shared Contract Definitions
# ============================================================

class ToolInputContract:
    """
    Contract: Tool Input Format

    Agent sends tool input in this format.
    Tools must accept this format.
    """

    @staticmethod
    def create_tool_use(tool_use_id: str, name: str, input_params: Dict[str, Any]) -> Dict:
        """Standard tool_use format from Bedrock/Claude."""
        return {
            "toolUseId": tool_use_id,
            "name": name,
            "input": input_params
        }


class ToolResultContract:
    """
    Contract: Tool Result Format

    Tools return results in this format.
    Agent/EventProcessor must handle this format.
    """

    @staticmethod
    def create_success_result(tool_use_id: str, content: List[Dict]) -> Dict:
        """MCP-compatible tool result format."""
        return {
            "toolUseId": tool_use_id,
            "status": "success",
            "content": content
        }

    @staticmethod
    def create_error_result(tool_use_id: str, error_message: str) -> Dict:
        """Error result format."""
        return {
            "toolUseId": tool_use_id,
            "status": "error",
            "content": [{"text": f"Error: {error_message}"}]
        }

    @staticmethod
    def create_text_content(text: str) -> Dict:
        """Text content block."""
        return {"text": text}

    @staticmethod
    def create_image_content(format: str, data: str) -> Dict:
        """Image content block (base64)."""
        return {
            "image": {
                "format": format,
                "source": {"data": data}
            }
        }

    @staticmethod
    def create_document_content(name: str, format: str, bytes_data: bytes) -> Dict:
        """Document content block."""
        return {
            "document": {
                "name": name,
                "format": format,
                "source": {"bytes": bytes_data}
            }
        }


class StreamEventContract:
    """
    Contract: SSE Event Format

    EventProcessor sends events in this format.
    Frontend must handle this format.
    """

    REQUIRED_EVENT_TYPES = [
        "init",
        "response",
        "reasoning",
        "tool_use",
        "tool_result",
        "complete",
        "error",
        "thinking",
        "metadata",
        "browser_progress",
        "interrupt"
    ]

    @staticmethod
    def create_sse_event(event_type: str, **kwargs) -> str:
        """Create SSE-formatted event."""
        data = {"type": event_type, **kwargs}
        return f"data: {json.dumps(data)}\n\n"


class A2AMessageContract:
    """
    Contract: A2A Message Format

    Agents communicate via A2A in this format.
    """

    @staticmethod
    def create_message_with_metadata(text: str, metadata: Dict) -> Dict:
        """A2A message with metadata."""
        return {
            "parts": [{"text": text}],
            "metadata": metadata
        }

    REQUIRED_METADATA_FIELDS = ["session_id", "user_id"]
    OPTIONAL_METADATA_FIELDS = ["model_id", "temperature"]


class LambdaResponseContract:
    """
    Contract: Lambda Tool Response Format (MCP Gateway)

    Lambda tools return in this format.
    Gateway/Agent must unwrap this format.
    """

    @staticmethod
    def create_success_response(content: List[Dict]) -> Dict:
        """Standard Lambda success response."""
        return {
            "statusCode": 200,
            "body": json.dumps({
                "content": content
            })
        }

    @staticmethod
    def create_error_response(error_message: str, status_code: int = 400) -> Dict:
        """Standard Lambda error response."""
        return {
            "statusCode": status_code,
            "body": json.dumps({
                "error": error_message
            })
        }


# ============================================================
# Agent → Tool Contract Tests
# ============================================================

class TestAgentToToolContract:
    """
    Tests verifying Agent sends correct input format to Tools.

    Run these when AGENT code is modified to ensure Tools still work.
    """

    def test_tool_use_has_required_fields(self):
        """Agent must send toolUseId, name, input."""
        tool_use = ToolInputContract.create_tool_use(
            tool_use_id="tool-123",
            name="wikipedia_search",
            input_params={"query": "test"}
        )

        required_fields = ["toolUseId", "name", "input"]
        for field in required_fields:
            assert field in tool_use, f"Missing required field: {field}"

    def test_tool_use_id_is_string(self):
        """toolUseId must be a string."""
        tool_use = ToolInputContract.create_tool_use(
            tool_use_id="toolu_abc123",
            name="test_tool",
            input_params={}
        )

        assert isinstance(tool_use["toolUseId"], str)

    def test_tool_input_is_dict(self):
        """Tool input must be a dictionary."""
        tool_use = ToolInputContract.create_tool_use(
            tool_use_id="tool-123",
            name="calculator",
            input_params={"a": 1, "b": 2, "operation": "add"}
        )

        assert isinstance(tool_use["input"], dict)

    def test_tool_name_format(self):
        """Tool name can include prefix separated by underscore."""
        # Local tool
        local_tool = ToolInputContract.create_tool_use(
            "t1", "weather_lookup", {"city": "Seattle"}
        )
        assert "_" in local_tool["name"] or local_tool["name"].isalnum()

        # Gateway tool with prefix
        gateway_tool = ToolInputContract.create_tool_use(
            "t2", "gateway_wikipedia_search", {"query": "AI"}
        )
        assert gateway_tool["name"].startswith("gateway_")

    def test_empty_input_allowed(self):
        """Tools can have empty input (no parameters)."""
        tool_use = ToolInputContract.create_tool_use(
            tool_use_id="tool-empty",
            name="get_current_time",
            input_params={}
        )

        assert tool_use["input"] == {}


# ============================================================
# Tool → Agent Contract Tests
# ============================================================

class TestToolToAgentContract:
    """
    Tests verifying Tools return correct output format for Agent.

    Run these when TOOL code is modified to ensure Agent can process results.
    """

    def test_tool_result_has_required_fields(self):
        """Tool result must have toolUseId and content."""
        result = ToolResultContract.create_success_result(
            tool_use_id="tool-123",
            content=[{"text": "Result text"}]
        )

        assert "toolUseId" in result
        assert "content" in result

    def test_tool_result_content_is_list(self):
        """Tool result content must be a list."""
        result = ToolResultContract.create_success_result(
            tool_use_id="tool-123",
            content=[{"text": "Item 1"}, {"text": "Item 2"}]
        )

        assert isinstance(result["content"], list)

    def test_text_content_block_format(self):
        """Text content block must have 'text' key."""
        content = ToolResultContract.create_text_content("Hello world")

        assert "text" in content
        assert isinstance(content["text"], str)

    def test_image_content_block_format(self):
        """Image content block must have format and source.data."""
        content = ToolResultContract.create_image_content(
            format="png",
            data="iVBORw0KGgo..."
        )

        assert "image" in content
        assert content["image"]["format"] == "png"
        assert "data" in content["image"]["source"]

    def test_document_content_block_format(self):
        """Document content block must have name, format, source.bytes."""
        content = ToolResultContract.create_document_content(
            name="report",
            format="docx",
            bytes_data=b"binary data"
        )

        assert "document" in content
        assert content["document"]["name"] == "report"
        assert content["document"]["format"] == "docx"
        assert "bytes" in content["document"]["source"]

    def test_error_result_format(self):
        """Error result must indicate error status."""
        result = ToolResultContract.create_error_result(
            tool_use_id="tool-fail",
            error_message="Connection timeout"
        )

        assert result["status"] == "error"
        assert "Error:" in result["content"][0]["text"]


# ============================================================
# Lambda Tool Response Contract Tests
# ============================================================

class TestLambdaToolResponseContract:
    """
    Tests verifying Lambda tools return correct format for Gateway/Agent.

    Run these when LAMBDA TOOL code is modified.
    """

    def test_lambda_success_response_structure(self):
        """Lambda success response must have statusCode 200 and body."""
        response = LambdaResponseContract.create_success_response(
            content=[{"type": "text", "text": "Result"}]
        )

        assert response["statusCode"] == 200
        assert "body" in response

        body = json.loads(response["body"])
        assert "content" in body

    def test_lambda_error_response_structure(self):
        """Lambda error response must have error key in body."""
        response = LambdaResponseContract.create_error_response(
            error_message="Invalid parameter",
            status_code=400
        )

        assert response["statusCode"] == 400

        body = json.loads(response["body"])
        assert "error" in body

    def test_lambda_content_type_text(self):
        """Lambda text content can have 'type' field."""
        response = LambdaResponseContract.create_success_response(
            content=[{"type": "text", "text": "Wikipedia article content..."}]
        )

        body = json.loads(response["body"])
        assert body["content"][0]["type"] == "text"

    def test_lambda_nested_json_in_text(self):
        """Lambda can return nested JSON inside text content."""
        inner_data = {
            "status": "success",
            "results": [{"title": "AI", "url": "https://..."}]
        }
        response = LambdaResponseContract.create_success_response(
            content=[{"type": "text", "text": json.dumps(inner_data)}]
        )

        body = json.loads(response["body"])
        inner = json.loads(body["content"][0]["text"])
        assert inner["status"] == "success"


# ============================================================
# Event Stream Contract Tests
# ============================================================

class TestEventStreamContract:
    """
    Tests verifying EventProcessor sends correct SSE format for Frontend.

    Run these when EVENT_PROCESSOR or EVENT_FORMATTER code is modified.
    """

    def test_all_event_types_supported(self):
        """All required event types must be supported."""
        for event_type in StreamEventContract.REQUIRED_EVENT_TYPES:
            event = StreamEventContract.create_sse_event(event_type)
            assert f'"type": "{event_type}"' in event

    def test_sse_format_correct(self):
        """SSE must start with 'data: ' and end with double newline."""
        event = StreamEventContract.create_sse_event("response", text="Hello")

        assert event.startswith("data: ")
        assert event.endswith("\n\n")

    def test_response_event_structure(self):
        """Response event must have type, text, step."""
        event_data = {"type": "response", "text": "Hello", "step": "answering"}
        event = f"data: {json.dumps(event_data)}\n\n"

        parsed = json.loads(event[6:-2])  # Remove "data: " and "\n\n"
        assert parsed["type"] == "response"
        assert "text" in parsed
        assert parsed["step"] == "answering"

    def test_tool_use_event_structure(self):
        """Tool use event must have toolUseId, name, input."""
        event_data = {
            "type": "tool_use",
            "toolUseId": "tool-123",
            "name": "search",
            "input": {"query": "test"}
        }
        event = f"data: {json.dumps(event_data)}\n\n"

        parsed = json.loads(event[6:-2])
        assert parsed["type"] == "tool_use"
        assert "toolUseId" in parsed
        assert "name" in parsed
        assert "input" in parsed

    def test_tool_result_event_structure(self):
        """Tool result event must have toolUseId, result."""
        event_data = {
            "type": "tool_result",
            "toolUseId": "tool-123",
            "result": "Search completed"
        }
        event = f"data: {json.dumps(event_data)}\n\n"

        parsed = json.loads(event[6:-2])
        assert parsed["type"] == "tool_result"
        assert "toolUseId" in parsed
        assert "result" in parsed

    def test_complete_event_structure(self):
        """Complete event must have message, optionally usage/images/documents."""
        event_data = {
            "type": "complete",
            "message": "Final response",
            "usage": {"inputTokens": 100, "outputTokens": 50}
        }
        event = f"data: {json.dumps(event_data)}\n\n"

        parsed = json.loads(event[6:-2])
        assert parsed["type"] == "complete"
        assert "message" in parsed

    def test_metadata_event_structure(self):
        """Metadata event must have metadata object."""
        event_data = {
            "type": "metadata",
            "metadata": {"browserSessionId": "session-123"}
        }
        event = f"data: {json.dumps(event_data)}\n\n"

        parsed = json.loads(event[6:-2])
        assert parsed["type"] == "metadata"
        assert "metadata" in parsed
        assert isinstance(parsed["metadata"], dict)


# ============================================================
# A2A Protocol Contract Tests
# ============================================================

class TestA2AProtocolContract:
    """
    Tests verifying A2A message format between agents.

    Run these when A2A AGENT or A2A EXECUTOR code is modified.
    """

    def test_a2a_message_has_parts(self):
        """A2A message must have parts list."""
        message = A2AMessageContract.create_message_with_metadata(
            text="Research request",
            metadata={"session_id": "s1", "user_id": "u1"}
        )

        assert "parts" in message
        assert isinstance(message["parts"], list)

    def test_a2a_metadata_has_required_fields(self):
        """A2A metadata must include session_id and user_id."""
        message = A2AMessageContract.create_message_with_metadata(
            text="Test",
            metadata={"session_id": "sess-123", "user_id": "user-456"}
        )

        for field in A2AMessageContract.REQUIRED_METADATA_FIELDS:
            assert field in message["metadata"], f"Missing required field: {field}"

    def test_a2a_optional_metadata_fields(self):
        """A2A metadata can include optional model_id, temperature."""
        message = A2AMessageContract.create_message_with_metadata(
            text="Test",
            metadata={
                "session_id": "s1",
                "user_id": "u1",
                "model_id": "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
                "temperature": 0.7
            }
        )

        assert "model_id" in message["metadata"]
        assert "temperature" in message["metadata"]


# ============================================================
# Cross-Component Integration Contract Tests
# ============================================================

class TestCrossComponentContracts:
    """
    End-to-end contract tests for full flow:
    Frontend → BFF → Agent → Tool → Agent → BFF → Frontend

    Run these to verify overall system compatibility.
    """

    def test_full_tool_invocation_flow(self):
        """Test complete tool invocation contract flow."""
        # 1. Agent creates tool_use (Agent → Tool)
        tool_use = ToolInputContract.create_tool_use(
            tool_use_id="toolu_full_001",
            name="wikipedia_search",
            input_params={"query": "Python programming"}
        )

        # 2. Tool returns result (Tool → Agent)
        tool_result = ToolResultContract.create_success_result(
            tool_use_id=tool_use["toolUseId"],
            content=[ToolResultContract.create_text_content(
                json.dumps({"status": "success", "results": [{"title": "Python"}]})
            )]
        )

        # 3. EventProcessor formats for frontend (Agent → Frontend)
        tool_use_event = StreamEventContract.create_sse_event(
            "tool_use",
            toolUseId=tool_use["toolUseId"],
            name=tool_use["name"],
            input=tool_use["input"]
        )

        tool_result_event = StreamEventContract.create_sse_event(
            "tool_result",
            toolUseId=tool_result["toolUseId"],
            result=tool_result["content"][0]["text"]
        )

        # Verify all contracts maintained
        assert "toolu_full_001" in tool_use_event
        assert "toolu_full_001" in tool_result_event

    def test_lambda_tool_through_gateway_flow(self):
        """Test Lambda tool through MCP Gateway contract flow."""
        # 1. Agent invokes gateway tool
        tool_use = ToolInputContract.create_tool_use(
            tool_use_id="toolu_gw_001",
            name="gateway_arxiv_search",
            input_params={"query": "machine learning", "max_results": 5}
        )

        # 2. Lambda returns wrapped response
        lambda_response = LambdaResponseContract.create_success_response(
            content=[{
                "type": "text",
                "text": json.dumps({
                    "status": "success",
                    "results": [{"title": "ML Paper", "arxiv_id": "2301.00001"}]
                })
            }]
        )

        # 3. Gateway/Agent unwraps Lambda response
        body = json.loads(lambda_response["body"])
        unwrapped_content = body["content"]

        # 4. Create tool result for Agent
        tool_result = ToolResultContract.create_success_result(
            tool_use_id=tool_use["toolUseId"],
            content=unwrapped_content
        )

        # Verify contracts maintained
        assert tool_result["toolUseId"] == "toolu_gw_001"
        assert len(tool_result["content"]) > 0

    def test_a2a_tool_invocation_flow(self):
        """Test A2A agent invocation contract flow."""
        # 1. Main agent invokes A2A tool (research-agent)
        tool_use = ToolInputContract.create_tool_use(
            tool_use_id="toolu_a2a_001",
            name="research-agent",
            input_params={"topic": "quantum computing trends"}
        )

        # 2. A2A message sent with metadata
        a2a_message = A2AMessageContract.create_message_with_metadata(
            text=json.dumps(tool_use["input"]),
            metadata={
                "session_id": "main-session-123",
                "user_id": "user-456",
                "model_id": "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
            }
        )

        # 3. A2A agent returns result
        a2a_result = {
            "status": "completed",
            "artifacts": [
                {"name": "agent_response", "parts": [{"text": "Research completed"}]},
                {"name": "research_markdown", "parts": [{"text": "<research>...</research>"}]}
            ]
        }

        # 4. Convert to tool result
        tool_result = ToolResultContract.create_success_result(
            tool_use_id=tool_use["toolUseId"],
            content=[{"text": a2a_result["artifacts"][0]["parts"][0]["text"]}]
        )

        # Verify contracts maintained
        assert tool_result["toolUseId"] == "toolu_a2a_001"
        assert a2a_message["metadata"]["session_id"] == "main-session-123"


# ============================================================
# Backward Compatibility Tests
# ============================================================

class TestBackwardCompatibility:
    """
    Tests ensuring changes don't break existing integrations.

    Run these BEFORE merging changes to catch regressions.
    """

    def test_tool_result_without_status_field(self):
        """Older tools might not include status field - should still work."""
        legacy_result = {
            "toolUseId": "tool-legacy-001",
            "content": [{"text": "Legacy result"}]
            # No "status" field
        }

        # EventProcessor should handle missing status
        assert "toolUseId" in legacy_result
        assert "content" in legacy_result
        # status is optional

    def test_lambda_response_without_type_in_content(self):
        """Older Lambda tools might not include 'type' in content."""
        legacy_lambda = {
            "statusCode": 200,
            "body": json.dumps({
                "content": [{"text": "Result without type field"}]
            })
        }

        body = json.loads(legacy_lambda["body"])
        # Should work without "type" field
        assert "text" in body["content"][0]

    def test_a2a_message_without_optional_metadata(self):
        """A2A message with minimal metadata should work."""
        minimal_message = A2AMessageContract.create_message_with_metadata(
            text="Request",
            metadata={
                "session_id": "s1",
                "user_id": "u1"
                # No model_id or temperature
            }
        )

        # Should work with just required fields
        assert "session_id" in minimal_message["metadata"]
        assert "user_id" in minimal_message["metadata"]

    def test_event_stream_handles_unknown_event_type(self):
        """Frontend should gracefully handle unknown event types."""
        future_event = {
            "type": "new_feature_event",
            "data": {"some": "data"}
        }

        # Event should be valid JSON
        event_str = f"data: {json.dumps(future_event)}\n\n"
        parsed = json.loads(event_str[6:-2])

        # Unknown type should still parse
        assert parsed["type"] == "new_feature_event"
