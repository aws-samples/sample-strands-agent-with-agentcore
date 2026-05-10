"""
Markdown Writer Tool - Section-based markdown document writing

Writes sections directly to markdown file without initialization step.
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import Optional
from strands import tool
from strands.types.tools import ToolContext
from report_manager import get_report_manager

logger = logging.getLogger(__name__)


def ensure_heading_linebreaks(content: str) -> str:
    """
    Ensure markdown headings have proper linebreaks before them.

    Markdown requires a blank line before headings for proper parsing.
    This function adds linebreaks where needed without affecting:
    - Headings inside code blocks (``` ... ```)
    - Headings that already have proper linebreaks

    Args:
        content: Markdown content to process

    Returns:
        Content with proper linebreaks before headings
    """
    if not content:
        return content

    # Split content to identify code blocks
    # We'll process only parts outside of code blocks
    code_block_pattern = r'(```[\s\S]*?```)'
    parts = re.split(code_block_pattern, content)

    processed_parts = []
    for i, part in enumerate(parts):
        # Odd indices are code blocks (captured groups), skip them
        if i % 2 == 1:
            processed_parts.append(part)
            continue

        # For non-code-block parts, ensure headings have linebreaks
        # Pattern: non-newline character followed by optional single newline, then heading
        # Replace with: original char + double newline + heading
        processed = re.sub(
            r'([^\n])(\n?)(#{1,6}\s+\S)',
            r'\1\n\n\3',
            part
        )
        processed_parts.append(processed)

    return ''.join(processed_parts)


@tool(context=True)
async def write_markdown_section(
    heading: str,
    content: str,
    citations: Optional[list] = None,
    tool_context: ToolContext = None
) -> str:
    """
    Write a section to the research report markdown file with optional citations.

    Args:
        heading: Section heading (e.g., "## Introduction", "## Key Findings")
        content: Section content with inline citations
        citations: List of citation objects for this section. Each citation should have:
                  - title: Source name (e.g., "MIT Technology Review")
                  - url: Full URL to the source
                  Example: [{"title": "MIT Tech Review", "url": "https://..."}]
        tool_context: Tool context (injected by framework)

    Returns:
        JSON string with success status and file path

    Example:
        write_markdown_section(
            "## Introduction",
            "AI market has grown significantly ([MIT Tech Review](https://...))...",
            [{"title": "MIT Technology Review", "url": "https://..."}]
        )
    """
    # Always use fixed filename
    filename = "research_report.md"
    try:
        # Get session ID and user ID from tool_context (same as generate_chart_tool)
        session_id = None
        user_id = "default_user"

        if tool_context:
            invocation_state = tool_context.invocation_state
            if invocation_state:
                # Try to get explicit session_id and user_id from request_state
                request_state = invocation_state.get("request_state", {})
                session_id = request_state.get("session_id")
                user_id = request_state.get("user_id", "default_user")

                # Use event_loop_parent_cycle_id
                if not session_id:
                    parent_cycle_id = invocation_state.get("event_loop_parent_cycle_id")
                    if parent_cycle_id:
                        session_id = str(parent_cycle_id)
                    else:
                        cycle_id = invocation_state.get("event_loop_cycle_id")
                        if cycle_id:
                            session_id = str(cycle_id)

        if not session_id:
            raise ValueError("[write_markdown_section] No session_id found in tool_context")

        # Get report manager for session
        manager = get_report_manager(session_id, user_id)

        # Construct full file path in session workspace
        file_path = os.path.join(manager.workspace, filename)

        # Check if existing file ends with proper spacing for new heading
        # This ensures markdown headings are parsed correctly after images/captions
        prefix = ""
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                existing_content = f.read()
            if existing_content and not existing_content.endswith('\n\n'):
                # Add extra newline if file doesn't end with blank line
                if existing_content.endswith('\n'):
                    prefix = "\n"
                else:
                    prefix = "\n\n"

        # Prepare section content
        section_content = f"{prefix}{heading}\n\n{content}\n\n"

        # Add citations if provided (domain-based markdown links)
        if citations and len(citations) > 0:
            from urllib.parse import urlparse
            citation_links = []
            for citation in citations:
                url = citation.get('url', '#')
                # Extract domain from URL
                try:
                    domain = urlparse(url).netloc or url
                    domain = domain.replace('www.', '')
                except:
                    domain = url
                # Use markdown link format with domain as text
                citation_links.append(f'[{domain}]({url})')

            section_content += ' '.join(citation_links) + '\n\n'
            logger.info(f"Added {len(citations)} citations to section: {heading}")

        # Append to file (create if doesn't exist)
        with open(file_path, 'a', encoding='utf-8') as f:
            f.write(section_content)

        logger.info(f"Section written to {file_path}: {heading}")

        return json.dumps({
            "success": True,
            "message": f"Section '{heading}' written successfully",
            "file_path": file_path,
            "session_id": session_id,
            "heading": heading
        }, indent=2)

    except Exception as e:
        logger.error(f"Error writing markdown section: {e}")
        return json.dumps({
            "success": False,
            "error": str(e),
            "heading": heading,
            "filename": filename
        }, indent=2)


@tool(context=True)
async def add_markdown_reference(
    source_name: str,
    url: str,
    tool_context: ToolContext = None
) -> str:
    """
    Add a reference to the References section of the research report.
    Creates References section if it doesn't exist.

    Args:
        source_name: Name of the source (e.g., "MIT Technology Review")
        url: URL of the source
        tool_context: Tool context (injected by framework)

    Returns:
        JSON string with success status

    Example:
        add_markdown_reference("Wikipedia - AI", "https://en.wikipedia.org/wiki/AI")
    """
    # Always use fixed filename
    filename = "research_report.md"
    try:
        # Get session ID and user ID from tool_context
        session_id = None
        user_id = "default_user"

        if tool_context:
            invocation_state = tool_context.invocation_state
            if invocation_state:
                request_state = invocation_state.get("request_state", {})
                session_id = request_state.get("session_id")
                user_id = request_state.get("user_id", "default_user")

                if not session_id:
                    parent_cycle_id = invocation_state.get("event_loop_parent_cycle_id")
                    if parent_cycle_id:
                        session_id = str(parent_cycle_id)
                    else:
                        cycle_id = invocation_state.get("event_loop_cycle_id")
                        if cycle_id:
                            session_id = str(cycle_id)

        if not session_id:
            raise ValueError("[add_markdown_reference] No session_id found in tool_context")

        # Get report manager for session
        manager = get_report_manager(session_id, user_id)

        # Construct full file path
        file_path = os.path.join(manager.workspace, filename)

        # Read existing content
        existing_content = ""
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                existing_content = f.read()

        # Check if References section exists
        if "## References" not in existing_content:
            # Add References section header
            with open(file_path, 'a', encoding='utf-8') as f:
                f.write("## References\n\n")

        # Add reference entry
        reference_entry = f"- [{source_name}]({url})\n"
        with open(file_path, 'a', encoding='utf-8') as f:
            f.write(reference_entry)

        logger.info(f"Reference added to {file_path}: {source_name}")

        return json.dumps({
            "success": True,
            "message": f"Reference '{source_name}' added successfully",
            "file_path": file_path,
            "source_name": source_name,
            "url": url
        }, indent=2)

    except Exception as e:
        logger.error(f"Error adding reference: {e}")
        return json.dumps({
            "success": False,
            "error": str(e),
            "source_name": source_name,
            "url": url
        }, indent=2)


@tool(context=True)
async def read_markdown_file(
    tool_context: ToolContext = None
) -> str:
    """
    Read the current content of the research report markdown file.

    Args:
        tool_context: Tool context (injected by framework)

    Returns:
        JSON string with file content
    """
    # Always use fixed filename
    filename = "research_report.md"
    try:
        # Get session ID and user ID from tool_context
        session_id = None
        user_id = "default_user"

        if tool_context:
            invocation_state = tool_context.invocation_state
            if invocation_state:
                request_state = invocation_state.get("request_state", {})
                session_id = request_state.get("session_id")
                user_id = request_state.get("user_id", "default_user")

                if not session_id:
                    parent_cycle_id = invocation_state.get("event_loop_parent_cycle_id")
                    if parent_cycle_id:
                        session_id = str(parent_cycle_id)
                    else:
                        cycle_id = invocation_state.get("event_loop_cycle_id")
                        if cycle_id:
                            session_id = str(cycle_id)

        if not session_id:
            raise ValueError("[read_markdown_file] No session_id found in tool_context")

        # Get report manager for session
        manager = get_report_manager(session_id, user_id)

        # Construct full file path
        file_path = os.path.join(manager.workspace, filename)

        # Check if file exists
        if not os.path.exists(file_path):
            return json.dumps({
                "success": True,
                "message": "File does not exist yet",
                "content": "",
                "file_path": file_path
            }, indent=2)

        # Read file content
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        logger.info(f"Read markdown file: {file_path} ({len(content)} chars)")

        return json.dumps({
            "success": True,
            "message": "File read successfully",
            "content": content,
            "file_path": file_path,
            "length": len(content)
        }, indent=2)

    except Exception as e:
        logger.error(f"Error reading markdown file: {e}")
        return json.dumps({
            "success": False,
            "error": str(e),
            "filename": filename
        }, indent=2)
