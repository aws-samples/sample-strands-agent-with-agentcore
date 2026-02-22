"""
PowerPoint Presentation Tools

Tools for creating and editing PowerPoint presentations.
- create_presentation: Creates new presentations using PptxGenJS (JavaScript) via Code Interpreter (Deno)
- All editing tools: Direct XML manipulation via PptxEngine (no Code Interpreter required)
"""

import json
import logging
import os
import re
from typing import Dict, Any

from strands import tool, ToolContext
from skill import register_skill
from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter
from workspace import PowerPointManager

from .lib.ppt_utils import (
    validate_presentation_name,
    sanitize_presentation_name,
    get_code_interpreter_id,
    get_user_session_ids,
    save_ppt_artifact,
    get_file_compatibility_error,
    make_error_response,
)
from .lib.tool_response import build_success_response, build_image_response
from .lib.pptx_engine import PptxEngine
from .lib.pptxgenjs_runner import run_pptxgenjs

logger = logging.getLogger(__name__)

# Backward compatibility aliases
_validate_presentation_name = validate_presentation_name
_sanitize_presentation_name_for_bedrock = sanitize_presentation_name
_get_code_interpreter_id = get_code_interpreter_id
_get_user_session_ids = get_user_session_ids
_save_ppt_artifact = save_ppt_artifact
_get_file_compatibility_error_response = get_file_compatibility_error


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_or_error(ppt_manager: PowerPointManager, filename: str):
    """Load bytes from S3 or return an error response dict."""
    try:
        return ppt_manager.load_from_s3(filename), None
    except FileNotFoundError:
        docs = ppt_manager.list_s3_documents()
        available = [d["filename"] for d in docs if d["filename"].endswith(".pptx")]
        msg = f"**Presentation not found**: {filename}"
        if available:
            msg += "\n\n**Available:**\n" + "\n".join(f"- {f}" for f in available)
        return None, {"content": [{"text": msg}], "status": "error"}


def _validate_names(source: str, output: str):
    """Validate source/output names and their difference. Returns error dict or None."""
    ok, msg = _validate_presentation_name(source)
    if not ok:
        return {"content": [{"text": f"**Invalid source name**: {source}\n\n{msg}"}], "status": "error"}
    ok, msg = _validate_presentation_name(output)
    if not ok:
        return {"content": [{"text": f"**Invalid output name**: {output}\n\n{msg}"}], "status": "error"}
    if source == output:
        return {"content": [{"text": "**Output name must be different from source name**"}], "status": "error"}
    return None


def _save_and_respond(
    ppt_manager, tool_context, output_filename, output_bytes,
    tool_name, user_id, session_id, success_msg, extra_meta=None
):
    """Save bytes to S3, register artifact, return success response."""
    s3_info = ppt_manager.save_to_s3(output_filename, output_bytes)
    _save_ppt_artifact(
        tool_context=tool_context,
        filename=output_filename,
        s3_url=s3_info["s3_url"],
        size_kb=s3_info["size_kb"],
        tool_name=tool_name,
        user_id=user_id,
        session_id=session_id,
    )
    meta = {
        "filename": output_filename,
        "s3_url": s3_info["s3_url"],
        "size_kb": s3_info["size_kb"],
        "tool_type": "powerpoint_presentation",
        "user_id": user_id,
        "session_id": session_id,
    }
    if extra_meta:
        meta.update(extra_meta)
    return build_success_response(success_msg, meta)


# ── Tools ─────────────────────────────────────────────────────────────────────

