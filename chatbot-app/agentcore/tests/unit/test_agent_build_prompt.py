"""
Unit tests for ChatbotAgent._build_prompt method.

Tests file handling, cloud mode vs local mode behavior, and ContentBlock generation.
"""
import os
import base64
import json
import pytest
from unittest.mock import MagicMock, patch, PropertyMock


class MockFileContent:
    """Mock for FileContent objects from the API."""
    def __init__(self, filename: str, content_type: str, bytes_data: bytes):
        self.filename = filename
        self.content_type = content_type
        # API sends base64-encoded bytes
        self.bytes = base64.b64encode(bytes_data).decode()


class TestBuildPromptLocalMode:
    """Tests for _build_prompt in local mode (no MEMORY_ID)."""

    @pytest.fixture
    def mock_agent_class(self):
        """Import and setup ChatbotAgent class."""
        # Patch environment to ensure local mode
        with patch.dict(os.environ, {}, clear=True):
            # Mock all external dependencies
            with patch('agent.agent.BedrockModel'):
                with patch('agent.agent.Agent'):
                    with patch('agent.agent.FileSessionManager'):
                        with patch('agent.agent.StreamEventProcessor'):
                            # Import here to get mocked version
                            from agent.agent import ChatbotAgent
                            yield ChatbotAgent

    @pytest.fixture
    def local_agent(self, mock_agent_class, tmp_path):
        """Create agent in local mode."""
        with patch.dict(os.environ, {'NEXT_PUBLIC_AGENTCORE_LOCAL': 'true'}, clear=True):
            with patch('agent.agent.Path') as mock_path:
                mock_path.return_value.parent.parent.parent = tmp_path
                agent = mock_agent_class(
                    session_id="test_session",
                    user_id="test_user",
                    enabled_tools=[]
                )
                return agent

    def test_text_only_message(self, local_agent):
        """Test _build_prompt with text only (no files)."""
        prompt, uploaded_files = local_agent._build_prompt("Hello world", None)

        assert prompt == "Hello world"
        assert uploaded_files == []

    def test_text_only_empty_files(self, local_agent):
        """Test _build_prompt with empty files list."""
        prompt, uploaded_files = local_agent._build_prompt("Hello world", [])

        assert prompt == "Hello world"
        assert uploaded_files == []

    def test_image_file_creates_content_block(self, local_agent):
        """Test that image files create image ContentBlock."""
        image_bytes = b'\x89PNG\r\n\x1a\n' + b'\x00' * 50
        file = MockFileContent("test.png", "image/png", image_bytes)

        prompt, uploaded_files = local_agent._build_prompt("Describe this image", [file])

        # Should be list of ContentBlocks
        assert isinstance(prompt, list)
        # First block is text
        assert prompt[0]["text"].startswith("Describe this image")
        # Second block is image
        assert "image" in prompt[1]
        assert prompt[1]["image"]["format"] == "png"
        assert prompt[1]["image"]["source"]["bytes"] == image_bytes

        # uploaded_files should have file info
        assert len(uploaded_files) == 1
        assert uploaded_files[0]["filename"] == "test.png"

    def test_pdf_file_creates_document_block(self, local_agent):
        """Test that PDF files create document ContentBlock."""
        pdf_bytes = b'%PDF-1.4 fake content'
        file = MockFileContent("report.pdf", "application/pdf", pdf_bytes)

        prompt, uploaded_files = local_agent._build_prompt("Summarize this", [file])

        assert isinstance(prompt, list)
        # Should have document block
        doc_blocks = [b for b in prompt if "document" in b]
        assert len(doc_blocks) == 1
        assert doc_blocks[0]["document"]["format"] == "pdf"
        assert doc_blocks[0]["document"]["name"] == "report"  # Without extension

    def test_filename_sanitization(self, local_agent):
        """Test that filenames are sanitized correctly."""
        image_bytes = b'\x89PNG\r\n\x1a\n'
        file = MockFileContent("my_test file@#$.png", "image/png", image_bytes)

        _, uploaded_files = local_agent._build_prompt("Test", [file])

        # Filename should be sanitized
        sanitized = uploaded_files[0]["filename"]
        assert "_" not in sanitized or "-" in sanitized  # Underscores converted to hyphens
        assert "@" not in sanitized
        assert "#" not in sanitized
        assert "$" not in sanitized

    def test_multiple_files(self, local_agent):
        """Test handling multiple files of different types."""
        image = MockFileContent("photo.jpg", "image/jpeg", b'\xff\xd8\xff\xe0')
        pdf = MockFileContent("doc.pdf", "application/pdf", b'%PDF')

        prompt, uploaded_files = local_agent._build_prompt("Analyze these", [image, pdf])

        assert isinstance(prompt, list)
        assert len(uploaded_files) == 2

        # Should have image and document blocks
        image_blocks = [b for b in prompt if "image" in b]
        doc_blocks = [b for b in prompt if "document" in b]
        assert len(image_blocks) == 1
        assert len(doc_blocks) == 1


