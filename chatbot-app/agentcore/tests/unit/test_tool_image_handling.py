"""
Unit tests for tool image handling.

Tests that:
1. Tools returning images produce correct format
2. Event formatter correctly processes image bytes → base64
3. Image tool results are correctly structured for Strands Agent
4. Frontend receives properly formatted image data
"""
import base64
import json
import pytest
from unittest.mock import MagicMock, patch, ANY
from typing import Dict, Any, List


# ============================================================
# Test Fixtures
# ============================================================

@pytest.fixture
def sample_png_bytes():
    """Create minimal valid PNG bytes for testing."""
    # PNG header (8 bytes) + minimal IHDR chunk
    png_header = b'\x89PNG\r\n\x1a\n'
    # Minimal IHDR chunk (width=1, height=1, bit_depth=8, color_type=0)
    ihdr_data = b'\x00\x00\x00\x01\x00\x00\x00\x01\x08\x00\x00\x00\x00'
    ihdr_crc = b'\x1d\x0d\x10\x02'  # CRC for this IHDR
    ihdr_chunk = b'\x00\x00\x00\r' + b'IHDR' + ihdr_data + ihdr_crc
    # IEND chunk
    iend_chunk = b'\x00\x00\x00\x00' + b'IEND' + b'\xaeB`\x82'

    return png_header + ihdr_chunk + iend_chunk


@pytest.fixture
def sample_jpeg_bytes():
    """Create minimal JPEG header for testing."""
    # JPEG magic bytes (SOI marker)
    return b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01'


@pytest.fixture
def diagram_tool_result(sample_png_bytes):
    """Sample diagram tool result with image."""
    return {
        "content": [
            {"text": "✅ Diagram generated: chart.png\n\nSize: 1.5 KB"},
            {
                "image": {
                    "format": "png",
                    "source": {
                        "bytes": sample_png_bytes
                    }
                }
            }
        ],
        "status": "success"
    }


# ============================================================
# Tool Result Image Format Tests
# ============================================================

class TestToolResultImageFormat:
    """Tests for tool result image format compliance."""

    def test_diagram_tool_returns_image_in_content(self, diagram_tool_result):
        """Test that diagram tool result has image in content array."""
        content = diagram_tool_result["content"]

        # Should have 2 items: text and image
        assert len(content) == 2
        assert "text" in content[0]
        assert "image" in content[1]

    def test_image_block_structure(self, diagram_tool_result):
        """Test image block has correct structure for Strands."""
        image_block = diagram_tool_result["content"][1]["image"]

        # Required fields for Strands/Bedrock
        assert "format" in image_block
        assert "source" in image_block
        assert "bytes" in image_block["source"]

        # Format should be valid
        assert image_block["format"] in ["png", "jpeg", "gif", "webp"]

    def test_image_bytes_are_raw_bytes(self, diagram_tool_result, sample_png_bytes):
        """Test that image source contains raw bytes (not base64)."""
        image_source = diagram_tool_result["content"][1]["image"]["source"]

        # Should be raw bytes
        assert isinstance(image_source["bytes"], bytes)
        assert image_source["bytes"] == sample_png_bytes

        # Verify it's NOT base64 encoded string
        assert not isinstance(image_source["bytes"], str)

    def test_strands_toolresult_format(self, sample_png_bytes):
        """Test complete ToolResult format as Strands expects."""
        # This is how a tool should return image results
        tool_result = {
            "content": [
                {"text": "Generated image successfully"},
                {
                    "image": {
                        "format": "png",
                        "source": {
                            "bytes": sample_png_bytes
                        }
                    }
                }
            ],
            "status": "success"
        }

        # Verify structure
        assert "content" in tool_result
        assert isinstance(tool_result["content"], list)

        # Find image block
        image_blocks = [c for c in tool_result["content"] if "image" in c]
        assert len(image_blocks) == 1

        # Image should have bytes (raw, not base64)
        assert isinstance(image_blocks[0]["image"]["source"]["bytes"], bytes)


# ============================================================
# Event Formatter Image Processing Tests
# ============================================================