@tool
def get_slide_design_reference(topic: str = "all") -> Dict[str, Any]:
    """Get design guidelines for creating professional presentations with PptxGenJS.

    Returns color palettes, typography pairings, layout ideas, and common mistakes
    to avoid when generating slide code.

    Args:
        topic: "colors" | "typography" | "layouts" | "pitfalls" | "all"
    """
    guidelines = {
        "colors": """## Color Palettes (pick one per presentation)

| Theme             | Primary       | Secondary     | Accent        |
|-------------------|---------------|---------------|---------------|
| Midnight Executive| `1E2761` navy | `CADCFC` ice  | `FFFFFF` white|
| Forest & Moss     | `2C5F2D` forest| `97BC62` moss | `F5F5F5` cream|
| Coral Energy      | `F96167` coral| `F9E795` gold | `2F3C7E` navy |
| Warm Terracotta   | `B85042` terra| `E7E8D1` sand | `A7BEAE` sage |
| Ocean Gradient    | `065A82` deep | `1C7293` teal | `21295C` night|
| Charcoal Minimal  | `36454F` char | `F2F2F2` off-w| `212121` black|
| Teal Trust        | `028090` teal | `00A896` sea  | `02C39A` mint |
| Cherry Bold       | `990011` cherry| `FCF6F5` off-w| `2F3C7E` navy |

Rules:
- 60-70% dominant color, 1-2 supporting, 1 sharp accent
- Dark backgrounds for title/conclusion, light for content slides
- NEVER use "#" prefix with hex colors in PptxGenJS (corrupts file)
- NEVER encode opacity in hex string — use `opacity` property instead""",

        "typography": """## Typography Pairings

| Header Font   | Body Font   |
|---------------|-------------|
| Georgia       | Calibri     |
| Arial Black   | Arial       |
| Cambria       | Calibri     |
| Trebuchet MS  | Calibri     |

| Element        | Size      |
|----------------|-----------|
| Slide title    | 36-44pt bold |
| Section header | 20-24pt bold |
| Body text      | 14-16pt   |
| Captions       | 10-12pt   |

Rules:
- 0.5" minimum margins from slide edges
- 0.3-0.5" between content blocks
- Use `charSpacing` not `letterSpacing` (silently ignored)
- Use `breakLine: true` between array text items""",

        "layouts": """## Layout Ideas per Slide

Every slide needs a visual element — image, shape, icon, or chart.

- **Title slide**: Dark full-bleed background, large centered title, subtitle
- **Content**: Two-column (text left, visual right)
- **Stats**: Large number callouts (60-72pt) with small labels
- **Process**: Numbered steps with colored circles or arrows
- **Quote**: Large italic text, colored accent shape, attribution
- **Comparison**: Side-by-side columns with color-coded headers
- **Image**: Half-bleed image with text overlay
- **Section divider**: Bold color background, single centered heading

Use varied layouts — avoid repeating the same pattern slide after slide.""",

        "pitfalls": """## Common Mistakes to Avoid

1. **NEVER `#` prefix with hex colors** → corrupts file
2. **NEVER 8-char opacity hex** (e.g. `00000020`) → use `opacity: 0.12` instead
3. **NEVER unicode bullets** `•` → use `bullet: true`
4. **NEVER reuse option objects** across addShape calls → PptxGenJS mutates in-place
5. **NEVER accent lines under titles** → hallmark of AI-generated slides; use whitespace instead
6. **Don't repeat same layout** → vary columns, cards, callouts across slides
7. **Don't center body text** → left-align paragraphs; center only titles
8. **Don't use negative shadow offset** → use `angle: 270` with positive offset for upward shadow
9. **Don't use ROUNDED_RECTANGLE with accent borders** → use RECTANGLE instead
10. **Don't create text-only slides** → add shapes, images, or icons""",
    }

    if topic == "all":
        content = "\n\n".join(guidelines.values())
    elif topic in guidelines:
        content = guidelines[topic]
    else:
        return {"content": [{"text": f"Unknown topic: {topic}. Available: {list(guidelines.keys())} or 'all'"}], "status": "error"}

    return build_success_response(content, {"topic": topic})


