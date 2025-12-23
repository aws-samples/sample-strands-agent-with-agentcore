"""
Base Document Manager - Core workspace management functionality

Provides base class for managing documents in S3 and Code Interpreter workspaces.
All specific document managers (Word, Excel, PowerPoint, Image) inherit from this base.
"""

import os
import re
import logging
import boto3
from typing import Dict, List, Optional, Any
from datetime import datetime
from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter

from .config import get_workspace_bucket

logger = logging.getLogger(__name__)


class BaseDocumentManager:
    """
    Base class for document management with S3 and Code Interpreter sync.

    Can be extended for different document types (Word, PowerPoint, Excel, Image).
    Pattern mirrors ReportManager from Research Agent for consistency.
    """

    def __init__(self, user_id: str, session_id: str, document_type: str):
        """
        Args:
            user_id: User identifier
            session_id: Session identifier (for workspace isolation)
            document_type: Document type ('word', 'powerpoint', 'excel', 'image')
        """
        # Security: Validate identifiers (same as ReportManager)
        if not re.match(r'^[a-zA-Z0-9_-]+$', user_id):
            raise ValueError(f"Invalid user_id: {user_id}")
        if not re.match(r'^[a-zA-Z0-9_-]+$', session_id):
            raise ValueError(f"Invalid session_id: {session_id}")

        self.user_id = user_id
        self.session_id = session_id
        self.document_type = document_type

        # S3 configuration (session-isolated)
        self.s3_client = boto3.client('s3')
        # Get bucket from centralized config
        self.bucket = get_workspace_bucket()
        self.s3_prefix = f"documents/{user_id}/{session_id}/{document_type}"

        # Code Interpreter path (use current directory, no subdirectory like diagram_tool)
        # Code Interpreter sessions are automatically isolated
        self.ci_work_path = ""

        # AWS region for Code Interpreter
        self.region = os.getenv('AWS_REGION', 'us-west-2')

        logger.info(f"DocumentManager initialized: user={user_id}, session={session_id}, type={document_type}")
        logger.info(f"S3 path: s3://{self.bucket}/{self.s3_prefix}")

    def get_s3_key(self, filename: str) -> str:
        """Generate S3 key for filename"""
        return f"{self.s3_prefix}/{filename}"

    def get_ci_path(self, filename: str) -> str:
        """Generate Code Interpreter file path (filename only, no directory)"""
        return filename

    def save_to_s3(self, filename: str, file_bytes: bytes, metadata: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """Save file to S3 storage

        Args:
            filename: Document filename (e.g., 'report.docx')
            file_bytes: File content as bytes
            metadata: Optional S3 object metadata

        Returns:
            Dict with s3_key, s3_url, size
        """
        try:
            s3_key = self.get_s3_key(filename)

            # Prepare metadata
            s3_metadata = metadata or {}
            s3_metadata['user_id'] = self.user_id
            s3_metadata['session_id'] = self.session_id
            s3_metadata['document_type'] = self.document_type
            s3_metadata['upload_time'] = datetime.utcnow().isoformat()

            # Determine ContentType based on document type
            content_type_map = {
                'word': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'excel': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'powerpoint': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
            }

            # For images, determine MIME type from file extension
            if self.document_type == 'image':
                extension = filename.lower().split('.')[-1]
                image_mime_map = {
                    'png': 'image/png',
                    'jpg': 'image/jpeg',
                    'jpeg': 'image/jpeg',
                    'gif': 'image/gif',
                    'webp': 'image/webp',
                    'bmp': 'image/bmp'
                }
                content_type = image_mime_map.get(extension, 'image/png')
            else:
                content_type = content_type_map.get(self.document_type, 'application/octet-stream')

            # Upload to S3
            self.s3_client.put_object(
                Bucket=self.bucket,
                Key=s3_key,
                Body=file_bytes,
                Metadata=s3_metadata,
                ContentType=content_type
            )

            size_kb = len(file_bytes) / 1024
            logger.info(f"✅ Saved to S3: {s3_key} ({size_kb:.1f} KB)")

            return {
                's3_key': s3_key,
                's3_url': f"s3://{self.bucket}/{s3_key}",
                'size': len(file_bytes),
                'size_kb': f"{size_kb:.1f} KB"
            }

        except Exception as e:
            logger.error(f"Failed to save to S3: {e}")
            raise

    def load_from_s3(self, filename: str) -> bytes:
        """Load file from S3 storage

        Args:
            filename: Document filename

        Returns:
            File content as bytes
        """
        try:
            s3_key = self.get_s3_key(filename)

            response = self.s3_client.get_object(
                Bucket=self.bucket,
                Key=s3_key
            )

            file_bytes = response['Body'].read()
            size_kb = len(file_bytes) / 1024
            logger.info(f"✅ Loaded from S3: {s3_key} ({size_kb:.1f} KB)")

            return file_bytes

        except self.s3_client.exceptions.NoSuchKey:
            logger.error(f"File not found in S3: {filename}")
            raise FileNotFoundError(f"Document not found: {filename}")
        except Exception as e:
            logger.error(f"Failed to load from S3: {e}")
            raise

    def list_s3_documents(self) -> List[Dict[str, Any]]:
        """List all documents in S3 for this session

        Returns:
            List of document info dicts with filename, size, last_modified
        """
        try:
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket,
                Prefix=self.s3_prefix + "/"
            )

            documents = []
            if 'Contents' in response:
                for obj in response['Contents']:
                    # Extract filename from S3 key
                    filename = obj['Key'].split('/')[-1]
                    if filename:  # Skip directory markers
                        documents.append({
                            'filename': filename,
                            'size': obj['Size'],
                            'size_kb': f"{obj['Size'] / 1024:.1f} KB",
                            'last_modified': obj['LastModified'].isoformat(),
                            's3_key': obj['Key']
                        })

            logger.info(f"Found {len(documents)} documents in S3")
            return documents

        except Exception as e:
            logger.error(f"Failed to list S3 documents: {e}")
            raise

    def delete_from_s3(self, filename: str) -> bool:
        """Delete file from S3 storage

        Args:
            filename: Document filename

        Returns:
            True if deleted successfully
        """
        try:
            s3_key = self.get_s3_key(filename)

            self.s3_client.delete_object(
                Bucket=self.bucket,
                Key=s3_key
            )

            logger.info(f"✅ Deleted from S3: {s3_key}")
            return True

        except Exception as e:
            logger.error(f"Failed to delete from S3: {e}")
            raise

    def upload_to_code_interpreter(
        self,
        code_interpreter: CodeInterpreter,
        filename: str,
        file_bytes: bytes
    ) -> str:
        """Upload file to Code Interpreter workspace using Python code

        Args:
            code_interpreter: Active CodeInterpreter instance
            filename: Document filename
            file_bytes: File content as bytes

        Returns:
            File path in Code Interpreter
        """
        try:
            import base64
            ci_path = self.get_ci_path(filename)

            # Write file using Python code (deterministic approach)
            encoded_bytes = base64.b64encode(file_bytes).decode('utf-8')
            write_code = f"""
import base64

# Decode and write file
file_bytes = base64.b64decode('{encoded_bytes}')
with open('{ci_path}', 'wb') as f:
    f.write(file_bytes)

print(f"File written: {ci_path} ({{len(file_bytes)}} bytes)")
"""

            response = code_interpreter.invoke("executeCode", {
                "code": write_code,
                "language": "python",
                "clearContext": False
            })

            # Check for errors
            for event in response.get("stream", []):
                result = event.get("result", {})
                if result.get("isError", False):
                    error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                    raise Exception(f"Failed to write file: {error_msg[:500]}")

            size_kb = len(file_bytes) / 1024
            logger.info(f"✅ Uploaded to Code Interpreter: {ci_path} ({size_kb:.1f} KB)")

            return ci_path

        except Exception as e:
            logger.error(f"Failed to upload to Code Interpreter: {e}")
            raise

    def download_from_code_interpreter(
        self,
        code_interpreter: CodeInterpreter,
        filename: str
    ) -> bytes:
        """Download file from Code Interpreter workspace

        Args:
            code_interpreter: Active CodeInterpreter instance
            filename: Document filename

        Returns:
            File content as bytes
        """
        try:
            ci_path = self.get_ci_path(filename)

            # Download from Code Interpreter using readFiles API
            download_response = code_interpreter.invoke("readFiles", {"paths": [ci_path]})

            file_bytes = None
            for event in download_response.get("stream", []):
                result = event.get("result", {})
                if "content" in result and len(result["content"]) > 0:
                    content_block = result["content"][0]
                    # File content can be in 'data' (bytes) or 'resource.blob'
                    if "data" in content_block:
                        file_bytes = content_block["data"]
                    elif "resource" in content_block and "blob" in content_block["resource"]:
                        file_bytes = content_block["resource"]["blob"]

                    if file_bytes:
                        break

            if not file_bytes:
                raise Exception(f"No file content returned for {ci_path}")

            size_kb = len(file_bytes) / 1024
            logger.info(f"✅ Downloaded from Code Interpreter: {ci_path} ({size_kb:.1f} KB)")

            return file_bytes

        except Exception as e:
            logger.error(f"Failed to download from Code Interpreter: {e}")
            raise

    def sync_to_both(
        self,
        code_interpreter: CodeInterpreter,
        filename: str,
        file_bytes: bytes,
        metadata: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """Save file to both S3 and Code Interpreter simultaneously

        Args:
            code_interpreter: Active CodeInterpreter instance
            filename: Document filename
            file_bytes: File content as bytes
            metadata: Optional S3 metadata

        Returns:
            Dict with s3_info and ci_path
        """
        try:
            # Upload to Code Interpreter first (faster, user can start working immediately)
            ci_path = self.upload_to_code_interpreter(code_interpreter, filename, file_bytes)

            # Save to S3 for persistence
            s3_info = self.save_to_s3(filename, file_bytes, metadata)

            logger.info(f"✅ Synced to both: {filename}")

            return {
                's3_info': s3_info,
                'ci_path': ci_path,
                'filename': filename,
                'size': len(file_bytes)
            }

        except Exception as e:
            logger.error(f"Failed to sync to both: {e}")
            raise

    def ensure_file_in_ci(
        self,
        code_interpreter: CodeInterpreter,
        filename: str
    ) -> str:
        """Load file from S3 to Code Interpreter workspace

        Always loads from S3 (S3 is the single source of truth).
        No caching in Code Interpreter - ensures consistency.

        Args:
            code_interpreter: Active CodeInterpreter instance
            filename: Document filename

        Returns:
            File path in Code Interpreter
        """
        try:
            logger.info(f"Loading file from S3 to Code Interpreter: {filename}")

            # Load from S3 and upload to Code Interpreter
            file_bytes = self.load_from_s3(filename)
            ci_path = self.upload_to_code_interpreter(code_interpreter, filename, file_bytes)

            logger.info(f"✅ File loaded from S3 to Code Interpreter: {filename}")

            return ci_path

        except Exception as e:
            logger.error(f"Failed to load file to Code Interpreter: {e}")
            raise

    def generate_presigned_url(self, filename: str, expiration: int = 900) -> str:
        """Generate presigned URL for file download

        Args:
            filename: Document filename
            expiration: URL expiration in seconds (default: 15 minutes)

        Returns:
            Presigned download URL
        """
        try:
            s3_key = self.get_s3_key(filename)

            url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket,
                    'Key': s3_key
                },
                ExpiresIn=expiration
            )

            logger.info(f"Generated presigned URL for {filename} (expires in {expiration}s)")
            return url

        except Exception as e:
            logger.error(f"Failed to generate presigned URL: {e}")
            raise

    def load_workspace_images_to_ci(self, code_interpreter) -> List[str]:
        """Load all images from S3 workspace to Code Interpreter

        This method loads all images from the S3 workspace and uploads them
        to the Code Interpreter workspace, making them available for document generation.

        Args:
            code_interpreter: Active CodeInterpreter instance

        Returns:
            List of loaded image filenames
        """
        try:
            # Lazy import to avoid circular dependency
            from .managers import ImageManager

            # Initialize image document manager for same user/session
            image_manager = ImageManager(self.user_id, self.session_id)

            # List all images from S3 workspace
            images = image_manager.list_s3_documents()

            if not images:
                logger.info("No images found in workspace")
                return []

            logger.info(f"Found {len(images)} image(s) in workspace: {[img['filename'] for img in images]}")

            # Load each image from S3 and upload to Code Interpreter
            loaded_filenames = []
            for image_info in images:
                try:
                    filename = image_info['filename']

                    # Load image bytes from S3
                    file_bytes = image_manager.load_from_s3(filename)

                    # Upload to Code Interpreter
                    self._upload_image_to_ci(code_interpreter, filename, file_bytes)

                    loaded_filenames.append(filename)
                    logger.info(f"✅ Loaded image from S3 workspace: {filename}")

                except Exception as e:
                    logger.error(f"Failed to load image {filename} from workspace: {e}")
                    continue

            return loaded_filenames

        except Exception as e:
            logger.error(f"Failed to load workspace images: {e}")
            return []

    def _upload_image_to_ci(self, code_interpreter, filename: str, file_bytes: bytes) -> None:
        """Upload a single image file to Code Interpreter workspace

        Args:
            code_interpreter: Active CodeInterpreter instance
            filename: Image filename
            file_bytes: Image file bytes
        """
        try:
            import base64
            encoded_bytes = base64.b64encode(file_bytes).decode('utf-8')

            write_code = f"""
import base64

# Decode and write image file
file_bytes = base64.b64decode('{encoded_bytes}')
with open('{filename}', 'wb') as f:
    f.write(file_bytes)

print(f"Image uploaded: {filename} ({{len(file_bytes)}} bytes)")
"""

            response = code_interpreter.invoke("executeCode", {
                "code": write_code,
                "language": "python",
                "clearContext": False
            })

            # Check for errors
            for event in response.get("stream", []):
                result = event.get("result", {})
                if result.get("isError", False):
                    error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                    logger.error(f"Failed to upload image {filename}: {error_msg[:200]}")
                    raise Exception(f"Failed to upload image: {error_msg[:200]}")

            logger.info(f"✅ Uploaded image to Code Interpreter: {filename}")

        except Exception as e:
            logger.error(f"Failed to upload image {filename}: {e}")
            raise

    def format_file_list(self, documents: List[Dict[str, Any]]) -> str:
        """Format document list for display

        Args:
            documents: List of document info dicts

        Returns:
            Formatted string with document list
        """
        if not documents:
            return f"📁 **Workspace** (empty)\n\nNo {self.document_type} files found."

        # Sort by last_modified (most recent first)
        sorted_docs = sorted(documents, key=lambda x: x['last_modified'], reverse=True)

        lines = [f"📁 **Workspace** ({len(documents)} file(s)):"]
        for doc in sorted_docs:
            # Format date to YYYY-MM-DD
            date_str = doc['last_modified'].split('T')[0]
            lines.append(f"  - {doc['filename']} ({doc['size_kb']}) - {date_str}")

        return "\n".join(lines)
