"""
Integration tests for Workspace management functionality.

Tests workspace operations including:
1. Session-isolated workspace creation
2. File save/load/delete operations
3. Document type specific managers (Word, Excel, PowerPoint, Image)
4. S3 key generation and path isolation
5. File listing and formatting

These tests verify:
- Workspace isolation between users/sessions
- S3 operations (save, load, list, delete)
- Document manager inheritance and specialization
"""
import pytest
from unittest.mock import MagicMock, patch, ANY
from typing import Dict, Any, List
from datetime import datetime
import json


# ============================================================
# Mock Classes
# ============================================================

class MockS3Response:
    """Mock S3 response for list_objects_v2."""
    def __init__(self, contents: List[Dict[str, Any]] = None):
        self.contents = contents or []

    def to_dict(self) -> Dict[str, Any]:
        if self.contents:
            return {'Contents': self.contents}
        return {}


class MockS3Client:
    """Mock S3 client for testing without AWS credentials."""

    def __init__(self):
        self.objects: Dict[str, bytes] = {}
        self.metadata: Dict[str, Dict] = {}
        self.exceptions = MagicMock()
        self.exceptions.NoSuchKey = Exception

    def put_object(self, Bucket: str, Key: str, Body: bytes, Metadata: Dict = None, ContentType: str = None):
        self.objects[Key] = Body
        self.metadata[Key] = Metadata or {}
        return {}

    def get_object(self, Bucket: str, Key: str):
        if Key not in self.objects:
            raise self.exceptions.NoSuchKey("NoSuchKey")
        return {
            'Body': MagicMock(read=lambda: self.objects[Key])
        }

    def list_objects_v2(self, Bucket: str, Prefix: str):
        matching = []
        for key in self.objects:
            if key.startswith(Prefix):
                matching.append({
                    'Key': key,
                    'Size': len(self.objects[key]),
                    'LastModified': datetime.utcnow()
                })
        if matching:
            return {'Contents': matching}
        return {}

    def delete_object(self, Bucket: str, Key: str):
        if Key in self.objects:
            del self.objects[Key]
            if Key in self.metadata:
                del self.metadata[Key]
        return {}

    def generate_presigned_url(self, operation: str, Params: Dict, ExpiresIn: int = 900):
        return f"https://mock-bucket.s3.amazonaws.com/{Params['Key']}?presigned=true"


# ============================================================
# Workspace Isolation Tests
# ============================================================

class TestWorkspaceIsolation:
    """Tests for workspace isolation between users and sessions."""

    @pytest.fixture
    def mock_s3(self):
        return MockS3Client()

    def test_s3_prefix_includes_user_and_session(self, mock_s3):
        """Test that S3 prefix correctly includes user_id and session_id."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.base_manager import BaseDocumentManager

                manager = BaseDocumentManager(
                    user_id="user123",
                    session_id="session456",
                    document_type="word"
                )

                expected_prefix = "documents/user123/session456/word"
                assert manager.s3_prefix == expected_prefix

    def test_different_users_have_different_prefixes(self, mock_s3):
        """Test that different users have isolated workspaces."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.base_manager import BaseDocumentManager

                manager1 = BaseDocumentManager("user1", "session1", "word")
                manager2 = BaseDocumentManager("user2", "session1", "word")

                assert manager1.s3_prefix != manager2.s3_prefix
                assert "user1" in manager1.s3_prefix
                assert "user2" in manager2.s3_prefix

    def test_different_sessions_have_different_prefixes(self, mock_s3):
        """Test that different sessions for same user have isolated workspaces."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.base_manager import BaseDocumentManager

                manager1 = BaseDocumentManager("user1", "session1", "word")
                manager2 = BaseDocumentManager("user1", "session2", "word")

                assert manager1.s3_prefix != manager2.s3_prefix
                assert "session1" in manager1.s3_prefix
                assert "session2" in manager2.s3_prefix

    def test_different_document_types_have_different_prefixes(self, mock_s3):
        """Test that different document types are stored separately."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.base_manager import BaseDocumentManager

                word_manager = BaseDocumentManager("user1", "session1", "word")
                excel_manager = BaseDocumentManager("user1", "session1", "excel")

                assert word_manager.s3_prefix != excel_manager.s3_prefix
                assert "word" in word_manager.s3_prefix
                assert "excel" in excel_manager.s3_prefix

    def test_invalid_user_id_rejected(self, mock_s3):
        """Test that invalid user_id format is rejected."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.base_manager import BaseDocumentManager

                with pytest.raises(ValueError, match="Invalid user_id"):
                    BaseDocumentManager("user/../hack", "session1", "word")

    def test_invalid_session_id_rejected(self, mock_s3):
        """Test that invalid session_id format is rejected."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.base_manager import BaseDocumentManager

                with pytest.raises(ValueError, match="Invalid session_id"):
                    BaseDocumentManager("user1", "session/../hack", "word")