@tool(context=True)
def list_my_powerpoint_presentations(tool_context: ToolContext) -> Dict[str, Any]:
    """List all PowerPoint presentations in workspace.

    Returns:
        Formatted list of presentations with metadata
    """
    try:
        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)
        documents = ppt_manager.list_s3_documents()
        workspace_list = ppt_manager.format_file_list(documents)
        return build_success_response(workspace_list, {
            "count": len(documents),
            "presentations": [doc["filename"] for doc in documents],
        })
    except Exception as e:
        logger.error(f"list_my_powerpoint_presentations error: {e}", exc_info=True)
        return {"content": [{"text": f"**Error listing presentations:** {str(e)}"}], "status": "error"}


@tool(context=True)
def get_presentation_layouts(
    presentation_name: str,
    tool_context: ToolContext,
) -> Dict[str, Any]:
    """Get all available slide layouts from a presentation.

    Returns layout names to use with add_slide. Call this before adding slides.

    Args:
        presentation_name: Presentation name WITHOUT extension (e.g., "sales-deck")
    """
    try:
        sanitized = _sanitize_presentation_name_for_bedrock(presentation_name)
        filename = f"{sanitized}.pptx"
        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        source_bytes, err = _load_or_error(ppt_manager, filename)
        if err:
            return err

        with PptxEngine(source_bytes) as engine:
            layouts = engine.get_layouts()

        text = f"**Available Layouts**: {filename}\n\n**Total:** {len(layouts)}\n\n"
        text += "\n".join(f'- "{l["name"]}" (index {l["index"]}, {l["placeholder_count"]} placeholders)' for l in layouts)

        return build_success_response(text, {
            "filename": filename,
            "layouts": layouts,
            "tool_type": "powerpoint_presentation",
            "user_id": user_id,
            "session_id": session_id,
        })
    except Exception as e:
        logger.error(f"get_presentation_layouts error: {e}", exc_info=True)
        return {"content": [{"text": f"**Error getting layouts:** {str(e)}"}], "status": "error"}


@tool(context=True)
def analyze_presentation(
    presentation_name: str,
    tool_context: ToolContext,
    slide_index: int | None = None,
    include_notes: bool = False,
) -> Dict[str, Any]:
    """Analyze presentation structure: element IDs, positions, text content.

    Element Types: text | picture | table | chart | group | unknown
    Role Tags: [TITLE] [BODY] [SUBTITLE] [FOOTER] (empty = regular shape)

    Args:
        presentation_name: Presentation name WITHOUT extension
        slide_index: Optional 0-based slide index. None = analyze all slides.
        include_notes: Include speaker notes in output (default False)
    """
    try:
        sanitized = _sanitize_presentation_name_for_bedrock(presentation_name)
        filename = f"{sanitized}.pptx"
        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        source_bytes, err = _load_or_error(ppt_manager, filename)
        if err:
            return err

        with PptxEngine(source_bytes) as engine:
            order = engine.get_slide_order()

            if slide_index is not None:
                if not (0 <= slide_index < len(order)):
                    return {"content": [{"text": f"**Invalid slide_index {slide_index}**: presentation has {len(order)} slides (0-{len(order)-1})"}], "status": "error"}
                targets = [(slide_index, order[slide_index]["filename"])]
            else:
                targets = [(i, s["filename"]) for i, s in enumerate(order)]

            slides_data = []
            for idx, slide_filename in targets:
                info = engine.analyze_slide(slide_filename, include_notes)
                slides_data.append({
                    "slide_index": idx,
                    "title": info.get("title"),
                    "elements": info.get("elements", []),
                    **({"notes": info.get("notes", "")} if include_notes else {}),
                })

        analysis = {"total_slides": len(order), "slides": slides_data}

        # Format output text
        if slide_index is not None:
            output_text = f"**Slide Analysis**: {filename} — Slide {slide_index + 1}\n\n"
        else:
            output_text = f"**Presentation Analysis**: {filename}\n\n**Total slides:** {len(order)}\n\n"

        for slide in slides_data:
            output_text += f"### Slide {slide['slide_index'] + 1}"
            if slide.get("title"):
                output_text += f": {slide['title']}"
            output_text += "\n"
            for elem in slide["elements"]:
                role_tag = f" [{elem['role']}]" if elem.get("role") else ""
                preview = (elem.get("text") or "")[:80].replace("\n", " ↵ ")
                output_text += (
                    f"  - id={elem['id']} type={elem['type']}{role_tag}"
                    f" pos=({elem['position']['left']}\", {elem['position']['top']}\")"
                    f"{f': {preview}' if preview else ''}\n"
                )
            if include_notes and slide.get("notes"):
                output_text += f"  📝 Notes: {slide['notes'][:100]}\n"
            output_text += "\n"

        return build_success_response(output_text, {
            "filename": filename,
            "analysis": analysis,
            "tool_type": "powerpoint_presentation",
            "user_id": user_id,
            "session_id": session_id,
        })
    except Exception as e:
        logger.error(f"analyze_presentation error: {e}", exc_info=True)
        return {"content": [{"text": f"**Error analyzing presentation:** {str(e)}"}], "status": "error"}