class TestEventFormatterImageProcessing:
    """Tests for event_formatter handling of image bytes."""

    def test_extract_basic_content_with_image(self, diagram_tool_result, sample_png_bytes):
        """Test _extract_basic_content extracts image and converts to base64."""
        from streaming.event_formatter import StreamEventFormatter

        # Wrap in toolUseId format (as received from Strands)
        tool_result_with_id = {
            "toolUseId": "toolu_diagram_001",
            **diagram_tool_result
        }

        result_text, result_images = StreamEventFormatter._extract_basic_content(tool_result_with_id)

        # Should extract text
        assert "Diagram generated" in result_text

        # Should extract and convert image to base64
        assert len(result_images) == 1
        assert result_images[0]["format"] == "png"

        # Image data should be base64 string (not raw bytes)
        image_data = result_images[0]["data"]
        assert isinstance(image_data, str)

        # Verify it's valid base64
        decoded = base64.b64decode(image_data)
        assert decoded == sample_png_bytes

    def test_bytes_to_base64_conversion(self, sample_png_bytes):
        """Test direct bytes to base64 conversion."""
        from streaming.event_formatter import StreamEventFormatter

        tool_result = {
            "toolUseId": "toolu_001",
            "content": [
                {
                    "image": {
                        "format": "png",
                        "source": {
                            "bytes": sample_png_bytes
                        }
                    }
                }
            ]
        }

        result_text, result_images = StreamEventFormatter._extract_basic_content(tool_result)

        assert len(result_images) == 1
        # Should be base64 encoded
        assert isinstance(result_images[0]["data"], str)
        # Verify round-trip
        assert base64.b64decode(result_images[0]["data"]) == sample_png_bytes

    def test_already_base64_data_passthrough(self, sample_png_bytes):
        """Test that already-base64 data in 'data' field passes through."""
        from streaming.event_formatter import StreamEventFormatter

        # Some tools might return base64 in 'data' field
        base64_data = base64.b64encode(sample_png_bytes).decode('utf-8')

        tool_result = {
            "toolUseId": "toolu_001",
            "content": [
                {
                    "image": {
                        "format": "png",
                        "source": {
                            "data": base64_data  # Already base64
                        }
                    }
                }
            ]
        }

        result_text, result_images = StreamEventFormatter._extract_basic_content(tool_result)

        assert len(result_images) == 1
        assert result_images[0]["data"] == base64_data

    def test_create_tool_result_event_with_images(self, sample_png_bytes):
        """Test full tool_result event creation includes images."""
        from streaming.event_formatter import StreamEventFormatter

        tool_result = {
            "toolUseId": "toolu_diagram_001",
            "content": [
                {"text": "Chart created"},
                {
                    "image": {
                        "format": "png",
                        "source": {"bytes": sample_png_bytes}
                    }
                }
            ]
        }

        event_str = StreamEventFormatter.create_tool_result_event(tool_result)

        # Parse SSE event
        assert event_str.startswith("data: ")
        data = json.loads(event_str[6:-2])

        # Verify structure
        assert data["type"] == "tool_result"
        assert data["toolUseId"] == "toolu_diagram_001"
        assert "result" in data
        assert "images" in data

        # Verify image data
        assert len(data["images"]) == 1
        assert data["images"][0]["format"] == "png"
        assert isinstance(data["images"][0]["data"], str)  # base64


# ============================================================
# Strands Agent Image Context Tests
# ============================================================

