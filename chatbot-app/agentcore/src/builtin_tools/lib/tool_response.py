"""
Structured Tool Response Utility

Wraps tool response text and metadata into a JSON format that survives
the Strands SDK → Bedrock toolResult conversion pipeline.

The Bedrock toolResult spec only has (toolUseId, content, status) — no metadata field.
So any metadata returned by tools is dropped during conversion. This utility embeds
metadata inside the content text as JSON: {"text": "...", "metadata": {...}}

The event_formatter already parses this format and extracts metadata into the SSE event,
making it available to the frontend (e.g., for artifact creation, download buttons).
"""

import json
from typing import Dict, Any, Optional, List


def build_success_response(
    text: str,
    metadata: Dict[str, Any],
) -> Dict[str, Any]:
    """Build a structured success response that preserves metadata through the Strands pipeline.

    Args:
        text: Human-readable result text (markdown)
        metadata: Tool metadata (filename, tool_type, etc.) to pass to frontend

    Returns:
        Tool response dict with metadata embedded in content text as JSON
    """
    return {
        "content": [{"text": json.dumps({"text": text, "metadata": metadata}, ensure_ascii=False)}],
        "status": "success",
        "metadata": metadata,  # kept for backward compat (agent.state, etc.)
    }


def build_image_response(
    text_blocks: List[Dict[str, Any]],
    image_blocks: List[Dict[str, Any]],
    metadata: Dict[str, Any],
) -> Dict[str, Any]:
    """Build a response with images (preview tools) that preserves metadata.

    For preview tools that return images, we can't wrap everything in JSON.
    Instead, prepend a JSON metadata block before the image content.

    Args:
        text_blocks: List of {"text": "..."} content blocks
        image_blocks: List of image content blocks
        metadata: Tool metadata to pass to frontend

    Returns:
        Tool response dict with metadata in first content block
    """
    content = [
        {"text": json.dumps({"text": text_blocks[0]["text"] if text_blocks else "", "metadata": metadata}, ensure_ascii=False)},
    ]
    # Add remaining text blocks (skip first, already included above)
    for block in text_blocks[1:]:
        content.append(block)
    # Add image blocks
    content.extend(image_blocks)

    return {
        "content": content,
        "status": "success",
        "metadata": metadata,
    }