@tool(context=True)
def update_slide_content(
    presentation_name: str,
    slide_updates: list,
    output_name: str,
    tool_context: ToolContext,
) -> Dict[str, Any]:
    """Update one or more slides with operations in a single call.

    Args:
        presentation_name: Source presentation name WITHOUT extension
        slide_updates: List of slide update dicts:
            [
                {
                    "slide_index": int,  # 0-based
                    "operations": [
                        {"action": "set_text",     "element_id": int, "text": str},
                        {"action": "replace_text", "element_id": int, "find": str, "replace": str},
                        {"action": "replace_image","element_id": int, "image_name": str},
                    ]
                }
            ]
        output_name: Output name WITHOUT extension (must differ from source)

    Notes:
        - set_text: Multi-line text via \\n creates multiple paragraphs
        - replace_image: image_name is a filename from your image workspace (S3)
        - Batch all changes into ONE call to avoid parallel data loss
    """
    try:
        err = _validate_names(presentation_name, output_name)
        if err:
            return err
        if not slide_updates or not isinstance(slide_updates, list):
            return {"content": [{"text": "**Invalid slide_updates**: must be a non-empty list"}], "status": "error"}

        source_filename = f"{presentation_name}.pptx"
        output_filename = f"{output_name}.pptx"
        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        source_bytes, err = _load_or_error(ppt_manager, source_filename)
        if err:
            return err

        working_bytes = source_bytes
        with PptxEngine(working_bytes) as engine:
            order = engine.get_slide_order()
            for update in slide_updates:
                idx = update["slide_index"]
                if not (0 <= idx < len(order)):
                    raise ValueError(f"slide_index {idx} out of range (0-{len(order)-1})")
                slide_filename = order[idx]["filename"]
                for op in update.get("operations", []):
                    action = op.get("action")
                    eid = op.get("element_id")
                    if action == "set_text":
                        engine.set_text(slide_filename, eid, op["text"])
                    elif action == "replace_text":
                        engine.replace_text(slide_filename, eid, op["find"], op["replace"])
                    elif action == "replace_image":
                        image_name = op.get("image_name", "")
                        from workspace import ImageManager
                        img_manager = ImageManager(user_id, session_id)
                        img_bytes = img_manager.load_from_s3(image_name)
                        ext = image_name.rsplit(".", 1)[-1].lower() if "." in image_name else "png"
                        engine.replace_image(slide_filename, eid, img_bytes, ext)
                    else:
                        logger.warning(f"Unknown action '{action}' skipped")
            working_bytes = engine.pack()

        total_ops = sum(len(u.get("operations", [])) for u in slide_updates)
        success_msg = (
            f"**Updated**: {output_filename}\n\n"
            f"Applied {total_ops} operation(s) across {len(slide_updates)} slide(s)."
        )
        return _save_and_respond(
            ppt_manager, tool_context, output_filename, working_bytes,
            "update_slide_content", user_id, session_id, success_msg,
            {"slide_count": len(slide_updates), "operation_count": total_ops},
        )
    except Exception as e:
        logger.error(f"update_slide_content error: {e}", exc_info=True)
        return {"content": [{"text": f"**Error:** {str(e)}"}], "status": "error"}


