"""
Unit tests for LocalSessionBuffer.

Tests message buffering, flushing, format handling, and bytes encoding.
"""
import json
import os
import pytest
from unittest.mock import MagicMock

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../src'))

from agent.local_session_buffer import LocalSessionBuffer, encode_bytes_for_json


class TestLocalSessionBuffer:
    """Tests for LocalSessionBuffer class."""

    @pytest.fixture
    def mock_file_session_manager(self, tmp_path):
        """Create a mock FileSessionManager."""
        manager = MagicMock()
        manager.storage_dir = str(tmp_path)
        return manager

    @pytest.fixture
    def session_buffer(self, mock_file_session_manager):
        """Create a LocalSessionBuffer instance."""
        return LocalSessionBuffer(
            base_manager=mock_file_session_manager,
            session_id="test_session_123",
            batch_size=5
        )

    @pytest.fixture
    def setup_session_dir(self, tmp_path):
        """Set up session directory structure."""
        session_dir = tmp_path / "session_test_session_123" / "agents" / "agent_default" / "messages"
        session_dir.mkdir(parents=True)
        return session_dir

    # ============================================================
    # Message Appending Tests
    # ============================================================

    def test_append_message_plain_dict(self, session_buffer):
        """Test appending a plain dict message."""
        message = {
            "role": "assistant",
            "content": [{"text": "Hello, world!"}]
        }
        mock_agent = MagicMock()

        session_buffer.append_message(message, mock_agent)

        assert len(session_buffer.pending_messages) == 1
        assert session_buffer.pending_messages[0]["role"] == "assistant"
        assert session_buffer.pending_messages[0]["content"] == [{"text": "Hello, world!"}]

    def test_append_message_with_message_key(self, session_buffer):
        """Test appending a message wrapped in 'message' key."""
        message = {
            "message": {
                "role": "user",
                "content": [{"text": "Hello"}]
            }
        }
        mock_agent = MagicMock()

        session_buffer.append_message(message, mock_agent)

        assert len(session_buffer.pending_messages) == 1
        assert session_buffer.pending_messages[0]["role"] == "user"

    def test_append_message_session_message_object(self, session_buffer):
        """Test appending a SessionMessage-like object."""
        message = MagicMock()
        message.message = {"role": "assistant", "content": [{"text": "Response"}]}
        mock_agent = MagicMock()

        session_buffer.append_message(message, mock_agent)

        assert len(session_buffer.pending_messages) == 1
        assert session_buffer.pending_messages[0]["role"] == "assistant"

    def test_append_stores_agent_reference(self, session_buffer):
        """Test that agent reference is stored for flush."""
        message = {"role": "user", "content": [{"text": "Test"}]}
        mock_agent = MagicMock()
        mock_agent.agent_id = "test_agent"

        session_buffer.append_message(message, mock_agent)

        assert session_buffer._last_agent == mock_agent

    # ============================================================
    # Batch Flushing Tests
    # ============================================================

    def test_auto_flush_on_batch_size(self, session_buffer, mock_file_session_manager, setup_session_dir):
        """Test automatic flush when batch size is reached."""
        mock_agent = MagicMock()

        # Append messages up to batch size
        for i in range(5):
            message = {"role": "user", "content": [{"text": f"Message {i}"}]}
            session_buffer.append_message(message, mock_agent)

        # Buffer should be empty after auto-flush
        assert len(session_buffer.pending_messages) == 0

    def test_no_auto_flush_below_batch_size(self, session_buffer):
        """Test no flush when below batch size."""
        mock_agent = MagicMock()

        # Append fewer messages than batch size
        for i in range(3):
            message = {"role": "user", "content": [{"text": f"Message {i}"}]}
            session_buffer.append_message(message, mock_agent)

        # Buffer should still have messages
        assert len(session_buffer.pending_messages) == 3

    # ============================================================
    # Flush Tests
    # ============================================================

    def test_flush_writes_to_file(self, session_buffer, mock_file_session_manager, setup_session_dir):
        """Test that flush writes messages to file."""
        message = {"role": "assistant", "content": [{"text": "Test response"}]}
        mock_agent = MagicMock()

        session_buffer.append_message(message, mock_agent)
        session_buffer.flush()

        # Check file was created
        message_file = setup_session_dir / "message_0.json"
        assert message_file.exists()

        # Verify content
        with open(message_file) as f:
            saved = json.load(f)
        assert saved["message"]["role"] == "assistant"
        assert saved["message"]["content"][0]["text"] == "Test response"

    def test_flush_clears_pending_messages(self, session_buffer, mock_file_session_manager, setup_session_dir):
        """Test that flush clears the pending messages buffer."""
        message = {"role": "user", "content": [{"text": "Test"}]}
        mock_agent = MagicMock()

        session_buffer.append_message(message, mock_agent)
        assert len(session_buffer.pending_messages) == 1

        session_buffer.flush()
        assert len(session_buffer.pending_messages) == 0

    def test_flush_empty_buffer_no_op(self, session_buffer):
        """Test that flushing empty buffer does nothing."""
        session_buffer.flush()  # Should not raise

    def test_flush_increments_message_index(self, session_buffer, mock_file_session_manager, setup_session_dir):
        """Test that message indices increment correctly across flushes."""
        mock_agent = MagicMock()

        # First message
        session_buffer.append_message({"role": "user", "content": [{"text": "First"}]}, mock_agent)
        session_buffer.flush()

        # Second message
        session_buffer.append_message({"role": "assistant", "content": [{"text": "Second"}]}, mock_agent)
        session_buffer.flush()

        # Check both files exist with correct indices
        assert (setup_session_dir / "message_0.json").exists()
        assert (setup_session_dir / "message_1.json").exists()

    # ============================================================
    # Message Format Tests
    # ============================================================

    def test_saved_message_has_correct_structure(self, session_buffer, mock_file_session_manager, setup_session_dir):
        """Test that saved message has SessionMessage-compatible structure."""
        message = {"role": "assistant", "content": [{"text": "Hello"}]}
        mock_agent = MagicMock()

        session_buffer.append_message(message, mock_agent)
        session_buffer.flush()

        with open(setup_session_dir / "message_0.json") as f:
            saved = json.load(f)

        # Verify structure matches SessionMessage format
        assert "message" in saved
        assert "message_id" in saved
        assert "created_at" in saved
        assert "updated_at" in saved
        assert saved["message"]["role"] == "assistant"
        assert saved["message"]["content"] == [{"text": "Hello"}]

    def test_no_double_wrapping(self, session_buffer, mock_file_session_manager, setup_session_dir):
        """Test that messages are not double-wrapped in 'message' key."""
        message = {"role": "assistant", "content": [{"text": "Test"}]}
        mock_agent = MagicMock()

        session_buffer.append_message(message, mock_agent)
        session_buffer.flush()

        with open(setup_session_dir / "message_0.json") as f:
            saved = json.load(f)

        # Should be single wrap: {message: {role, content}, message_id, ...}
        # NOT double wrap: {message: {message: {role, content}, ...}, ...}
        assert "message" in saved
        assert "role" in saved["message"]
        assert "message" not in saved["message"]  # No double wrap


