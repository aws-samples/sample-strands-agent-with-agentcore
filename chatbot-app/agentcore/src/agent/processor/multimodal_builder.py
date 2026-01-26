"""
Multimodal Prompt Builder Module

Handles building multimodal prompts with text, images, and documents
for Strands Agent. Supports both local and cloud modes with proper
content block formatting for Bedrock APIs.

Usage:
    from agent.processor import build_prompt

    # Build prompt from message and files
    prompt, uploaded_files = build_prompt(
        message="Analyze this document",
        files=file_list,
        user_id=user_id,
        session_id=session_id,
        enabled_tools=enabled_tools,
    )
"""

import base64
import logging
import os
from typing import Any, Dict, List, Optional, Tuple

from agent.config.constants import (
    IMAGE_EXTENSIONS,
    DOCUMENT_EXTENSIONS,
    OFFICE_EXTENSIONS,
    EnvVars,
)
from agent.processor.file_processor import (
    sanitize_full_filename,
    auto_store_files,
)

logger = logging.getLogger(__name__)

# Check for AgentCore Memory availability
try:
    from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
    AGENTCORE_MEMORY_AVAILABLE = True
except ImportError:
    AGENTCORE_MEMORY_AVAILABLE = False


def get_image_format(content_type: str, filename: str) -> str:
    """
    Determine image format from content type or filename.

    Args:
        content_type: MIME content type
        filename: File name

    Returns:
        Image format string for Bedrock API (png, jpeg, gif, webp)
    """
    if "png" in content_type or filename.endswith(".png"):
        return "png"
    elif "jpeg" in content_type or "jpg" in content_type or filename.endswith((".jpg", ".jpeg")):
        return "jpeg"
    elif "gif" in content_type or filename.endswith(".gif"):
        return "gif"
    elif "webp" in content_type or filename.endswith(".webp"):
        return "webp"
    else:
        return "png"  # default


def get_document_format(filename: str) -> str:
    """
    Determine document format from filename.

    Args:
        filename: File name with extension

    Returns:
        Document format string for Bedrock API
    """
    extension_map = {
        ".pdf": "pdf",
        ".csv": "csv",
        ".doc": "doc",
        ".docx": "docx",
        ".xls": "xls",
        ".xlsx": "xlsx",
        ".html": "html",
        ".txt": "txt",
        ".md": "md",
    }

    for ext, fmt in extension_map.items():
        if filename.endswith(ext):
            return fmt
    return "txt"  # default


def _is_cloud_mode() -> bool:
    """Check if running in cloud mode (AgentCore Memory available)."""
    memory_id = os.environ.get(EnvVars.MEMORY_ID)
    return memory_id is not None and AGENTCORE_MEMORY_AVAILABLE


def _build_file_hints(
    sanitized_filenames: List[str],
    workspace_only_files: List[str],
    enabled_tools: Optional[List[str]],
) -> str:
    """
    Build file hints section for prompt.

    Creates human-readable hints about uploaded files and how to access them.

    Args:
        sanitized_filenames: All sanitized file names
        workspace_only_files: Files only in workspace (not sent as ContentBlock)
        enabled_tools: List of enabled tool IDs

    Returns:
        Formatted file hints string
    """
    # Categorize files
    pptx_files = [fn for fn in sanitized_filenames if fn.endswith('.pptx')]
    docx_files = [fn for fn in workspace_only_files if fn.endswith('.docx')]
    xlsx_files = [fn for fn in workspace_only_files if fn.endswith('.xlsx')]
    # Files sent as ContentBlocks (not in workspace_only_files)
    attached_files = [fn for fn in sanitized_filenames if fn not in workspace_only_files]

    file_hints_lines = []

    # Add files sent as ContentBlocks (attached directly)
    if attached_files:
        file_hints_lines.append("Attached files:")
        file_hints_lines.extend([f"- {fn}" for fn in attached_files])

    # Add workspace-only files with tool hints
    # Word documents
    if docx_files:
        if file_hints_lines:
            file_hints_lines.append("")
        word_tools_enabled = enabled_tools and 'word_document_tools' in enabled_tools
        file_hints_lines.append("Word documents in workspace:")
        for fn in docx_files:
            name_without_ext = fn.rsplit('.', 1)[0] if '.' in fn else fn
            if word_tools_enabled:
                file_hints_lines.append(f"- {fn} (use read_word_document('{name_without_ext}') to view content)")
            else:
                file_hints_lines.append(f"- {fn}")

    # Excel spreadsheets
    if xlsx_files:
        if file_hints_lines:
            file_hints_lines.append("")
        excel_tools_enabled = enabled_tools and 'excel_spreadsheet_tools' in enabled_tools
        file_hints_lines.append("Excel spreadsheets in workspace:")
        for fn in xlsx_files:
            name_without_ext = fn.rsplit('.', 1)[0] if '.' in fn else fn
            if excel_tools_enabled:
                file_hints_lines.append(f"- {fn} (use read_excel_spreadsheet('{name_without_ext}') to view content)")
            else:
                file_hints_lines.append(f"- {fn}")

    # PowerPoint presentations
    if pptx_files:
        if file_hints_lines:
            file_hints_lines.append("")
        ppt_tools_enabled = enabled_tools and 'powerpoint_presentation_tools' in enabled_tools
        file_hints_lines.append("PowerPoint presentations in workspace:")
        for fn in pptx_files:
            name_without_ext = fn.rsplit('.', 1)[0] if '.' in fn else fn
            if ppt_tools_enabled:
                file_hints_lines.append(f"- {fn} (use analyze_presentation('{name_without_ext}', verbose=False) to view content)")
            else:
                file_hints_lines.append(f"- {fn}")

    return "\n".join(file_hints_lines) if file_hints_lines else ""