class TestStrandsAgentImageContext:
    """Tests for image handling in Strands Agent context.

    When a tool returns an image, Strands Agent:
    1. Receives the tool result with image bytes
    2. Stores it in conversation history
    3. Can reference it in subsequent model calls
    """

    def test_tool_result_image_for_session_manager(self, sample_png_bytes):
        """Test tool result format is compatible with session manager storage."""
        # Tool result as Strands would store in session
        tool_result_message = {
            "role": "user",
            "content": [
                {
                    "toolResult": {
                        "toolUseId": "toolu_001",
                        "content": [
                            {"text": "Diagram generated"},
                            {
                                "image": {
                                    "format": "png",
                                    "source": {"bytes": sample_png_bytes}
                                }
                            }
                        ]
                    }
                }
            ]
        }

        # Verify structure for session manager
        assert tool_result_message["role"] == "user"
        tool_result = tool_result_message["content"][0]["toolResult"]
        assert "toolUseId" in tool_result
        assert "content" in tool_result

        # Image should be in content
        image_blocks = [c for c in tool_result["content"] if "image" in c]
        assert len(image_blocks) == 1

    def test_multiple_images_in_tool_result(self, sample_png_bytes, sample_jpeg_bytes):
        """Test tool result with multiple images."""
        tool_result = {
            "content": [
                {"text": "Generated 2 charts"},
                {
                    "image": {
                        "format": "png",
                        "source": {"bytes": sample_png_bytes}
                    }
                },
                {
                    "image": {
                        "format": "jpeg",
                        "source": {"bytes": sample_jpeg_bytes}
                    }
                }
            ],
            "status": "success"
        }

        image_blocks = [c for c in tool_result["content"] if "image" in c]
        assert len(image_blocks) == 2
        assert image_blocks[0]["image"]["format"] == "png"
        assert image_blocks[1]["image"]["format"] == "jpeg"

    def test_image_tool_result_json_serializable(self, sample_png_bytes):
        """Test that tool result with bytes can be JSON serialized (for storage)."""
        tool_result = {
            "toolUseId": "toolu_001",
            "content": [
                {"text": "Generated chart"},
                {
                    "image": {
                        "format": "png",
                        "source": {"bytes": sample_png_bytes}
                    }
                }
            ]
        }

        # Raw bytes are NOT JSON serializable
        with pytest.raises(TypeError):
            json.dumps(tool_result)

        # But base64-converted version is
        converted = {
            "toolUseId": "toolu_001",
            "content": [
                {"text": "Generated chart"},
                {
                    "image": {
                        "format": "png",
                        "source": {
                            "data": base64.b64encode(sample_png_bytes).decode('utf-8')
                        }
                    }
                }
            ]
        }

        # This should work
        json_str = json.dumps(converted)
        assert "image" in json_str


# ============================================================
# Code Interpreter Image Response Tests
# ============================================================

class TestCodeInterpreterImageResponse:
    """Tests for Code Interpreter tool image responses."""

    def test_code_interpreter_diagram_response_format(self, sample_png_bytes):
        """Test expected format from Code Interpreter diagram generation."""
        # Simulates what generate_chart / create_visual_design returns
        ci_response = {
            "content": [
                {
                    "text": """✅ **Diagram generated: revenue-chart.png**

Saved to workspace for reuse in documents.
**Size:** 15.2 KB
**Other images in workspace:** 2 images"""
                },
                {
                    "image": {
                        "format": "png",
                        "source": {
                            "bytes": sample_png_bytes  # Raw bytes from CI
                        }
                    }
                }
            ],
            "status": "success"
        }

        # Verify text content
        assert "Diagram generated" in ci_response["content"][0]["text"]
        assert "revenue-chart.png" in ci_response["content"][0]["text"]

        # Verify image content
        image_block = ci_response["content"][1]
        assert "image" in image_block
        assert image_block["image"]["format"] == "png"
        assert isinstance(image_block["image"]["source"]["bytes"], bytes)

    def test_code_interpreter_error_response(self):
        """Test Code Interpreter error response (no image)."""
        error_response = {
            "content": [
                {
                    "text": """❌ Python code execution failed

**Error Output:**
```
NameError: name 'undefined_var' is not defined
```

Please fix the error and try again."""
                }
            ],
            "status": "error"
        }

        assert error_response["status"] == "error"
        assert len(error_response["content"]) == 1
        assert "image" not in error_response["content"][0]


# ============================================================
# Frontend Image Display Tests
# ============================================================