@tool(context=True)
def add_slide(
    presentation_name: str,
    layout_name: str,
    position: int,
    output_name: str,
    tool_context: ToolContext,
) -> Dict[str, Any]:
    """Add a new blank slide at the given position.

    Use get_presentation_layouts() to get exact layout names.
    Use update_slide_content() afterwards to populate the slide with content.

    Args:
        presentation_name: Source presentation name WITHOUT extension
        layout_name: Exact layout name from get_presentation_layouts()
        position: Insert position (0-based). Use -1 to append at end.
        output_name: Output name WITHOUT extension (must differ from source)
    """
    try:
        err = _validate_names(presentation_name, output_name)
        if err:
            return err

        source_filename = f"{presentation_name}.pptx"
        output_filename = f"{output_name}.pptx"
        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        source_bytes, err = _load_or_error(ppt_manager, source_filename)
        if err:
            return err

        with PptxEngine(source_bytes) as engine:
            new_slide = engine.add_slide(layout_name, position)
            order = engine.get_slide_order()
            new_index = next(i for i, s in enumerate(order) if s["filename"] == new_slide)
            output_bytes = engine.pack()

        success_msg = (
            f"**Added slide**: {output_filename}\n\n"
            f"Layout: \"{layout_name}\" → Slide {new_index + 1} (index {new_index})\n\n"
            f"Use `update_slide_content` with slide_index={new_index} to add content."
        )
        return _save_and_respond(
            ppt_manager, tool_context, output_filename, output_bytes,
            "add_slide", user_id, session_id, success_msg,
            {"new_slide_index": new_index, "layout_name": layout_name},
        )
    except Exception as e:
        logger.error(f"add_slide error: {e}", exc_info=True)
        return {"content": [{"text": f"**Error:** {str(e)}"}], "status": "error"}


@tool(context=True)
def delete_slides(
    presentation_name: str,
    slide_indices: list,
    output_name: str,
    tool_context: ToolContext,
) -> Dict[str, Any]:
    """Delete slides by 0-based indices.

    Args:
        presentation_name: Source presentation name WITHOUT extension
        slide_indices: List of 0-based indices to delete (e.g., [2, 5, 10])
        output_name: Output name WITHOUT extension (must differ from source)
    """
    try:
        err = _validate_names(presentation_name, output_name)
        if err:
            return err
        if not slide_indices or not isinstance(slide_indices, list):
            return {"content": [{"text": "**Invalid slide_indices**: must be a non-empty list"}], "status": "error"}

        source_filename = f"{presentation_name}.pptx"
        output_filename = f"{output_name}.pptx"
        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        source_bytes, err = _load_or_error(ppt_manager, source_filename)
        if err:
            return err

        with PptxEngine(source_bytes) as engine:
            total_before = len(engine.get_slide_order())
            engine.delete_slides(slide_indices)
            total_after = len(engine.get_slide_order())
            output_bytes = engine.pack()

        success_msg = (
            f"**Deleted slides**: {output_filename}\n\n"
            f"Removed {total_before - total_after} slide(s). "
            f"Remaining: {total_after}"
        )
        return _save_and_respond(
            ppt_manager, tool_context, output_filename, output_bytes,
            "delete_slides", user_id, session_id, success_msg,
            {"deleted_count": total_before - total_after, "remaining_count": total_after},
        )
    except Exception as e:
        logger.error(f"delete_slides error: {e}", exc_info=True)
        return {"content": [{"text": f"**Error:** {str(e)}"}], "status": "error"}