class TestLocalSessionBufferInterruptedResponse:
    """Tests for handling interrupted responses."""

    @pytest.fixture
    def session_buffer_with_setup(self, tmp_path):
        """Create session buffer with directory setup."""
        manager = MagicMock()
        manager.storage_dir = str(tmp_path)

        buffer = LocalSessionBuffer(
            base_manager=manager,
            session_id="interrupt_test_session",
            batch_size=5
        )

        # Create directory structure
        messages_dir = tmp_path / "session_interrupt_test_session" / "agents" / "agent_default" / "messages"
        messages_dir.mkdir(parents=True)

        return buffer, messages_dir

    def test_interrupted_response_saved_correctly(self, session_buffer_with_setup):
        """Test that interrupted responses are saved with marker."""
        buffer, messages_dir = session_buffer_with_setup
        mock_agent = MagicMock()

        # Simulate interrupted response
        partial_text = "This is a partial response that was"
        interrupted_message = {
            "role": "assistant",
            "content": [{"text": f"{partial_text}\n\n**[Response interrupted by user]**"}]
        }

        buffer.append_message(interrupted_message, mock_agent)
        buffer.flush()

        # Verify saved content
        with open(messages_dir / "message_0.json") as f:
            saved = json.load(f)

        content_text = saved["message"]["content"][0]["text"]
        assert partial_text in content_text
        assert "[Response interrupted by user]" in content_text