class TestFrontendImageDisplay:
    """Tests for image data format as received by frontend."""

    def test_sse_event_image_format_for_frontend(self, sample_png_bytes):
        """Test SSE event has correct image format for frontend rendering."""
        from streaming.event_formatter import StreamEventFormatter

        tool_result = {
            "toolUseId": "toolu_001",
            "content": [
                {"text": "Chart ready"},
                {
                    "image": {
                        "format": "png",
                        "source": {"bytes": sample_png_bytes}
                    }
                }
            ]
        }

        event_str = StreamEventFormatter.create_tool_result_event(tool_result)
        data = json.loads(event_str[6:-2])

        # Frontend expects images array with format and data
        assert "images" in data
        image = data["images"][0]

        # Frontend will use: `data:image/${format};base64,${data}`
        assert "format" in image
        assert "data" in image

        # Verify base64 is valid for data URI
        expected_data_uri = f"data:image/{image['format']};base64,{image['data']}"
        assert expected_data_uri.startswith("data:image/png;base64,")

    def test_multiple_images_in_sse_event(self, sample_png_bytes):
        """Test multiple images are all included in SSE event."""
        from streaming.event_formatter import StreamEventFormatter

        tool_result = {
            "toolUseId": "toolu_001",
            "content": [
                {"text": "Multiple charts generated"},
                {"image": {"format": "png", "source": {"bytes": sample_png_bytes}}},
                {"image": {"format": "png", "source": {"bytes": sample_png_bytes}}},
            ]
        }

        event_str = StreamEventFormatter.create_tool_result_event(tool_result)
        data = json.loads(event_str[6:-2])

        assert len(data["images"]) == 2

    def test_empty_image_bytes_handling(self):
        """Test handling of empty/invalid image bytes."""
        from streaming.event_formatter import StreamEventFormatter

        tool_result = {
            "toolUseId": "toolu_001",
            "content": [
                {"text": "Result"},
                {
                    "image": {
                        "format": "png",
                        "source": {"bytes": b""}  # Empty bytes
                    }
                }
            ]
        }

        # Should not crash, but may not include empty image
        event_str = StreamEventFormatter.create_tool_result_event(tool_result)
        data = json.loads(event_str[6:-2])

        # Empty image data should be handled gracefully
        if "images" in data:
            for img in data["images"]:
                # Empty string is valid base64 (decodes to empty bytes)
                assert isinstance(img.get("data", ""), str)


# ============================================================
# Integration: Full Flow Tests
# ============================================================

class TestImageToolFullFlow:
    """Integration tests for complete image tool flow."""

    def test_diagram_tool_to_frontend_flow(self, sample_png_bytes):
        """Test full flow: tool return → event formatter → SSE → frontend data."""
        from streaming.event_formatter import StreamEventFormatter

        # 1. Tool returns result with raw bytes
        tool_output = {
            "content": [
                {"text": "✅ Diagram: chart.png\nSize: 10 KB"},
                {
                    "image": {
                        "format": "png",
                        "source": {"bytes": sample_png_bytes}
                    }
                }
            ],
            "status": "success"
        }

        # 2. Add toolUseId (as Strands does)
        tool_result = {
            "toolUseId": "toolu_diagram_123",
            **tool_output
        }

        # 3. Event formatter creates SSE event
        sse_event = StreamEventFormatter.create_tool_result_event(tool_result)

        # 4. Parse as frontend would
        assert sse_event.startswith("data: ")
        frontend_data = json.loads(sse_event[6:-2])

        # 5. Verify frontend can use the data
        assert frontend_data["type"] == "tool_result"
        assert frontend_data["toolUseId"] == "toolu_diagram_123"
        assert "Diagram: chart.png" in frontend_data["result"]

        # 6. Verify image is usable
        assert len(frontend_data["images"]) == 1
        img = frontend_data["images"][0]

        # Frontend would use:
        # <img src={`data:image/${img.format};base64,${img.data}`} />
        assert img["format"] == "png"
        decoded_bytes = base64.b64decode(img["data"])
        assert decoded_bytes == sample_png_bytes

    def test_tool_error_no_image_flow(self):
        """Test error flow doesn't include images."""
        from streaming.event_formatter import StreamEventFormatter

        error_result = {
            "toolUseId": "toolu_error_001",
            "content": [{"text": "❌ Failed to generate diagram: Invalid code"}],
            "status": "error"
        }

        sse_event = StreamEventFormatter.create_tool_result_event(error_result)
        frontend_data = json.loads(sse_event[6:-2])

        assert frontend_data["status"] == "error"
        # No images in error response
        assert "images" not in frontend_data or len(frontend_data.get("images", [])) == 0


