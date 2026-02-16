"""
Document Managers - Specific implementations for each document type

Provides specialized managers for Word, Excel, PowerPoint, and Image files.
Each manager inherits from BaseDocumentManager and adds type-specific functionality.
"""

import json
import logging
from typing import List, Dict, Any, Optional

from .base_manager import BaseDocumentManager

logger = logging.getLogger(__name__)


class WordManager(BaseDocumentManager):
    """Document manager specifically for Word (.docx) files"""

    def __init__(self, user_id: str, session_id: str):
        super().__init__(user_id, session_id, document_type='word')
        logger.info("WordManager initialized")

    def validate_docx_filename(self, filename: str) -> bool:
        """Validate that filename ends with .docx"""
        if not filename.endswith('.docx'):
            raise ValueError(f"Filename must end with .docx: {filename}")
        return True

    def format_file_list(self, documents: List[Dict[str, Any]]) -> str:
        """Format document list for display

        Args:
            documents: List of document info dicts from list_s3_documents()

        Returns:
            Formatted string for display
        """
        if not documents:
            return "**Workspace**: Empty (no documents yet)"

        lines = [f"**Workspace** ({len(documents)} document{'s' if len(documents) > 1 else ''}):"]

        for doc in sorted(documents, key=lambda x: x['last_modified'], reverse=True):
            # Parse ISO timestamp
            modified_date = doc['last_modified'].split('T')[0]
            lines.append(f"  - **{doc['filename']}** ({doc['size_kb']}) - Modified: {modified_date}")

        return "\n".join(lines)


class ExcelManager(BaseDocumentManager):
    """Document manager for Excel (.xlsx) files"""

    def __init__(self, user_id: str, session_id: str):
        super().__init__(user_id, session_id, document_type='excel')
        logger.info("ExcelManager initialized")

    def validate_xlsx_filename(self, filename: str) -> bool:
        """Validate that filename ends with .xlsx"""
        if not filename.endswith('.xlsx'):
            raise ValueError(f"Filename must end with .xlsx: {filename}")
        return True

    def format_file_list(self, documents: List[Dict[str, Any]]) -> str:
        """Format spreadsheet list for display

        Args:
            documents: List of document info dicts from list_s3_documents()

        Returns:
            Formatted string for display
        """
        if not documents:
            return "**Workspace**: Empty (no spreadsheets yet)"

        lines = [f"**Workspace** ({len(documents)} spreadsheet{'s' if len(documents) > 1 else ''}):"]

        for doc in sorted(documents, key=lambda x: x['last_modified'], reverse=True):
            # Parse ISO timestamp
            modified_date = doc['last_modified'].split('T')[0]
            lines.append(f"  - **{doc['filename']}** ({doc['size_kb']}) - Modified: {modified_date}")

        return "\n".join(lines)