class TestEncodeBytesForJson:
    """Tests for encode_bytes_for_json function.

    This is still needed for Local mode where images and PDFs are sent as
    ContentBlocks with bytes data.
    """

    def test_encode_simple_bytes(self):
        """Test encoding simple bytes value."""
        data = b"Hello World"
        result = encode_bytes_for_json(data)

        assert isinstance(result, dict)
        assert result["__bytes_encoded__"] is True
        assert "data" in result
        # Verify base64 encoding
        import base64
        assert base64.b64decode(result["data"]) == data

    def test_encode_image_bytes(self):
        """Test encoding image-like bytes (PNG header)."""
        # PNG file signature
        png_header = b'\x89PNG\r\n\x1a\n' + b'\x00' * 100
        result = encode_bytes_for_json(png_header)

        assert result["__bytes_encoded__"] is True
        import base64
        assert base64.b64decode(result["data"]) == png_header

    def test_encode_bytes_in_dict(self):
        """Test encoding bytes nested in a dict."""
        data = {
            "role": "user",
            "content": [
                {
                    "image": {
                        "format": "png",
                        "source": {
                            "bytes": b"fake_image_data"
                        }
                    }
                }
            ]
        }

        result = encode_bytes_for_json(data)

        # Structure should be preserved
        assert result["role"] == "user"
        assert result["content"][0]["image"]["format"] == "png"
        # Bytes should be encoded
        source = result["content"][0]["image"]["source"]["bytes"]
        assert source["__bytes_encoded__"] is True

    def test_encode_bytes_in_list(self):
        """Test encoding bytes in a list."""
        data = [b"first", "second", b"third"]
        result = encode_bytes_for_json(data)

        assert result[0]["__bytes_encoded__"] is True
        assert result[1] == "second"  # String unchanged
        assert result[2]["__bytes_encoded__"] is True

    def test_encode_no_bytes(self):
        """Test that non-bytes values are returned unchanged."""
        data = {
            "role": "assistant",
            "content": [{"text": "Hello"}]
        }

        result = encode_bytes_for_json(data)

        assert result == data

    def test_encode_empty_bytes(self):
        """Test encoding empty bytes."""
        result = encode_bytes_for_json(b"")

        assert result["__bytes_encoded__"] is True
        assert result["data"] == ""  # Empty base64

    def test_encode_nested_mixed_content(self):
        """Test encoding deeply nested structure with mixed content types."""
        data = {
            "message": {
                "content": [
                    {"text": "Check this image:"},
                    {
                        "image": {
                            "format": "jpeg",
                            "source": {"bytes": b"\xff\xd8\xff"}  # JPEG header
                        }
                    },
                    {
                        "document": {
                            "format": "pdf",
                            "name": "report",
                            "source": {"bytes": b"%PDF-1.4"}  # PDF header
                        }
                    }
                ]
            },
            "metadata": {
                "timestamp": "2024-01-01T00:00:00Z",
                "count": 42
            }
        }

        result = encode_bytes_for_json(data)

        # Text should be unchanged
        assert result["message"]["content"][0]["text"] == "Check this image:"
        # Image bytes should be encoded
        assert result["message"]["content"][1]["image"]["source"]["bytes"]["__bytes_encoded__"] is True
        # Document bytes should be encoded
        assert result["message"]["content"][2]["document"]["source"]["bytes"]["__bytes_encoded__"] is True
        # Metadata should be unchanged
        assert result["metadata"]["timestamp"] == "2024-01-01T00:00:00Z"
        assert result["metadata"]["count"] == 42