def build_prompt(
    message: str,
    files: Optional[List[Any]] = None,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    enabled_tools: Optional[List[str]] = None,
    auto_store: bool = True,
) -> Tuple[Any, List[Dict[str, Any]]]:
    """
    Build prompt for Strands Agent and prepare uploaded files for tools.

    Handles multimodal input including text, images, and documents.
    In cloud mode, documents are stored to workspace instead of sent
    as ContentBlocks to avoid AgentCore Memory serialization errors.

    Args:
        message: User message text
        files: Optional list of FileContent objects with base64 bytes
        user_id: User identifier (for workspace storage)
        session_id: Session identifier (for workspace storage)
        enabled_tools: List of enabled tool IDs (for file hints)
        auto_store: Whether to auto-store files to workspace

    Returns:
        tuple: (prompt, uploaded_files)
            - prompt: str or list[ContentBlock] for Strands Agent
            - uploaded_files: list of dicts with filename, bytes, content_type

    Example:
        prompt, files = build_prompt(
            message="Analyze this image",
            files=[image_file],
            user_id="user-123",
            session_id="sess-456",
        )
        agent.stream(prompt)
    """
    # If no files, return simple text message
    if not files or len(files) == 0:
        return message, []

    # Check if using AgentCore Memory (cloud mode)
    # AgentCore Memory has a bug where bytes in document ContentBlock cause JSON serialization errors
    # In cloud mode, we skip document ContentBlocks and rely on workspace tools instead
    is_cloud_mode = _is_cloud_mode()

    # Build ContentBlock list for multimodal input
    content_blocks: List[Dict[str, Any]] = []
    uploaded_files: List[Dict[str, Any]] = []

    # Add text first (file hints will be added after sanitization)
    text_block_content = message

    # Track sanitized filenames for agent's reference
    sanitized_filenames: List[str] = []

    # Track files that will use workspace tools (not sent as ContentBlock)
    workspace_only_files: List[str] = []

    # Add each file as appropriate ContentBlock
    for file in files:
        content_type = file.content_type.lower()
        filename = file.filename.lower()

        # Decode base64 to bytes (do this only once)
        file_bytes = base64.b64decode(file.bytes)

        # Sanitize filename for consistency (used in S3 storage and tool invocation_state)
        sanitized_full_name = sanitize_full_filename(file.filename)

        # Store for tool invocation_state with sanitized filename
        uploaded_files.append({
            'filename': sanitized_full_name,
            'bytes': file_bytes,
            'content_type': file.content_type
        })

        # Track sanitized filename for agent's reference
        sanitized_filenames.append(sanitized_full_name)

        # Determine file type and create appropriate ContentBlock
        if content_type.startswith("image/") or filename.endswith(IMAGE_EXTENSIONS):
            # Image content - always send as ContentBlock (works in both local and cloud)
            image_format = get_image_format(content_type, filename)
            content_blocks.append({
                "image": {
                    "format": image_format,
                    "source": {
                        "bytes": file_bytes
                    }
                }
            })
            logger.debug(f"Added image: {filename} (format: {image_format})")

        elif filename.endswith(".pptx"):
            # PowerPoint - always use workspace (never sent as ContentBlock)
            workspace_only_files.append(sanitized_full_name)
            logger.debug(f"PowerPoint presentation uploaded: {sanitized_full_name} (will be stored in workspace, not sent to model)")

        elif filename.endswith((".docx", ".xlsx")):
            # Word/Excel documents - use workspace in cloud mode to avoid bytes serialization error
            if is_cloud_mode:
                workspace_only_files.append(sanitized_full_name)
                logger.debug(f"[Cloud Mode] {sanitized_full_name} stored in workspace (skipping document ContentBlock to avoid AgentCore Memory serialization error)")
            else:
                # Local mode - can send as document ContentBlock
                doc_format = get_document_format(filename)
                name_without_ext = sanitized_full_name.rsplit('.', 1)[0] if '.' in sanitized_full_name else sanitized_full_name

                content_blocks.append({
                    "document": {
                        "format": doc_format,
                        "name": name_without_ext,
                        "source": {
                            "bytes": file_bytes
                        }
                    }
                })
                logger.debug(f"Added document: {file.filename} -> {sanitized_full_name} (format: {doc_format})")

        elif filename.endswith(tuple(DOCUMENT_EXTENSIONS)):
            # Other documents - send as ContentBlock (PDF, CSV, etc. are usually smaller and work better)
            doc_format = get_document_format(filename)

            # For Bedrock ContentBlock: name should be WITHOUT extension (extension is in format field)
            name_without_ext = sanitized_full_name.rsplit('.', 1)[0] if '.' in sanitized_full_name else sanitized_full_name

            content_blocks.append({
                "document": {
                    "format": doc_format,
                    "name": name_without_ext,
                    "source": {
                        "bytes": file_bytes
                    }
                }
            })
            logger.debug(f"Added document: {file.filename} -> {sanitized_full_name} (format: {doc_format})")

        else:
            logger.warning(f"Unsupported file type: {filename} ({content_type})")

    # Add file hints to text block (so agent knows the exact filenames stored in workspace)
    if sanitized_filenames:
        file_hints = _build_file_hints(sanitized_filenames, workspace_only_files, enabled_tools)
        if file_hints:
            text_block_content = f"{text_block_content}\n\n<uploaded_files>\n{file_hints}\n</uploaded_files>"
            logger.debug(f"Added file hints to prompt: {sanitized_filenames}")

    # Insert text block at the beginning of content_blocks
    content_blocks.insert(0, {"text": text_block_content})

    # Auto-store files to workspace (Word, Excel, images)
    if auto_store and user_id and session_id:
        auto_store_files(uploaded_files, user_id, session_id)

    return content_blocks, uploaded_files