@tool(context=True)
def move_slide(
    presentation_name: str,
    from_index: int,
    to_index: int,
    output_name: str,
    tool_context: ToolContext,
) -> Dict[str, Any]:
    """Move a slide from one position to another.

    Args:
        presentation_name: Source presentation name WITHOUT extension
        from_index: Source position (0-based)
        to_index: Target position (0-based)
        output_name: Output name WITHOUT extension (must differ from source)
    """
    try:
        err = _validate_names(presentation_name, output_name)
        if err:
            return err

        source_filename = f"{presentation_name}.pptx"
        output_filename = f"{output_name}.pptx"
        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        source_bytes, err = _load_or_error(ppt_manager, source_filename)
        if err:
            return err

        with PptxEngine(source_bytes) as engine:
            engine.move_slide(from_index, to_index)
            output_bytes = engine.pack()

        success_msg = (
            f"**Moved slide**: {output_filename}\n\n"
            f"Slide {from_index + 1} → position {to_index + 1}"
        )
        return _save_and_respond(
            ppt_manager, tool_context, output_filename, output_bytes,
            "move_slide", user_id, session_id, success_msg,
            {"from_index": from_index, "to_index": to_index},
        )
    except Exception as e:
        logger.error(f"move_slide error: {e}", exc_info=True)
        return {"content": [{"text": f"**Error:** {str(e)}"}], "status": "error"}


@tool(context=True)
def duplicate_slide(
    presentation_name: str,
    source_index: int,
    output_name: str,
    tool_context: ToolContext,
    insert_position: int = -1,
) -> Dict[str, Any]:
    """Duplicate an existing slide.

    Args:
        presentation_name: Source presentation name WITHOUT extension
        source_index: Slide to duplicate (0-based)
        output_name: Output name WITHOUT extension (must differ from source)
        insert_position: Where to insert duplicate (0-based, -1 = append after source)
    """
    try:
        err = _validate_names(presentation_name, output_name)
        if err:
            return err

        source_filename = f"{presentation_name}.pptx"
        output_filename = f"{output_name}.pptx"
        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        source_bytes, err = _load_or_error(ppt_manager, source_filename)
        if err:
            return err

        position = insert_position if insert_position >= 0 else source_index + 1

        with PptxEngine(source_bytes) as engine:
            new_slide = engine.duplicate_slide(source_index, position)
            order = engine.get_slide_order()
            new_index = next(i for i, s in enumerate(order) if s["filename"] == new_slide)
            output_bytes = engine.pack()

        success_msg = (
            f"**Duplicated slide**: {output_filename}\n\n"
            f"Slide {source_index + 1} → new slide at position {new_index + 1} (index {new_index})"
        )
        return _save_and_respond(
            ppt_manager, tool_context, output_filename, output_bytes,
            "duplicate_slide", user_id, session_id, success_msg,
            {"source_index": source_index, "new_index": new_index},
        )
    except Exception as e:
        logger.error(f"duplicate_slide error: {e}", exc_info=True)
        return {"content": [{"text": f"**Error:** {str(e)}"}], "status": "error"}


@tool(context=True)
def update_slide_notes(
    presentation_name: str,
    slide_index: int,
    notes_text: str,
    output_name: str,
    tool_context: ToolContext,
) -> Dict[str, Any]:
    """Update speaker notes for a specific slide.

    Args:
        presentation_name: Source presentation name WITHOUT extension
        slide_index: Slide index (0-based)
        notes_text: New notes content (use \\n for multi-line)
        output_name: Output name WITHOUT extension (must differ from source)
    """
    try:
        err = _validate_names(presentation_name, output_name)
        if err:
            return err

        source_filename = f"{presentation_name}.pptx"
        output_filename = f"{output_name}.pptx"
        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        source_bytes, err = _load_or_error(ppt_manager, source_filename)
        if err:
            return err

        with PptxEngine(source_bytes) as engine:
            order = engine.get_slide_order()
            if not (0 <= slide_index < len(order)):
                return {"content": [{"text": f"**Invalid slide_index {slide_index}**: presentation has {len(order)} slides"}], "status": "error"}
            engine.update_notes(order[slide_index]["filename"], notes_text)
            output_bytes = engine.pack()

        success_msg = f"**Updated notes**: {output_filename}\n\nSlide {slide_index + 1} notes updated."
        return _save_and_respond(
            ppt_manager, tool_context, output_filename, output_bytes,
            "update_slide_notes", user_id, session_id, success_msg,
            {"slide_index": slide_index},
        )
    except Exception as e:
        logger.error(f"update_slide_notes error: {e}", exc_info=True)
        return {"content": [{"text": f"**Error:** {str(e)}"}], "status": "error"}