class TestLocalSessionBufferBytesHandling:
    """Tests for LocalSessionBuffer handling messages with bytes content.

    Local mode needs to handle bytes in ContentBlocks for:
    - Images (PNG, JPEG, etc.)
    - Documents (PDF, etc.)
    """

    @pytest.fixture
    def session_buffer_with_setup(self, tmp_path):
        """Create session buffer with directory setup."""
        manager = MagicMock()
        manager.storage_dir = str(tmp_path)

        buffer = LocalSessionBuffer(
            base_manager=manager,
            session_id="bytes_test_session",
            batch_size=5
        )

        # Create directory structure
        messages_dir = tmp_path / "session_bytes_test_session" / "agents" / "agent_default" / "messages"
        messages_dir.mkdir(parents=True)

        return buffer, messages_dir

    def test_flush_message_with_image_bytes(self, session_buffer_with_setup):
        """Test flushing message containing image bytes."""
        buffer, messages_dir = session_buffer_with_setup
        mock_agent = MagicMock()

        # Message with image ContentBlock
        image_bytes = b'\x89PNG\r\n\x1a\n' + b'\x00' * 50
        message = {
            "role": "user",
            "content": [
                {"text": "What's in this image?"},
                {
                    "image": {
                        "format": "png",
                        "source": {"bytes": image_bytes}
                    }
                }
            ]
        }

        buffer.append_message(message, mock_agent)
        buffer.flush()

        # Verify file was created and is valid JSON
        with open(messages_dir / "message_0.json") as f:
            saved = json.load(f)

        # Verify structure
        assert saved["message"]["role"] == "user"
        assert saved["message"]["content"][0]["text"] == "What's in this image?"

        # Verify bytes were encoded
        image_source = saved["message"]["content"][1]["image"]["source"]["bytes"]
        assert image_source["__bytes_encoded__"] is True

        # Verify we can decode back to original
        import base64
        decoded = base64.b64decode(image_source["data"])
        assert decoded == image_bytes

    def test_flush_message_with_document_bytes(self, session_buffer_with_setup):
        """Test flushing message containing document (PDF) bytes."""
        buffer, messages_dir = session_buffer_with_setup
        mock_agent = MagicMock()

        # Message with PDF document ContentBlock
        pdf_bytes = b'%PDF-1.4 fake pdf content'
        message = {
            "role": "user",
            "content": [
                {"text": "Summarize this document"},
                {
                    "document": {
                        "format": "pdf",
                        "name": "report",
                        "source": {"bytes": pdf_bytes}
                    }
                }
            ]
        }

        buffer.append_message(message, mock_agent)
        buffer.flush()

        # Verify file was created and is valid JSON
        with open(messages_dir / "message_0.json") as f:
            saved = json.load(f)

        # Verify bytes were encoded
        doc_source = saved["message"]["content"][1]["document"]["source"]["bytes"]
        assert doc_source["__bytes_encoded__"] is True

    def test_flush_message_mixed_content(self, session_buffer_with_setup):
        """Test flushing message with multiple content types including bytes."""
        buffer, messages_dir = session_buffer_with_setup
        mock_agent = MagicMock()

        message = {
            "role": "user",
            "content": [
                {"text": "Compare these:"},
                {
                    "image": {
                        "format": "jpeg",
                        "source": {"bytes": b"\xff\xd8\xff\xe0"}
                    }
                },
                {
                    "document": {
                        "format": "pdf",
                        "name": "doc1",
                        "source": {"bytes": b"%PDF"}
                    }
                }
            ]
        }

        buffer.append_message(message, mock_agent)
        buffer.flush()

        with open(messages_dir / "message_0.json") as f:
            saved = json.load(f)

        # All bytes should be encoded
        assert saved["message"]["content"][1]["image"]["source"]["bytes"]["__bytes_encoded__"] is True
        assert saved["message"]["content"][2]["document"]["source"]["bytes"]["__bytes_encoded__"] is True

    def test_flush_assistant_response_no_bytes(self, session_buffer_with_setup):
        """Test that assistant text responses (no bytes) work correctly."""
        buffer, messages_dir = session_buffer_with_setup
        mock_agent = MagicMock()

        message = {
            "role": "assistant",
            "content": [{"text": "This is a simple text response."}]
        }

        buffer.append_message(message, mock_agent)
        buffer.flush()

        with open(messages_dir / "message_0.json") as f:
            saved = json.load(f)

        # Should remain unchanged
        assert saved["message"]["content"][0]["text"] == "This is a simple text response."