class TestBuildPromptCloudMode:
    """Tests for _build_prompt in cloud mode (with MEMORY_ID).

    Cloud mode skips document ContentBlocks for docx/xlsx to avoid
    AgentCore Memory bytes serialization errors.
    """

    @pytest.fixture
    def mock_agent_class(self):
        """Import and setup ChatbotAgent class for cloud mode."""
        with patch.dict(os.environ, {'MEMORY_ID': 'test-memory-id', 'AWS_REGION': 'us-west-2'}):
            with patch('agent.agent.BedrockModel'):
                with patch('agent.agent.Agent'):
                    with patch('agent.agent.AGENTCORE_MEMORY_AVAILABLE', True):
                        with patch('agent.agent.AgentCoreMemorySessionManager'):
                            with patch('agent.agent.AgentCoreMemoryConfig'):
                                with patch('agent.agent.StreamEventProcessor'):
                                    from agent.agent import ChatbotAgent
                                    yield ChatbotAgent

    @pytest.fixture
    def cloud_agent(self, mock_agent_class):
        """Create agent in cloud mode."""
        with patch.dict(os.environ, {'MEMORY_ID': 'test-memory-id'}):
            with patch('agent.agent.AGENTCORE_MEMORY_AVAILABLE', True):
                agent = mock_agent_class(
                    session_id="test_session",
                    user_id="test_user",
                    enabled_tools=['word_document_tools']
                )
                # Ensure cloud mode is detected
                return agent

    def test_image_still_creates_content_block_in_cloud(self, cloud_agent):
        """Test that images still create ContentBlock in cloud mode."""
        image_bytes = b'\x89PNG\r\n\x1a\n'
        file = MockFileContent("test.png", "image/png", image_bytes)

        with patch.dict(os.environ, {'MEMORY_ID': 'test-memory-id'}):
            with patch('agent.agent.AGENTCORE_MEMORY_AVAILABLE', True):
                prompt, _ = cloud_agent._build_prompt("Describe", [file])

        # Image should still be in ContentBlock
        image_blocks = [b for b in prompt if isinstance(b, dict) and "image" in b]
        assert len(image_blocks) == 1

    def test_pdf_still_creates_content_block_in_cloud(self, cloud_agent):
        """Test that PDFs still create ContentBlock in cloud mode."""
        pdf_bytes = b'%PDF-1.4'
        file = MockFileContent("report.pdf", "application/pdf", pdf_bytes)

        with patch.dict(os.environ, {'MEMORY_ID': 'test-memory-id'}):
            with patch('agent.agent.AGENTCORE_MEMORY_AVAILABLE', True):
                prompt, _ = cloud_agent._build_prompt("Summarize", [file])

        # PDF should still be in ContentBlock
        doc_blocks = [b for b in prompt if isinstance(b, dict) and "document" in b]
        assert len(doc_blocks) == 1


class TestBuildPromptFileHints:
    """Tests for file hints added to prompt text."""

    @pytest.fixture
    def mock_agent(self):
        """Create a minimal mock agent for file hint tests."""
        with patch.dict(os.environ, {}, clear=True):
            with patch('agent.agent.BedrockModel'):
                with patch('agent.agent.Agent'):
                    with patch('agent.agent.FileSessionManager'):
                        with patch('agent.agent.StreamEventProcessor'):
                            from agent.agent import ChatbotAgent

                            agent = ChatbotAgent(
                                session_id="test_session",
                                user_id="test_user",
                                enabled_tools=['word_document_tools', 'excel_spreadsheet_tools']
                            )
                            return agent

    def test_file_hints_in_prompt(self, mock_agent):
        """Test that file hints are added to prompt text."""
        image_bytes = b'\x89PNG\r\n\x1a\n'
        file = MockFileContent("chart.png", "image/png", image_bytes)

        prompt, _ = mock_agent._build_prompt("Analyze this", [file])

        # Text block should contain file hints
        text_block = prompt[0]["text"]
        assert "<uploaded_files>" in text_block
        assert "chart.png" in text_block

    def test_pptx_always_workspace_only(self, mock_agent):
        """Test that PowerPoint files are always workspace-only (never ContentBlock)."""
        pptx_bytes = b'PK\x03\x04'  # ZIP header (PPTX is a ZIP)
        file = MockFileContent("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", pptx_bytes)

        prompt, uploaded_files = mock_agent._build_prompt("Review slides", [file])

        # Should NOT have document ContentBlock for pptx
        doc_blocks = [b for b in prompt if isinstance(b, dict) and "document" in b]
        assert len(doc_blocks) == 0

        # But should still be in uploaded_files (for workspace storage)
        assert len(uploaded_files) == 1
        assert "pptx" in uploaded_files[0]["filename"]