@tool(context=True)
def create_presentation(
    presentation_name: str,
    slides: list | str | None,
    tool_context: ToolContext,
) -> Dict[str, Any]:
    """Create a new presentation from scratch using PptxGenJS (JavaScript).

    Each slide is defined by a `custom_code` JavaScript snippet.
    The PptxGenJS instance is available as `pres`. Create your slide with `pres.addSlide()`.

    Args:
        presentation_name: Output name without extension (e.g., "sales-deck")
        slides: List of slide definitions:
            [{"custom_code": "let slide = pres.addSlide(); slide.addText(...)"}]
            Or None to create a blank presentation.

    PptxGenJS quick reference:
        let slide = pres.addSlide();
        slide.background = { color: "1E2761" };
        slide.addText("Title", { x: 0.5, y: 0.3, w: 12, h: 1.2, fontSize: 44, color: "FFFFFF", bold: true, fontFace: "Georgia" });
        slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.15, h: 7.5, fill: { color: "CADCFC" } });
        slide.addImage({ path: "img.png", x: 7, y: 1, w: 5.5, h: 4.5 });
        slide.addChart(pres.charts.BAR, [{ name: "S", labels: ["Q1","Q2"], values: [100, 120] }], { x: 1, y: 2, w: 8, h: 4 });

    Call get_slide_design_reference() for color palettes, typography, and layout ideas.

    Notes:
        - NEVER use "#" with hex colors
        - NEVER reuse option objects across addShape calls (PptxGenJS mutates in-place)
        - Layout is LAYOUT_WIDE (13.3" × 7.5")
    """
    try:
        # Parse slides if it's a JSON string
        if isinstance(slides, str):
            try:
                slides = json.loads(slides)
            except json.JSONDecodeError:
                fixed = re.sub(r",(\s*[}\]])", r"\1", slides)
                fixed = re.sub(r"//.*?$", "", fixed, flags=re.MULTILINE)
                try:
                    slides = json.loads(fixed)
                except json.JSONDecodeError as e:
                    return {"content": [{"text": f"**Invalid JSON for slides**: {str(e)}"}], "status": "error"}

        is_valid, error_msg = _validate_presentation_name(presentation_name)
        if not is_valid:
            return {"content": [{"text": f"**Invalid name**: {presentation_name}\n\n{error_msg}"}], "status": "error"}

        output_filename = f"{presentation_name}.pptx"
        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        try:
            ppt_manager.load_from_s3(output_filename)
            return {"content": [{"text": f"**Already exists**: {output_filename}\n\nUse a different name or delete the existing file first."}], "status": "error"}
        except FileNotFoundError:
            pass

        code_interpreter_id = _get_code_interpreter_id()
        if not code_interpreter_id:
            return {"content": [{"text": "**Code Interpreter not configured**"}], "status": "error"}

        region = os.getenv("AWS_REGION", "us-west-2")
        ci = CodeInterpreter(region)
        ci.start(identifier=code_interpreter_id)

        try:
            # Upload workspace images so slide code can reference them by filename
            ppt_manager.load_workspace_images_to_ci(ci)

            effective_slides = slides or []
            output_bytes = run_pptxgenjs(effective_slides, output_filename, ci)
        finally:
            ci.stop()

        total_slides = len(effective_slides)
        success_msg = (
            f"**Created**: {output_filename}\n\n"
            f"{total_slides} slide(s), {len(output_bytes) // 1024} KB\n\n"
            f"Use `analyze_presentation` to inspect, `update_slide_content` to edit."
        )
        return _save_and_respond(
            ppt_manager, tool_context, output_filename, output_bytes,
            "create_presentation", user_id, session_id, success_msg,
            {"slide_count": total_slides},
        )
    except Exception as e:
        logger.error(f"create_presentation error: {e}", exc_info=True)
        return {"content": [{"text": f"**Error:** {str(e)}"}], "status": "error"}