# ============================================================
# S3 Operations Tests
# ============================================================

class TestS3Operations:
    """Tests for S3 save/load/delete operations."""

    @pytest.fixture
    def mock_s3(self):
        return MockS3Client()

    @pytest.fixture
    def manager(self, mock_s3):
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.base_manager import BaseDocumentManager
                return BaseDocumentManager("user1", "session1", "word")

    def test_save_to_s3_stores_file(self, manager, mock_s3):
        """Test that save_to_s3 stores file content correctly."""
        file_content = b"Hello, World!"
        filename = "test.docx"

        result = manager.save_to_s3(filename, file_content)

        expected_key = f"{manager.s3_prefix}/{filename}"
        assert expected_key in mock_s3.objects
        assert mock_s3.objects[expected_key] == file_content
        assert "s3_key" in result
        assert "s3_url" in result

    def test_save_to_s3_includes_metadata(self, manager, mock_s3):
        """Test that save_to_s3 includes proper metadata."""
        file_content = b"Document content"
        filename = "report.docx"
        custom_metadata = {"project": "test-project"}

        manager.save_to_s3(filename, file_content, metadata=custom_metadata)

        expected_key = f"{manager.s3_prefix}/{filename}"
        stored_metadata = mock_s3.metadata[expected_key]

        assert stored_metadata["user_id"] == "user1"
        assert stored_metadata["session_id"] == "session1"
        assert stored_metadata["document_type"] == "word"
        assert stored_metadata["project"] == "test-project"
        assert "upload_time" in stored_metadata

    def test_load_from_s3_retrieves_file(self, manager, mock_s3):
        """Test that load_from_s3 retrieves file content correctly."""
        file_content = b"Stored document content"
        filename = "existing.docx"

        # Pre-store file
        manager.save_to_s3(filename, file_content)

        # Load file
        loaded_content = manager.load_from_s3(filename)

        assert loaded_content == file_content

    def test_load_from_s3_raises_on_missing_file(self, manager, mock_s3):
        """Test that load_from_s3 raises FileNotFoundError for missing files."""
        with pytest.raises(FileNotFoundError, match="Document not found"):
            manager.load_from_s3("nonexistent.docx")

    def test_list_s3_documents_returns_all_files(self, manager, mock_s3):
        """Test that list_s3_documents returns all files in workspace."""
        # Save multiple files
        manager.save_to_s3("doc1.docx", b"Content 1")
        manager.save_to_s3("doc2.docx", b"Content 2")
        manager.save_to_s3("doc3.docx", b"Content 3")

        documents = manager.list_s3_documents()

        assert len(documents) == 3
        filenames = [doc["filename"] for doc in documents]
        assert "doc1.docx" in filenames
        assert "doc2.docx" in filenames
        assert "doc3.docx" in filenames

    def test_list_s3_documents_returns_empty_for_new_workspace(self, manager, mock_s3):
        """Test that list_s3_documents returns empty list for new workspace."""
        documents = manager.list_s3_documents()
        assert documents == []

    def test_delete_from_s3_removes_file(self, manager, mock_s3):
        """Test that delete_from_s3 removes file from S3."""
        filename = "to-delete.docx"
        manager.save_to_s3(filename, b"Delete me")

        # Verify file exists
        assert len(manager.list_s3_documents()) == 1

        # Delete file
        result = manager.delete_from_s3(filename)

        assert result is True
        assert len(manager.list_s3_documents()) == 0

    def test_generate_presigned_url(self, manager, mock_s3):
        """Test that presigned URL is generated correctly."""
        filename = "download.docx"
        manager.save_to_s3(filename, b"Download content")

        url = manager.generate_presigned_url(filename, expiration=300)

        assert "presigned=true" in url
        assert filename in url