class PowerPointManager(BaseDocumentManager):
    """Document manager for PowerPoint (.pptx) files"""

    def __init__(self, user_id: str, session_id: str):
        super().__init__(user_id, session_id, document_type='powerpoint')
        logger.info("PowerPointManager initialized")

    def validate_pptx_filename(self, filename: str) -> bool:
        """Validate that filename ends with .pptx

        Args:
            filename: Filename to validate

        Returns:
            True if valid

        Raises:
            ValueError: If filename doesn't end with .pptx
        """
        if not filename.endswith('.pptx'):
            raise ValueError(f"Filename must end with .pptx: {filename}")
        return True

    def format_file_list(self, documents: List[Dict[str, Any]]) -> str:
        """Format presentation list for display

        Args:
            documents: List of document info dicts from list_s3_documents()

        Returns:
            Formatted string for display
        """
        if not documents:
            return "**Workspace**: Empty (no presentations yet)"

        lines = [f"**Workspace** ({len(documents)} presentation{'s' if len(documents) > 1 else ''}):"]

        for doc in sorted(documents, key=lambda x: x['last_modified'], reverse=True):
            # Parse ISO timestamp
            modified_date = doc['last_modified'].split('T')[0]
            lines.append(f"  - **{doc['filename']}** ({doc['size_kb']}) - Modified: {modified_date}")

        return "\n".join(lines)

    def save_template_metadata(self, template_info: dict, source_filename: str) -> str:
        """Save template analysis as JSON metadata in S3

        Args:
            template_info: Template analysis result (layouts, theme, etc.)
            source_filename: Source PPT filename (e.g., "company-template.pptx")

        Returns:
            S3 key of saved metadata
        """
        # Create metadata filename with dot prefix (hidden file pattern)
        metadata_filename = f".template-{source_filename}.json"
        metadata_bytes = json.dumps(template_info, indent=2).encode('utf-8')

        # Save to S3 with metadata
        s3_info = self.save_to_s3(
            metadata_filename,
            metadata_bytes,
            metadata={'type': 'template_metadata', 'source': source_filename}
        )

        logger.info(f"Saved template metadata: {metadata_filename}")
        return s3_info['s3_key']

    def load_template_metadata(self, source_filename: str) -> Optional[dict]:
        """Load template metadata if exists

        Args:
            source_filename: Source PPT filename (e.g., "company-template.pptx")

        Returns:
            Template metadata dict or None if not found
        """
        metadata_filename = f".template-{source_filename}.json"

        try:
            metadata_bytes = self.load_from_s3(metadata_filename)
            template_info = json.loads(metadata_bytes.decode('utf-8'))
            logger.info(f"Loaded template metadata for {source_filename}")
            return template_info
        except FileNotFoundError:
            logger.info(f"No template metadata found for {source_filename}")
            return None
        except Exception as e:
            logger.error(f"Failed to load template metadata: {e}")
            return None

    def get_available_templates(self) -> List[str]:
        """List all presentations that have template metadata

        Returns:
            List of presentation filenames that can be used as templates
        """
        all_docs = self.list_s3_documents()
        templates = []

        for doc in all_docs:
            if doc['filename'].endswith('.pptx'):
                # Check if template metadata exists
                metadata_filename = f".template-{doc['filename']}.json"
                try:
                    self.load_from_s3(metadata_filename)
                    templates.append(doc['filename'])
                except:
                    pass

        logger.info(f"Found {len(templates)} available templates")
        return templates


class ImageManager(BaseDocumentManager):
    """Document manager for image files (.png, .jpg, .jpeg, .gif, .webp)"""

    def __init__(self, user_id: str, session_id: str):
        super().__init__(user_id, session_id, document_type='image')
        logger.info("ImageManager initialized")

    def validate_image_filename(self, filename: str) -> bool:
        """Validate that filename is a supported image format"""
        valid_extensions = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.pdf')
        if not filename.lower().endswith(valid_extensions):
            raise ValueError(f"Filename must be a supported image/document format: {filename}")
        return True

    def get_image_mime_type(self, filename: str) -> str:
        """Get MIME type for image based on extension"""
        extension = filename.lower().split('.')[-1]
        mime_type_map = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'bmp': 'image/bmp',
            'pdf': 'application/pdf'
        }
        return mime_type_map.get(extension, 'image/png')

    def format_file_list(self, documents: List[Dict[str, Any]]) -> str:
        """Format image list for display

        Args:
            documents: List of document info dicts from list_s3_documents()

        Returns:
            Formatted string for display
        """
        if not documents:
            return "**Workspace**: Empty (no images yet)"

        lines = [f"**Workspace** ({len(documents)} image{'s' if len(documents) > 1 else ''}):"]

        for doc in sorted(documents, key=lambda x: x['last_modified'], reverse=True):
            # Parse ISO timestamp
            modified_date = doc['last_modified'].split('T')[0]
            lines.append(f"  - **{doc['filename']}** ({doc['size_kb']}) - Modified: {modified_date}")

        return "\n".join(lines)


# Backward compatibility aliases
WordDocumentManager = WordManager
ExcelDocumentManager = ExcelManager
PowerPointDocumentManager = PowerPointManager
ImageDocumentManager = ImageManager