# ============================================================
# Browser Tool JSON Serialization Tests
# ============================================================

class TestBrowserToolJsonSerialization:
    """Tests that browser tool results are JSON serializable.

    Browser tools return results that must be JSON serializable because
    they are sent directly to the Strands agent message creation which
    requires JSON encoding. Raw bytes will cause:
    'Object of type bytes is not JSON serializable'
    """

    def test_browser_navigate_result_json_serializable(self, sample_jpeg_bytes):
        """Test browser_navigate result format is JSON serializable.

        Browser tools use source.data (base64 string) instead of source.bytes (raw bytes)
        to ensure JSON serialization works with AgentCoreMemorySessionManager.
        """
        # Simulate what browser_navigate returns (with base64 in 'data' field)
        navigate_result = {
            "content": [
                {"text": "✅ **Navigated to**: https://example.com\n**Page Title**: Example"},
                {
                    "image": {
                        "format": "jpeg",
                        "source": {
                            "data": base64.b64encode(sample_jpeg_bytes).decode('utf-8')
                        }
                    }
                }
            ],
            "status": "success",
            "metadata": {"browserSessionId": "session-123"}
        }

        # Must be JSON serializable - this is the critical test
        json_str = json.dumps(navigate_result)
        assert "example.com" in json_str

        # Verify round-trip
        parsed = json.loads(json_str)
        assert parsed["status"] == "success"

        # Verify image data can be decoded back to original bytes
        image_data = parsed["content"][1]["image"]["source"]["data"]
        decoded_bytes = base64.b64decode(image_data)
        assert decoded_bytes == sample_jpeg_bytes

    def test_browser_drag_result_json_serializable(self, sample_jpeg_bytes):
        """Test browser_drag result format is JSON serializable."""
        # Simulate what browser_drag returns (with optional screenshot)
        drag_result = {
            "content": [
                {"text": "✅ **Drag completed**\n\n**From**: (100, 100)\n**To**: (300, 200)"}
            ],
            "status": "success",
            "metadata": {}
        }

        # Without screenshot - must be serializable
        json_str = json.dumps(drag_result)
        assert "Drag completed" in json_str

        # With screenshot - must also be serializable (uses source.data)
        drag_result_with_screenshot = {
            "content": [
                {"text": "✅ **Drag completed**\n\n**From**: (100, 100)\n**To**: (300, 200)"},
                {
                    "image": {
                        "format": "jpeg",
                        "source": {
                            "data": base64.b64encode(sample_jpeg_bytes).decode('utf-8')
                        }
                    }
                }
            ],
            "status": "success",
            "metadata": {}
        }

        json_str = json.dumps(drag_result_with_screenshot)
        assert "Drag completed" in json_str

    def test_raw_bytes_not_json_serializable(self, sample_jpeg_bytes):
        """Verify that raw bytes cause JSON serialization error (the bug we fixed).

        This demonstrates why browser tools now use source.data instead of source.bytes.
        """
        # This is what the browser tools were returning BEFORE the fix
        bad_result = {
            "content": [
                {"text": "Result"},
                {
                    "image": {
                        "format": "jpeg",
                        "source": {
                            "bytes": sample_jpeg_bytes  # Raw bytes - NOT serializable!
                        }
                    }
                }
            ],
            "status": "success"
        }

        # This should fail - demonstrating the bug
        with pytest.raises(TypeError, match="not JSON serializable"):
            json.dumps(bad_result)

    def test_source_data_format_json_serializable(self, sample_jpeg_bytes):
        """Verify that source.data format (base64 string) IS JSON serializable.

        This is the format browser tools now use for cloud compatibility.
        """
        # This is what the browser tools return AFTER the fix
        good_result = {
            "content": [
                {"text": "Result"},
                {
                    "image": {
                        "format": "jpeg",
                        "source": {
                            "data": base64.b64encode(sample_jpeg_bytes).decode('utf-8')
                        }
                    }
                }
            ],
            "status": "success"
        }

        # This should succeed
        json_str = json.dumps(good_result)
        parsed = json.loads(json_str)

        # Verify the image data survives round-trip
        image_b64 = parsed["content"][1]["image"]["source"]["data"]
        decoded = base64.b64decode(image_b64)
        assert decoded == sample_jpeg_bytes

    def test_event_formatter_handles_source_data_format(self, sample_jpeg_bytes):
        """Test that event_formatter correctly processes source.data format (cloud mode).

        Browser tools use source.data for cloud compatibility.
        Event formatter should extract this and pass to frontend.
        """
        from streaming.event_formatter import StreamEventFormatter

        # Browser tool result with source.data (cloud-compatible format)
        tool_result = {
            "toolUseId": "toolu_browser_001",
            "content": [
                {"text": "✅ **Navigated to**: https://example.com"},
                {
                    "image": {
                        "format": "jpeg",
                        "source": {
                            "data": base64.b64encode(sample_jpeg_bytes).decode('utf-8')
                        }
                    }
                }
            ],
            "status": "success"
        }

        result_text, result_images = StreamEventFormatter._extract_basic_content(tool_result)

        # Should extract text
        assert "Navigated to" in result_text

        # Should extract image from source.data
        assert len(result_images) == 1
        assert result_images[0]["format"] == "jpeg"

        # Image data should be base64 string
        image_data = result_images[0]["data"]
        assert isinstance(image_data, str)

        # Should decode back to original bytes
        decoded = base64.b64decode(image_data)
        assert decoded == sample_jpeg_bytes

    def test_event_formatter_handles_source_bytes_format(self, sample_png_bytes):
        """Test that event_formatter correctly processes source.bytes format (local mode).

        Diagram tool and other tools use source.bytes with raw bytes.
        Event formatter should convert to base64 for frontend.
        """
        from streaming.event_formatter import StreamEventFormatter

        # Tool result with source.bytes (raw bytes - local mode compatible)
        tool_result = {
            "toolUseId": "toolu_diagram_001",
            "content": [
                {"text": "✅ **Diagram generated**"},
                {
                    "image": {
                        "format": "png",
                        "source": {
                            "bytes": sample_png_bytes  # Raw bytes
                        }
                    }
                }
            ],
            "status": "success"
        }

        result_text, result_images = StreamEventFormatter._extract_basic_content(tool_result)

        # Should extract text
        assert "Diagram generated" in result_text

        # Should extract and convert image from source.bytes
        assert len(result_images) == 1
        assert result_images[0]["format"] == "png"

        # Image data should be converted to base64 string
        image_data = result_images[0]["data"]
        assert isinstance(image_data, str)

        # Should decode back to original bytes
        decoded = base64.b64decode(image_data)
        assert decoded == sample_png_bytes

    def test_event_formatter_handles_both_formats_in_same_result(self, sample_jpeg_bytes, sample_png_bytes):
        """Test that event_formatter handles mixed source.data and source.bytes."""
        from streaming.event_formatter import StreamEventFormatter

        # Mixed format (unlikely but should be handled)
        tool_result = {
            "toolUseId": "toolu_mixed_001",
            "content": [
                {"text": "Multiple images"},
                {
                    "image": {
                        "format": "jpeg",
                        "source": {
                            "data": base64.b64encode(sample_jpeg_bytes).decode('utf-8')
                        }
                    }
                },
                {
                    "image": {
                        "format": "png",
                        "source": {
                            "bytes": sample_png_bytes
                        }
                    }
                }
            ],
            "status": "success"
        }

        result_text, result_images = StreamEventFormatter._extract_basic_content(tool_result)

        # Should extract both images
        assert len(result_images) == 2

        # Both should be base64 strings
        assert all(isinstance(img["data"], str) for img in result_images)

        # Verify correct formats
        assert result_images[0]["format"] == "jpeg"
        assert result_images[1]["format"] == "png"

        # Verify data integrity
        assert base64.b64decode(result_images[0]["data"]) == sample_jpeg_bytes
        assert base64.b64decode(result_images[1]["data"]) == sample_png_bytes