# ============================================================
# Document Type Manager Tests
# ============================================================

class TestDocumentTypeManagers:
    """Tests for type-specific document managers."""

    @pytest.fixture
    def mock_s3(self):
        return MockS3Client()

    def test_word_manager_validates_docx_extension(self, mock_s3):
        """Test WordManager validates .docx extension."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import WordManager

                manager = WordManager("user1", "session1")

                # Valid
                assert manager.validate_docx_filename("report.docx") is True

                # Invalid
                with pytest.raises(ValueError, match="must end with .docx"):
                    manager.validate_docx_filename("report.pdf")

    def test_excel_manager_validates_xlsx_extension(self, mock_s3):
        """Test ExcelManager validates .xlsx extension."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import ExcelManager

                manager = ExcelManager("user1", "session1")

                # Valid
                assert manager.validate_xlsx_filename("data.xlsx") is True

                # Invalid
                with pytest.raises(ValueError, match="must end with .xlsx"):
                    manager.validate_xlsx_filename("data.csv")

    def test_powerpoint_manager_validates_pptx_extension(self, mock_s3):
        """Test PowerPointManager validates .pptx extension."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import PowerPointManager

                manager = PowerPointManager("user1", "session1")

                # Valid
                assert manager.validate_pptx_filename("slides.pptx") is True

                # Invalid
                with pytest.raises(ValueError, match="must end with .pptx"):
                    manager.validate_pptx_filename("slides.ppt")

    def test_image_manager_validates_image_extensions(self, mock_s3):
        """Test ImageManager validates supported image extensions."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import ImageManager

                manager = ImageManager("user1", "session1")

                # Valid formats
                valid_formats = ["image.png", "photo.jpg", "pic.jpeg", "anim.gif", "modern.webp", "design.pdf"]
                for filename in valid_formats:
                    assert manager.validate_image_filename(filename) is True

                # Invalid format
                with pytest.raises(ValueError, match="supported image/document format"):
                    manager.validate_image_filename("document.txt")

    def test_image_manager_returns_correct_mime_type(self, mock_s3):
        """Test ImageManager returns correct MIME types."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import ImageManager

                manager = ImageManager("user1", "session1")

                assert manager.get_image_mime_type("image.png") == "image/png"
                assert manager.get_image_mime_type("photo.jpg") == "image/jpeg"
                assert manager.get_image_mime_type("photo.jpeg") == "image/jpeg"
                assert manager.get_image_mime_type("anim.gif") == "image/gif"
                assert manager.get_image_mime_type("modern.webp") == "image/webp"
                assert manager.get_image_mime_type("design.pdf") == "application/pdf"


# ============================================================
# File List Formatting Tests
# ============================================================

class TestFileListFormatting:
    """Tests for document list formatting."""

    @pytest.fixture
    def mock_s3(self):
        return MockS3Client()

    def test_word_manager_format_empty_list(self, mock_s3):
        """Test WordManager formats empty file list."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import WordManager

                manager = WordManager("user1", "session1")
                formatted = manager.format_file_list([])

                assert "Empty" in formatted or "empty" in formatted

    def test_word_manager_format_with_documents(self, mock_s3):
        """Test WordManager formats file list with documents."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import WordManager

                manager = WordManager("user1", "session1")

                documents = [
                    {
                        "filename": "report.docx",
                        "size": 1024,
                        "size_kb": "1.0 KB",
                        "last_modified": "2024-01-15T10:30:00Z",
                        "s3_key": "documents/user1/session1/word/report.docx"
                    },
                    {
                        "filename": "memo.docx",
                        "size": 2048,
                        "size_kb": "2.0 KB",
                        "last_modified": "2024-01-14T09:00:00Z",
                        "s3_key": "documents/user1/session1/word/memo.docx"
                    }
                ]

                formatted = manager.format_file_list(documents)

                assert "Workspace" in formatted
                assert "2 document" in formatted
                assert "report.docx" in formatted
                assert "memo.docx" in formatted

    def test_excel_manager_format_with_spreadsheets(self, mock_s3):
        """Test ExcelManager formats file list with spreadsheets."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import ExcelManager

                manager = ExcelManager("user1", "session1")

                documents = [
                    {
                        "filename": "data.xlsx",
                        "size": 3072,
                        "size_kb": "3.0 KB",
                        "last_modified": "2024-01-15T10:30:00Z",
                        "s3_key": "documents/user1/session1/excel/data.xlsx"
                    }
                ]

                formatted = manager.format_file_list(documents)

                assert "1 spreadsheet" in formatted
                assert "data.xlsx" in formatted