class TestSanitizeFilename:
    """Tests for _sanitize_filename method."""

    @pytest.fixture
    def agent(self):
        """Create agent for testing."""
        with patch.dict(os.environ, {}, clear=True):
            with patch('agent.agent.BedrockModel'):
                with patch('agent.agent.Agent'):
                    with patch('agent.agent.FileSessionManager'):
                        with patch('agent.agent.StreamEventProcessor'):
                            from agent.agent import ChatbotAgent
                            return ChatbotAgent(
                                session_id="test",
                                user_id="test",
                                enabled_tools=[]
                            )

    def test_underscores_to_hyphens(self, agent):
        """Test that underscores are converted to hyphens."""
        result = agent._sanitize_filename("my_test_file")
        assert "_" not in result
        assert "-" in result

    def test_spaces_to_hyphens(self, agent):
        """Test that spaces are converted to hyphens."""
        result = agent._sanitize_filename("my test file")
        assert " " not in result

    def test_special_chars_removed(self, agent):
        """Test that special characters are removed."""
        result = agent._sanitize_filename("file@#$%^&*!.name")
        assert "@" not in result
        assert "#" not in result
        assert "$" not in result
        assert "%" not in result

    def test_parentheses_allowed(self, agent):
        """Test that parentheses are allowed."""
        result = agent._sanitize_filename("file(1)")
        assert "(" in result
        assert ")" in result

    def test_brackets_allowed(self, agent):
        """Test that square brackets are allowed."""
        result = agent._sanitize_filename("file[v2]")
        assert "[" in result
        assert "]" in result

    def test_consecutive_hyphens_collapsed(self, agent):
        """Test that consecutive hyphens are collapsed."""
        result = agent._sanitize_filename("file---name")
        assert "---" not in result

    def test_empty_result_defaults(self, agent):
        """Test that empty result defaults to 'document'."""
        result = agent._sanitize_filename("@#$%")
        assert result == "document"


class TestGetImageFormat:
    """Tests for _get_image_format method.

    Note: The method checks content_type first, then falls back to filename.
    But filename extension takes precedence if it matches a known format.
    """

    @pytest.fixture
    def agent(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch('agent.agent.BedrockModel'):
                with patch('agent.agent.Agent'):
                    with patch('agent.agent.FileSessionManager'):
                        with patch('agent.agent.StreamEventProcessor'):
                            from agent.agent import ChatbotAgent
                            return ChatbotAgent(
                                session_id="test",
                                user_id="test",
                                enabled_tools=[]
                            )

    def test_png_from_content_type(self, agent):
        """Test PNG detection from content type."""
        assert agent._get_image_format("image/png", "file.unknown") == "png"

    def test_jpeg_from_content_type(self, agent):
        """Test JPEG detection from content type."""
        assert agent._get_image_format("image/jpeg", "file.unknown") == "jpeg"

    def test_png_from_filename(self, agent):
        """Test PNG detection from filename extension."""
        assert agent._get_image_format("application/octet-stream", "image.png") == "png"

    def test_jpeg_from_filename(self, agent):
        """Test JPEG detection from filename extension."""
        assert agent._get_image_format("application/octet-stream", "photo.jpg") == "jpeg"

    def test_gif_from_filename(self, agent):
        """Test GIF detection from filename extension."""
        assert agent._get_image_format("application/octet-stream", "anim.gif") == "gif"

    def test_webp_from_filename(self, agent):
        """Test WebP detection from filename extension."""
        assert agent._get_image_format("application/octet-stream", "image.webp") == "webp"

    def test_default_to_png(self, agent):
        """Test that unknown formats default to PNG."""
        assert agent._get_image_format("application/octet-stream", "file.unknown") == "png"

    def test_content_type_priority_for_png(self, agent):
        """Test that content_type is checked before filename."""
        # When content_type says PNG, even if filename says JPG, PNG wins
        result = agent._get_image_format("image/png", "file.jpg")
        assert result == "png"


class TestGetDocumentFormat:
    """Tests for _get_document_format method."""

    @pytest.fixture
    def agent(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch('agent.agent.BedrockModel'):
                with patch('agent.agent.Agent'):
                    with patch('agent.agent.FileSessionManager'):
                        with patch('agent.agent.StreamEventProcessor'):
                            from agent.agent import ChatbotAgent
                            return ChatbotAgent(
                                session_id="test",
                                user_id="test",
                                enabled_tools=[]
                            )

    def test_pdf(self, agent):
        assert agent._get_document_format("report.pdf") == "pdf"

    def test_csv(self, agent):
        assert agent._get_document_format("data.csv") == "csv"

    def test_docx(self, agent):
        assert agent._get_document_format("document.docx") == "docx"

    def test_xlsx(self, agent):
        assert agent._get_document_format("spreadsheet.xlsx") == "xlsx"

    def test_html(self, agent):
        assert agent._get_document_format("page.html") == "html"

    def test_txt(self, agent):
        assert agent._get_document_format("notes.txt") == "txt"

    def test_md(self, agent):
        assert agent._get_document_format("readme.md") == "md"

    def test_default_to_txt(self, agent):
        assert agent._get_document_format("file.unknown") == "txt"