@tool(context=True)
def preview_presentation_slides(
    presentation_name: str,
    slide_numbers: list[int],
    tool_context: ToolContext,
) -> Dict[str, Any]:
    """Get slide screenshots for visual inspection before editing.

    Images are sent to you (the agent), not displayed to the user.
    Use BEFORE modifying to understand exact layout and formatting.

    Args:
        presentation_name: Presentation name without extension
        slide_numbers: 1-indexed slide numbers to preview. Empty list [] = all slides.
    """
    import subprocess
    import tempfile
    import io
    from pdf2image import convert_from_path, pdfinfo_from_path

    user_id, session_id = _get_user_session_ids(tool_context)
    filename = f"{presentation_name}.pptx"
    logger.info(f"preview_presentation_slides: {filename}, slides {slide_numbers}")

    try:
        ppt_manager = PowerPointManager(user_id, session_id)
        pptx_bytes, err = _load_or_error(ppt_manager, filename)
        if err:
            return err

        with tempfile.TemporaryDirectory() as tmp:
            pptx_path = os.path.join(tmp, filename)
            with open(pptx_path, "wb") as f:
                f.write(pptx_bytes)

            result = subprocess.run(
                ["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmp, pptx_path],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode != 0:
                return {"content": [{"text": f"PDF conversion failed\n\n{result.stderr}"}], "status": "error"}

            pdf_path = os.path.join(tmp, filename.replace(".pptx", ".pdf"))
            if not os.path.exists(pdf_path):
                return {"content": [{"text": "PDF file not created — LibreOffice conversion may have failed silently."}], "status": "error"}

            pdf_info = pdfinfo_from_path(pdf_path)
            total_slides = pdf_info.get("Pages", 1)

            if not slide_numbers:
                target_slides = list(range(1, total_slides + 1))
            else:
                invalid = [s for s in slide_numbers if s < 1 or s > total_slides]
                if invalid:
                    return {"content": [{"text": f"Invalid slide number(s): {invalid}. Presentation has {total_slides} slides."}], "status": "error"}
                target_slides = slide_numbers

            content = [{"text": f"**{filename}** — {len(target_slides)} of {total_slides} slide(s)"}]

            for slide_num in target_slides:
                images = convert_from_path(pdf_path, first_page=slide_num, last_page=slide_num, dpi=150)
                if images:
                    img = images[0]
                    # Bedrock multi-image limit: 2000px per dimension. Cap at 1800px with margin.
                    max_dim = 1800
                    if img.width > max_dim or img.height > max_dim:
                        ratio = min(max_dim / img.width, max_dim / img.height)
                        img = img.resize(
                            (int(img.width * ratio), int(img.height * ratio)),
                            resample=img.Resampling.LANCZOS if hasattr(img, "Resampling") else 1
                        )
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    content.append({"text": f"**Slide {slide_num}**"})
                    content.append({"image": {"format": "png", "source": {"bytes": buf.getvalue()}}})

            text_blocks = [b for b in content if "text" in b]
            image_blocks = [b for b in content if "image" in b]
            return build_image_response(text_blocks, image_blocks, {
                "filename": filename,
                "slide_numbers": target_slides,
                "total_slides": total_slides,
                "tool_type": "powerpoint_presentation",
                "user_id": user_id,
                "session_id": session_id,
            })
    except Exception as e:
        logger.error(f"preview_presentation_slides error: {e}", exc_info=True)
        return {"content": [{"text": f"**Error:** {str(e)}"}], "status": "error"}

register_skill("powerpoint-presentations", tools=[
    get_slide_design_reference, list_my_powerpoint_presentations, get_presentation_layouts,
    analyze_presentation, create_presentation, update_slide_content, add_slide,
    delete_slides, move_slide, duplicate_slide, update_slide_notes, preview_presentation_slides,
])