# ============================================================
# Template Metadata Tests (PowerPoint)
# ============================================================

class TestPowerPointTemplateMetadata:
    """Tests for PowerPoint template metadata handling."""

    @pytest.fixture
    def mock_s3(self):
        return MockS3Client()

    def test_save_template_metadata(self, mock_s3):
        """Test saving template metadata to S3."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import PowerPointManager

                manager = PowerPointManager("user1", "session1")

                template_info = {
                    "layouts": ["Title Slide", "Content Slide"],
                    "theme": {"primary_color": "#1E40AF"}
                }

                s3_key = manager.save_template_metadata(template_info, "company-template.pptx")

                assert ".template-company-template.pptx.json" in s3_key

    def test_load_template_metadata(self, mock_s3):
        """Test loading template metadata from S3."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import PowerPointManager

                manager = PowerPointManager("user1", "session1")

                # Save metadata first
                template_info = {
                    "layouts": ["Title Slide", "Content Slide"],
                    "slides_count": 5
                }
                manager.save_template_metadata(template_info, "template.pptx")

                # Load metadata
                loaded = manager.load_template_metadata("template.pptx")

                assert loaded is not None
                assert loaded["layouts"] == ["Title Slide", "Content Slide"]
                assert loaded["slides_count"] == 5

    def test_load_nonexistent_template_metadata(self, mock_s3):
        """Test loading non-existent template metadata returns None."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import PowerPointManager

                manager = PowerPointManager("user1", "session1")

                loaded = manager.load_template_metadata("nonexistent.pptx")

                assert loaded is None


# ============================================================
# S3 Key Generation Tests
# ============================================================

class TestS3KeyGeneration:
    """Tests for S3 key generation."""

    @pytest.fixture
    def mock_s3(self):
        return MockS3Client()

    def test_get_s3_key_format(self, mock_s3):
        """Test S3 key has correct format."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.base_manager import BaseDocumentManager

                manager = BaseDocumentManager("user123", "session456", "word")
                s3_key = manager.get_s3_key("document.docx")

                assert s3_key == "documents/user123/session456/word/document.docx"

    def test_get_ci_path_returns_filename_only(self, mock_s3):
        """Test Code Interpreter path is just the filename."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.base_manager import BaseDocumentManager

                manager = BaseDocumentManager("user1", "session1", "word")
                ci_path = manager.get_ci_path("document.docx")

                # CI path should be just the filename (no directory)
                assert ci_path == "document.docx"


# ============================================================
# Backward Compatibility Tests
# ============================================================

class TestBackwardCompatibility:
    """Tests for backward compatibility aliases."""

    @pytest.fixture
    def mock_s3(self):
        return MockS3Client()

    def test_word_document_manager_alias(self, mock_s3):
        """Test WordDocumentManager alias works."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import WordDocumentManager, WordManager

                # Both should be the same class
                assert WordDocumentManager is WordManager

    def test_excel_document_manager_alias(self, mock_s3):
        """Test ExcelDocumentManager alias works."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import ExcelDocumentManager, ExcelManager

                assert ExcelDocumentManager is ExcelManager

    def test_powerpoint_document_manager_alias(self, mock_s3):
        """Test PowerPointDocumentManager alias works."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import PowerPointDocumentManager, PowerPointManager

                assert PowerPointDocumentManager is PowerPointManager

    def test_image_document_manager_alias(self, mock_s3):
        """Test ImageDocumentManager alias works."""
        with patch('workspace.base_manager.boto3.client', return_value=mock_s3):
            with patch('workspace.base_manager.get_workspace_bucket', return_value='test-bucket'):
                from workspace.managers import ImageDocumentManager, ImageManager

                assert ImageDocumentManager is ImageManager
