"""
Report Manager - File-based state management for document generation

Manages:
- Draft markdown file storage
- Chart image storage
- Session-based workspace isolation
- S3 chart upload for persistent storage
"""

import os
import json
import re
import threading
import tempfile
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
from datetime import datetime

logger = logging.getLogger(__name__)

# S3 client (lazy initialization)
_s3_client = None
_s3_client_lock = threading.Lock()


def get_s3_client():
    """Get or create S3 client (thread-safe singleton)."""
    global _s3_client
    if _s3_client is None:
        with _s3_client_lock:
            if _s3_client is None:
                try:
                    import boto3
                    _s3_client = boto3.client('s3')
                    logger.info("S3 client initialized")
                except Exception as e:
                    logger.error(f"Failed to initialize S3 client: {e}")
                    _s3_client = None
    return _s3_client

# Global file locks for thread-safe operations
_file_locks: Dict[str, threading.Lock] = {}
_locks_lock = threading.Lock()


def get_file_lock(file_path: str) -> threading.Lock:
    """Get or create a lock for a specific file path."""
    with _locks_lock:
        if file_path not in _file_locks:
            _file_locks[file_path] = threading.Lock()
        return _file_locks[file_path]


class ReportManager:
    """
    File-based report state manager.

    Each session gets an isolated workspace:
    /tmp/document-generator/{session_id}/
    ├── research_report.md # Current markdown draft
    ├── charts/            # Generated chart images
    │   ├── chart1.png
    │   └── chart2.png
    └── output/            # Final documents
        └── report.docx
    """

    def __init__(self, session_id: str, user_id: Optional[str] = None, base_dir: Optional[str] = None):
        """
        Initialize report manager for a session.

        Args:
            session_id: Unique session identifier
            user_id: User identifier for S3 organization (optional)
            base_dir: Base directory for workspaces (default: /tmp/document-generator)

        Raises:
            ValueError: If session_id or user_id contains invalid characters or attempts path traversal
        """
        # Security: Validate session_id to prevent path traversal
        # Only allow alphanumeric, dash, and underscore (matches UUID format)
        if not re.match(r'^[a-zA-Z0-9_-]+$', session_id):
            raise ValueError(f"Invalid session_id format: {session_id}. Only alphanumeric, dash, and underscore are allowed.")

        # Security: Validate user_id
        if user_id and not re.match(r'^[a-zA-Z0-9_-]+$', user_id):
            raise ValueError(f"Invalid user_id format: {user_id}. Only alphanumeric, dash, and underscore are allowed.")

        self.session_id = session_id
        self.user_id = user_id or "default_user"
        self.base_dir = base_dir or os.path.join(tempfile.gettempdir(), "document-generator")

        # Create session workspace
        self.workspace = os.path.join(self.base_dir, session_id)
        self.draft_path = os.path.join(self.workspace, "research_report.md")  # Fixed filename
        self.charts_dir = os.path.join(self.workspace, "charts")
        self.output_dir = os.path.join(self.workspace, "output")

        # Security: Ensure workspace stays within base_dir (prevent path traversal)
        workspace_real = Path(self.workspace).resolve()
        base_real = Path(self.base_dir).resolve()

        if not str(workspace_real).startswith(str(base_real)):
            raise ValueError(f"Path traversal detected: workspace {workspace_real} is outside base directory {base_real}")

        os.makedirs(self.workspace, exist_ok=True)
        os.makedirs(self.charts_dir, exist_ok=True)
        os.makedirs(self.output_dir, exist_ok=True)

        logger.info(f"ReportManager initialized for user={user_id}, session={session_id}")
        logger.info(f"  Workspace: {self.workspace}")

    def save_draft(self, markdown_content: str) -> str:
        """
        Save markdown draft to file.

        Args:
            markdown_content: Markdown content to save

        Returns:
            Path to saved draft file
        """
        lock = get_file_lock(self.draft_path)
        with lock:
            with open(self.draft_path, 'w', encoding='utf-8') as f:
                f.write(markdown_content)

        logger.info(f"Draft saved: {self.draft_path} ({len(markdown_content)} chars)")
        return self.draft_path

    def draft_exists(self) -> bool:
        """
        Check if draft file exists.

        Returns:
            True if draft file exists, False otherwise
        """
        return os.path.exists(self.draft_path)

    def read_draft(self) -> str:
        """
        Read current draft content.

        Returns:
            Draft markdown content

        Raises:
            FileNotFoundError: If draft doesn't exist
        """
        if not os.path.exists(self.draft_path):
            raise FileNotFoundError(f"Draft not found: {self.draft_path}")

        lock = get_file_lock(self.draft_path)
        with lock:
            with open(self.draft_path, 'r', encoding='utf-8') as f:
                return f.read()

    def replace_text(self, find: str, replace: str, max_replacements: int = -1) -> int:
        """
        Find and replace text in draft.

        Args:
            find: Text to find
            replace: Replacement text
            max_replacements: Max replacements (-1 for all)

        Returns:
            Number of replacements made
        """
        if not os.path.exists(self.draft_path):
            raise FileNotFoundError(f"Draft not found: {self.draft_path}")

        lock = get_file_lock(self.draft_path)
        with lock:
            with open(self.draft_path, 'r', encoding='utf-8') as f:
                content = f.read()

            if max_replacements == -1:
                count = content.count(find)
                new_content = content.replace(find, replace)
            else:
                parts = content.split(find, max_replacements)
                new_content = replace.join(parts)
                count = min(content.count(find), max_replacements)

            with open(self.draft_path, 'w', encoding='utf-8') as f:
                f.write(new_content)

        logger.info(f"Replaced {count} occurrence(s) of text")
        return count

    def save_chart(self, chart_id: str, image_bytes: bytes) -> Dict[str, str]:
        """
        Save chart image locally and upload to S3.

        Args:
            chart_id: Chart identifier (used as filename)
            image_bytes: PNG image bytes

        Returns:
            Dict with 'local_path' and 's3_key' (or None if S3 upload failed)
        """
        # Save locally
        chart_path = os.path.join(self.charts_dir, f"{chart_id}.png")
        with open(chart_path, 'wb') as f:
            f.write(image_bytes)

        logger.info(f"Chart saved locally: {chart_path} ({len(image_bytes)} bytes)")

        # Upload to S3 (REQUIRED - no fallback)
        s3_bucket = os.getenv('ARTIFACT_BUCKET')

        if not s3_bucket:
            raise ValueError("ARTIFACT_BUCKET environment variable is not set. S3 upload is required for chart storage.")

        s3_client = get_s3_client()
        if not s3_client:
            raise ValueError("Failed to create S3 client. Check AWS credentials and permissions.")

        # S3 key format: research-charts/{user_id}/{session_id}/{timestamp}_{chart_id}.png
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        s3_key = f"research-charts/{self.user_id}/{self.session_id}/{timestamp}_{chart_id}.png"

        s3_client.put_object(
            Bucket=s3_bucket,
            Key=s3_key,
            Body=image_bytes,
            ContentType='image/png'
        )

        logger.info(f"Chart uploaded to S3: s3://{s3_bucket}/{s3_key}")
        s3_key = f"s3://{s3_bucket}/{s3_key}"

        return {
            'local_path': chart_path,
            's3_key': s3_key
        }

    def get_chart_files(self) -> List[Dict[str, str]]:
        """
        Get list of all chart files in workspace.

        Returns:
            List of chart info dicts with 'id', 'path', 'title'
        """
        charts = []

        if not os.path.exists(self.charts_dir):
            return charts

        for filename in os.listdir(self.charts_dir):
            if filename.endswith('.png'):
                chart_id = filename[:-4]  # Remove .png
                charts.append({
                    'id': chart_id,
                    'path': os.path.join(self.charts_dir, filename),
                    'title': chart_id.replace('_', ' ').title()
                })

        return charts

    def parse_chart_markers(self) -> List[Dict[str, Any]]:
        """
        Parse chart markers from draft.

        Markers format:
        <!-- CHART:chart_id
        {
          "type": "bar",
          "title": "Chart Title",
          "data": [...]
        }
        -->

        Returns:
            List of chart specs with id, type, title, data
        """
        import re

        content = self.read_draft()

        # Pattern to match chart markers
        pattern = r'<!-- CHART:(\w+)\s*\n(.*?)\n-->'
        matches = re.findall(pattern, content, re.DOTALL)

        charts = []
        for chart_id, json_str in matches:
            try:
                spec = json.loads(json_str.strip())
                spec['id'] = chart_id
                charts.append(spec)
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse chart spec for {chart_id}: {e}")

        return charts

    def replace_chart_marker(self, chart_id: str, image_path: str) -> bool:
        """
        Replace chart marker with image reference.

        Args:
            chart_id: Chart identifier
            image_path: Path to generated chart image

        Returns:
            True if replacement was made
        """
        import re

        if not os.path.exists(self.draft_path):
            return False

        lock = get_file_lock(self.draft_path)
        with lock:
            with open(self.draft_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # Pattern to match specific chart marker
            pattern = rf'<!-- CHART:{chart_id}\s*\n.*?\n-->'

            # Get chart title from spec if available
            title_match = re.search(rf'<!-- CHART:{chart_id}\s*\n.*?"title":\s*"([^"]+)".*?\n-->', content, re.DOTALL)
            title = title_match.group(1) if title_match else chart_id.replace('_', ' ').title()

            # Replace with image reference
            replacement = f'![{title}]({image_path})\n\n*Figure: {title}*'

            new_content, count = re.subn(pattern, replacement, content, flags=re.DOTALL)

            if count > 0:
                with open(self.draft_path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                logger.info(f"Replaced chart marker: {chart_id}")
                return True

            return False

    def get_output_path(self, filename: str) -> str:
        """
        Get output file path.

        Args:
            filename: Output filename (e.g., 'report.docx')

        Returns:
            Full path to output file
        """
        return os.path.join(self.output_dir, filename)

    def cleanup(self):
        """Clean up workspace (optional, for testing)."""
        import shutil
        if os.path.exists(self.workspace):
            shutil.rmtree(self.workspace)
            logger.info(f"Workspace cleaned up: {self.workspace}")


# Session-based manager cache
_managers: Dict[str, ReportManager] = {}
_managers_lock = threading.Lock()


def get_report_manager(session_id: str, user_id: Optional[str] = None) -> ReportManager:
    """
    Get or create ReportManager for a session.

    Args:
        session_id: Session identifier
        user_id: User identifier (optional)

    Returns:
        ReportManager instance
    """
    with _managers_lock:
        if session_id not in _managers:
            _managers[session_id] = ReportManager(session_id, user_id)
        return _managers[session_id]
