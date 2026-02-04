"""
PowerPoint Presentation Tools - Modern high-level API for PowerPoint management.

Available Tools (11):
1. list_my_powerpoint_presentations - List workspace presentations
2. get_presentation_layouts - Get all available slide layouts
3. analyze_presentation - Analyze presentation structure
4. create_presentation - Create from outline or blank
5. update_slide_content - Edit slides with high-level operations
6. add_slide - Add new slides
7. delete_slides - Delete multiple slides
8. move_slide - Reorder slides
9. duplicate_slide - Copy slides
10. update_slide_notes - Update speaker notes
11. preview_presentation_slides - Get slide screenshots for visual inspection

Features:
- Safe high-level API (no python-pptx code needed)
- Feature-based element detection (catches animations, custom shapes, etc.)
- Markdown text formatting support
- Automatic index management
- Clear error messages
- Operation-based editing

Element Types (simplified):
- text: Any text-editable shape (textbox, placeholder, autoshape, animation text, etc.)
- picture: Image shapes
- table: Table shapes
- chart: Chart shapes
- group: Grouped shapes
- unknown: Other shapes

Note: Uploaded .pptx files are automatically stored to workspace by agent.py
Pattern follows word_document_tool for consistency.
"""

import os
import re
import logging
from typing import Dict, Any, Optional
from strands import tool, ToolContext
from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter
from workspace import PowerPointManager

logger = logging.getLogger(__name__)


def _validate_presentation_name(name: str) -> tuple[bool, Optional[str]]:
    """Validate presentation name meets requirements (without extension).

    Rules:
    - Only letters (a-z, A-Z), numbers (0-9), and hyphens (-)
    - No spaces, underscores, or special characters
    - No consecutive hyphens
    - No leading/trailing hyphens

    Args:
        name: Presentation name without extension (e.g., "sales-deck")

    Returns:
        (is_valid, error_message)
        - (True, None) if valid
        - (False, error_message) if invalid
    """
    # Check for empty name
    if not name:
        return False, "Presentation name cannot be empty"

    # Check for valid characters: only letters, numbers, hyphens
    if not re.match(r'^[a-zA-Z0-9\-]+$', name):
        invalid_chars = re.findall(r'[^a-zA-Z0-9\-]', name)
        return False, f"Invalid characters in name: {set(invalid_chars)}. Use only letters, numbers, and hyphens (-)."

    # Check for consecutive hyphens
    if '--' in name:
        return False, "Name cannot contain consecutive hyphens (--)"

    # Check for leading/trailing hyphens
    if name.startswith('-') or name.endswith('-'):
        return False, "Name cannot start or end with a hyphen"

    return True, None


def _sanitize_presentation_name_for_bedrock(filename: str) -> str:
    """Sanitize existing filename for Bedrock API (removes extension).

    Use this ONLY for existing files being read from S3.
    For new files, use _validate_presentation_name() instead.

    This must match the sanitization done during upload (agent.py _sanitize_filename)
    to ensure files can be found after being stored.

    Args:
        filename: Original filename with extension (e.g., "test_deck_v2.pptx")

    Returns:
        Sanitized name without extension (e.g., "test-deck-v2", "AWS-AI-Agents-FCD-251211")
    """
    # Remove extension
    if '.' in filename:
        name, ext = filename.rsplit('.', 1)
    else:
        name = filename

    # Replace underscores AND spaces with hyphens (matches agent.py _sanitize_filename)
    name = name.replace('_', '-').replace(' ', '-')

    # Keep only allowed characters: alphanumeric, hyphens, parentheses, square brackets
    # This matches agent.py's _sanitize_filename behavior
    name = re.sub(r'[^a-zA-Z0-9\-\(\)\[\]]', '', name)

    # Replace consecutive hyphens with single hyphen
    name = re.sub(r'\-+', '-', name)

    # Trim hyphens from start/end
    name = name.strip('-')

    # If name becomes empty, use default
    if not name:
        name = 'presentation'

    if name != filename.replace('.pptx', ''):
        logger.info(f"Sanitized presentation name for Bedrock: '{filename}' → '{name}'")

    return name


def _get_code_interpreter_id() -> Optional[str]:
    """Get Custom Code Interpreter ID from environment or Parameter Store"""
    # 1. Check environment variable (set by AgentCore Runtime)
    code_interpreter_id = os.getenv('CODE_INTERPRETER_ID')
    if code_interpreter_id:
        logger.info(f"Found CODE_INTERPRETER_ID in environment: {code_interpreter_id}")
        return code_interpreter_id

    # 2. Try Parameter Store (for local development or alternative configuration)
    try:
        import boto3
        project_name = os.getenv('PROJECT_NAME', 'strands-agent-chatbot')
        environment = os.getenv('ENVIRONMENT', 'dev')
        region = os.getenv('AWS_REGION', 'us-west-2')
        param_name = f"/{project_name}/{environment}/agentcore/code-interpreter-id"

        logger.info(f"Checking Parameter Store for Code Interpreter ID: {param_name}")
        ssm = boto3.client('ssm', region_name=region)
        response = ssm.get_parameter(Name=param_name)
        code_interpreter_id = response['Parameter']['Value']
        logger.info(f"Found CODE_INTERPRETER_ID in Parameter Store: {code_interpreter_id}")
        return code_interpreter_id
    except Exception as e:
        logger.warning(f"Custom Code Interpreter ID not found in Parameter Store: {e}")
        return None


def _get_user_session_ids(tool_context: ToolContext) -> tuple[str, str]:
    """Extract user_id and session_id from ToolContext

    Returns:
        (user_id, session_id) tuple
    """
    # Extract from invocation_state (set by agent)
    invocation_state = tool_context.invocation_state
    user_id = invocation_state.get('user_id', 'default_user')
    session_id = invocation_state.get('session_id', 'default_session')

    logger.info(f"Extracted IDs: user_id={user_id}, session_id={session_id}")
    return user_id, session_id


def _save_ppt_artifact(
    tool_context: ToolContext,
    filename: str,
    s3_url: str,
    size_kb: str,
    tool_name: str,
    user_id: str,
    session_id: str
) -> None:
    """Save PowerPoint presentation as artifact to agent.state for Canvas display.

    Args:
        tool_context: Strands ToolContext
        filename: Presentation filename (e.g., "sales-deck.pptx")
        s3_url: Full S3 URL (e.g., "s3://bucket/path/sales-deck.pptx")
        size_kb: File size string (e.g., "1.2 MB")
        tool_name: Tool that created this
        user_id: User ID
        session_id: Session ID
    """
    from datetime import datetime, timezone

    try:
        # Generate artifact ID using filename (without extension)
        ppt_name = filename.replace('.pptx', '')
        artifact_id = f"ppt-{ppt_name}"

        # Get current artifacts from agent.state
        artifacts = tool_context.agent.state.get("artifacts") or {}

        # Create/update artifact
        artifacts[artifact_id] = {
            "id": artifact_id,
            "type": "powerpoint_presentation",
            "title": filename,
            "content": s3_url,  # Full S3 URL for OfficeViewer
            "tool_name": tool_name,
            "metadata": {
                "filename": filename,
                "s3_url": s3_url,
                "size_kb": size_kb,
                "user_id": user_id,
                "session_id": session_id
            },
            "created_at": artifacts.get(artifact_id, {}).get("created_at", datetime.now(timezone.utc).isoformat()),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }

        # Save to agent.state
        tool_context.agent.state.set("artifacts", artifacts)

        # Sync agent state to persistence
        session_manager = tool_context.invocation_state.get("session_manager")
        if not session_manager and hasattr(tool_context.agent, 'session_manager'):
            session_manager = tool_context.agent.session_manager

        if session_manager:
            session_manager.sync_agent(tool_context.agent)
            logger.info(f"Saved PPT artifact: {artifact_id}")
        else:
            logger.warning(f"No session_manager found, PPT artifact not persisted: {artifact_id}")

    except Exception as e:
        logger.error(f"Failed to save PPT artifact: {e}")


def _get_file_compatibility_error_response(filename: str, error_msg: str, operation: str) -> Dict[str, Any]:
    """Generate file compatibility error response

    Args:
        filename: The problematic file name
        error_msg: The error message from Code Interpreter
        operation: The operation being attempted (e.g., "analyze", "update", "add slide to")

    Returns:
        Error response dict with user instructions
    """
    return {
        "content": [{
            "text": f"❌ **Cannot {operation} presentation: File compatibility issue**\n\n"
                   f"**The file `{filename}` is not compatible with the editing tools.**\n\n"
                   f"**Please ask the user to choose one of these options:**\n\n"
                   f"**Option 1: Preserve design (Recommended for editing)**\n"
                   f"1. Open the file in Microsoft PowerPoint\n"
                   f"2. Save as → PowerPoint Presentation (.pptx)\n"
                   f"3. Upload the re-saved file\n\n"
                   f"**Option 2: Create new presentation from content**\n"
                   f"1. Open the file in Microsoft PowerPoint\n"
                   f"2. Save as → PDF\n"
                   f"3. Upload the PDF file\n"
                   f"4. I will analyze the PDF and create a new presentation\n\n"
                   f"**DO NOT try other methods.** This is a file format issue that requires user action.\n\n"
                   f"<details>\n"
                   f"<summary>Technical error details</summary>\n\n"
                   f"```\n{error_msg[:500]}\n```\n"
                   f"</details>"
        }],
        "status": "error"
    }




def _upload_ppt_helpers_to_ci(code_interpreter: CodeInterpreter) -> None:
    """Upload ppt_helpers.py module to Code Interpreter workspace

    Uploads the module twice with different names:
    - presentation_editor.py: Used by update_slide_content (PresentationEditor class)
    - ppt_helpers.py: Used by create_presentation (generate_ppt_structure function)

    Args:
        code_interpreter: Active CodeInterpreter instance
    """
    try:
        # Read ppt_helpers.py content
        helpers_path = os.path.join(os.path.dirname(__file__), 'lib', 'ppt_helpers.py')

        if os.path.exists(helpers_path):
            with open(helpers_path, 'rb') as f:
                helpers_bytes = f.read()

            # Base64 encode to safely transfer through Code Interpreter
            import base64
            encoded_content = base64.b64encode(helpers_bytes).decode('utf-8')

            # Upload as both filenames (different imports need different names)
            upload_code = f'''
import base64

# Decode the module content
module_content = base64.b64decode('{encoded_content}')

# Save as presentation_editor.py (for update_slide_content)
with open('presentation_editor.py', 'wb') as f:
    f.write(module_content)

# Save as ppt_helpers.py (for create_presentation)
with open('ppt_helpers.py', 'wb') as f:
    f.write(module_content)

print("✅ presentation_editor.py and ppt_helpers.py modules loaded successfully")
'''

            response = code_interpreter.invoke("executeCode", {
                "code": upload_code,
                "language": "python",
                "clearContext": False
            })

            # Check for errors
            for event in response.get("stream", []):
                result = event.get("result", {})
                if result.get("isError", False):
                    error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                    logger.error(f"Failed to upload ppt_helpers: {error_msg[:200]}")
                    return

            logger.debug(" Uploaded presentation_editor.py and ppt_helpers.py to Code Interpreter")
        else:
            logger.warning(f"ppt_helpers.py not found at {helpers_path}")

    except Exception as e:
        logger.error(f"Failed to upload ppt_helpers: {e}")


@tool(context=True)
def list_my_powerpoint_presentations(tool_context: ToolContext) -> Dict[str, Any]:
    """List all PowerPoint presentations in workspace.

    Returns:
        Formatted list of presentations with metadata
    """
    try:
        logger.info("=== list_my_powerpoint_presentations called ===")

        # Get user and session IDs
        user_id, session_id = _get_user_session_ids(tool_context)

        # Initialize presentation manager
        ppt_manager = PowerPointManager(user_id, session_id)

        # List S3 documents
        documents = ppt_manager.list_s3_documents()

        # Format list
        workspace_list = ppt_manager.format_file_list(documents)

        return {
            "content": [{"text": workspace_list}],
            "status": "success",
            "metadata": {
                "count": len(documents),
                "presentations": [doc['filename'] for doc in documents]
            }
        }

    except Exception as e:
        logger.error(f"list_my_powerpoint_presentations error: {e}", exc_info=True)
        return {
            "content": [{
                "text": f"❌ **Error listing presentations:** {str(e)}"
            }],
            "status": "error"
        }


@tool(context=True)
def get_presentation_layouts(
    presentation_name: str,
    tool_context: ToolContext
) -> Dict[str, Any]:
    """Get all available slide layouts from presentation.

    Returns complete list of layout names that can be used with add_slide.
    Use this before adding slides to get exact layout names.

    Args:
        presentation_name: Presentation name WITHOUT extension (e.g., "sales-deck")

    Example:
        get_presentation_layouts("sales-deck")
    """
    try:
        logger.info("=== get_presentation_layouts called ===")
        logger.info(f"Presentation: {presentation_name}")

        # Sanitize name for Bedrock API
        sanitized_name = _sanitize_presentation_name_for_bedrock(presentation_name)
        presentation_filename = f"{sanitized_name}.pptx"

        # Get user and session IDs
        user_id, session_id = _get_user_session_ids(tool_context)

        # Initialize presentation manager
        ppt_manager = PowerPointManager(user_id, session_id)

        # Load from S3
        try:
            pptx_bytes = ppt_manager.load_from_s3(presentation_filename)
        except FileNotFoundError:
            documents = ppt_manager.list_s3_documents()
            available = [doc['filename'] for doc in documents if doc['filename'].endswith('.pptx')]
            return {
                "content": [{
                    "text": f"❌ **Presentation not found**: {presentation_filename}\n\n**Available presentations:**\n" + "\n".join([f"- {f}" for f in available]) if available else "No presentations found in workspace."
                }],
                "status": "error"
            }

        # Get Code Interpreter
        code_interpreter_id = _get_code_interpreter_id()
        if not code_interpreter_id:
            return {
                "content": [{
                    "text": "❌ **Code Interpreter not configured**\n\nCODE_INTERPRETER_ID not found in environment or Parameter Store."
                }],
                "status": "error"
            }

        region = os.getenv('AWS_REGION', 'us-west-2')
        code_interpreter = CodeInterpreter(region)
        code_interpreter.start(identifier=code_interpreter_id)

        try:
            # Upload presentation
            ppt_manager.upload_to_code_interpreter(code_interpreter, presentation_filename, pptx_bytes)

            # Generate code to list layouts
            list_layouts_code = f"""
from pptx import Presentation
import json

try:
    prs = Presentation('{presentation_filename}')

    layouts = []
    for idx, layout in enumerate(prs.slide_layouts):
        layouts.append({{
            'index': idx,
            'name': layout.name,
            'placeholder_count': len(layout.placeholders)
        }})

    result = {{
        'total_layouts': len(layouts),
        'layouts': layouts
    }}

    print(json.dumps(result, indent=2, ensure_ascii=False))

except Exception as e:
    raise ValueError(f"Failed to list layouts: {{str(e)}}")
""".strip()

            # Execute
            response = code_interpreter.invoke("executeCode", {
                "code": list_layouts_code,
                "language": "python",
                "clearContext": False
            })

            # Collect JSON output
            json_output = ""
            for event in response.get("stream", []):
                result = event.get("result", {})
                if result.get("isError", False):
                    error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                    logger.error(f"List layouts failed: {error_msg[:500]}")
                    code_interpreter.stop()
                    return {
                        "content": [{
                            "text": f"❌ **Failed to list layouts**\n\n```\n{error_msg[:1000]}\n```"
                        }],
                        "status": "error"
                    }

                stdout = result.get("structuredContent", {}).get("stdout", "")
                if stdout:
                    json_output += stdout

            # Parse JSON result
            import json
            layout_data = json.loads(json_output)

            # Format output
            output_text = f"""📐 **Available Layouts**: {presentation_filename}

**Total layouts:** {layout_data['total_layouts']}

**Layout names (use exact names with add_slide):**
"""
            for layout in layout_data['layouts']:
                output_text += f"- \"{layout['name']}\"\n"

            code_interpreter.stop()
            return {
                "content": [{"text": output_text}],
                "status": "success",
                "metadata": {
                    "filename": presentation_filename,
                    "layouts": layout_data['layouts'],
                    "tool_type": "powerpoint_presentation",
                    "user_id": user_id,
                    "session_id": session_id
                }
            }

        finally:
            code_interpreter.stop()

    except Exception as e:
        logger.error(f"get_presentation_layouts error: {e}", exc_info=True)
        return {
            "content": [{
                "text": f"❌ **Error getting layouts:** {str(e)}"
            }],
            "status": "error"
        }


@tool(context=True)
def analyze_presentation(
    presentation_name: str,
    tool_context: ToolContext,
    slide_index: int | None = None,
    include_notes: bool = False
) -> Dict[str, Any]:
    """Analyze presentation structure with element IDs and positions for editing.

    Returns layouts, slides, element IDs, text content, and spatial positions.
    Hidden slides are automatically excluded from analysis.

    Element Types:
    - text: Any text-editable shape (includes textbox, placeholder, autoshape, animation text, etc.)
    - picture: Image shapes
    - table: Table shapes (with cell data)
    - chart: Chart shapes (with data)
    - group: Grouped shapes
    - unknown: Other non-editable shapes

    Role Tags (for text elements):
    - [TITLE]: Title placeholder
    - [BODY]: Body/content placeholder
    - [FOOTER]: Footer placeholder
    - (no tag): Regular text element

    Args:
        presentation_name: Presentation name WITHOUT extension (e.g., "sales-deck")
        slide_index: Optional slide index (0-based). If provided, analyzes only that slide.
                     If None, analyzes entire presentation.
        include_notes: Whether to include speaker notes in output (default: False)

    Example:
        analyze_presentation("sales-deck")  # Analyze all visible slides
        analyze_presentation("sales-deck", slide_index=5)  # Analyze only slide 6
        analyze_presentation("sales-deck", include_notes=True)  # Include speaker notes

    Note: Element positions shown as (left", top") in inches.
    """
    try:
        logger.info("=== analyze_presentation called ===")
        logger.info(f"Presentation: {presentation_name}")

        # Sanitize name for Bedrock API
        sanitized_name = _sanitize_presentation_name_for_bedrock(presentation_name)
        presentation_filename = f"{sanitized_name}.pptx"

        # Get user and session IDs
        user_id, session_id = _get_user_session_ids(tool_context)

        # Initialize presentation manager
        ppt_manager = PowerPointManager(user_id, session_id)

        # Load from S3
        try:
            pptx_bytes = ppt_manager.load_from_s3(presentation_filename)
        except FileNotFoundError:
            documents = ppt_manager.list_s3_documents()
            available = [doc['filename'] for doc in documents if doc['filename'].endswith('.pptx')]
            return {
                "content": [{
                    "text": f"❌ **Presentation not found**: {presentation_filename}\n\n**Available presentations:**\n" + "\n".join([f"- {f}" for f in available]) if available else "No presentations found in workspace."
                }],
                "status": "error"
            }

        # Get Code Interpreter
        code_interpreter_id = _get_code_interpreter_id()
        if not code_interpreter_id:
            return {
                "content": [{
                    "text": "❌ **Code Interpreter not configured**\n\nCODE_INTERPRETER_ID not found in environment or Parameter Store."
                }],
                "status": "error"
            }

        region = os.getenv('AWS_REGION', 'us-west-2')
        code_interpreter = CodeInterpreter(region)
        code_interpreter.start(identifier=code_interpreter_id)

        try:
            # Upload presentation
            ppt_manager.upload_to_code_interpreter(code_interpreter, presentation_filename, pptx_bytes)

            # Upload ppt_helpers (contains presentation_editor)
            _upload_ppt_helpers_to_ci(code_interpreter)

            # Generate analysis code
            from .lib.ppt_operations import generate_analyze_presentation_code
            analysis_code = generate_analyze_presentation_code(presentation_filename, slide_index)

            # Execute analysis
            response = code_interpreter.invoke("executeCode", {
                "code": analysis_code,
                "language": "python",
                "clearContext": False
            })

            # Collect JSON output
            json_output = ""
            for event in response.get("stream", []):
                result = event.get("result", {})
                if result.get("isError", False):
                    error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                    logger.error(f"Analysis failed: {error_msg[:500]}")
                    code_interpreter.stop()

                    # Check if it's a file compatibility issue
                    if "AttributeError" in error_msg or "Cannot access" in error_msg:
                        return _get_file_compatibility_error_response(presentation_filename, error_msg, "analyze")

                    # Other errors
                    return {
                        "content": [{
                            "text": f"❌ **Analysis failed**\n\n```\n{error_msg[:1000]}\n```"
                        }],
                        "status": "error"
                    }

                stdout = result.get("structuredContent", {}).get("stdout", "")
                if stdout:
                    json_output += stdout

            # Parse JSON result
            import json
            analysis = json.loads(json_output)

            # Format output text with detailed structure
            if slide_index is not None:
                # Single slide analysis
                output_text = f"""📊 **Slide Analysis**: {presentation_filename} - Slide {slide_index + 1}

"""
            else:
                # Full presentation analysis
                output_text = f"""📊 **Presentation Analysis**: {presentation_filename}

**Total slides:** {analysis['total_slides']}

**Slides:**
"""

            def format_ranges(indices):
                """Convert list of indices to range string: [0,1,2,5,6,10] -> '0-2, 5-6, 10'"""
                if not indices:
                    return ""

                indices = sorted(set(indices))
                ranges = []
                start = indices[0]
                end = indices[0]

                for i in range(1, len(indices)):
                    if indices[i] == end + 1:
                        end = indices[i]
                    else:
                        if start == end:
                            ranges.append(str(start))
                        else:
                            ranges.append(f"{start}-{end}")
                        start = indices[i]
                        end = indices[i]

                # Add last range
                if start == end:
                    ranges.append(str(start))
                else:
                    ranges.append(f"{start}-{end}")

                return ", ".join(ranges)

            for slide in analysis['slides']:
                # Slide header
                if slide_index is None:
                    output_text += f"\n**Slide {slide['index'] + 1}**\n"

                # Layout
                output_text += f"- **Layout:** {slide['layout']}\n"

                # Title
                if slide.get('title'):
                    output_text += f"- **Title:** {slide['title']}\n"

                # Show speaker notes if available and requested (full content)
                if include_notes and slide.get('notes'):
                    output_text += f"- **Notes:** \"{slide['notes']}\"\n"

                if 'elements' in slide:
                    editable_elements = []
                    excluded_indices = []

                    for elem in slide['elements']:
                        elem_type = elem['type']

                        # Exclude: non-editable types (picture, group, unknown)
                        if elem_type in ['picture', 'group', 'unknown']:
                            excluded_indices.append(elem['element_id'])
                            continue

                        # For text type: check if has paragraphs (even if empty)
                        if elem_type == 'text':
                            # Include if has paragraphs key (even if empty or all blank)
                            # Animation text objects often start empty but are still editable
                            if 'paragraphs' not in elem:
                                excluded_indices.append(elem['element_id'])
                                continue

                        # Keep: text (with text_frame), table, chart
                        editable_elements.append(elem)

                    # Display editable elements only (1 line per element)
                    if editable_elements:
                        output_text += "- **Elements:**\n"

                    for elem in editable_elements:
                        role_text = f" [{elem['role'].upper()}]" if elem.get('role') else ""
                        output_text += f"  - Element {elem['element_id']} ({elem['type']}{role_text})"

                        # Position (left, top only)
                        if 'position' in elem:
                            pos = elem['position']
                            output_text += f" @ ({pos['left']}\", {pos['top']}\")"

                        # Text element: show all paragraphs with format
                        if 'paragraphs' in elem:
                            if elem['paragraphs']:
                                # Collect all paragraph texts
                                all_texts = []
                                for para in elem['paragraphs']:
                                    para_text = para['text'].strip()
                                    if para_text:
                                        all_texts.append(para_text)

                                if all_texts:
                                    # Join with separator - show full text
                                    full_text = " | ".join(all_texts)
                                    output_text += f": \"{full_text}\""
                                else:
                                    output_text += ": (empty)"

                                # Format info from first paragraph (representative)
                                first_para = elem['paragraphs'][0]
                                if 'format' in first_para:
                                    fmt = first_para['format']
                                    format_parts = []
                                    if 'font_name' in fmt:
                                        format_parts.append(fmt['font_name'])
                                    if 'font_size' in fmt:
                                        format_parts.append(f"{fmt['font_size']}pt")
                                    if fmt.get('bold'):
                                        format_parts.append("Bold")
                                    if fmt.get('italic'):
                                        format_parts.append("Italic")
                                    if 'color' in fmt:
                                        format_parts.append(fmt['color'])

                                    if format_parts:
                                        output_text += f" [{', '.join(format_parts)}]"
                            else:
                                output_text += ": (empty)"

                        # Table: show size and first row
                        elif 'table_data' in elem:
                            output_text += f" [{elem['rows']}×{elem['cols']}]"
                            if elem['table_data']:
                                first_row = elem['table_data'][0]
                                row_preview = " | ".join([cell[:20] for cell in first_row[:3]])
                                if len(first_row) > 3:
                                    row_preview += "..."
                                output_text += f": \"{row_preview}\""

                        # Chart: show type and categories
                        elif 'chart_data' in elem:
                            chart = elem['chart_data']
                            chart_type = chart.get('chart_type', 'Unknown')
                            output_text += f" [{chart_type}]"
                            if 'categories' in chart:
                                cats_preview = ', '.join([str(c) for c in chart['categories'][:4]])
                                if len(chart['categories']) > 4:
                                    cats_preview += "..."
                                output_text += f": \"{cats_preview}\""

                        output_text += "\n"

                    # Summary of excluded elements
                    if excluded_indices:
                        output_text += f"  (Non-editable: {format_ranges(excluded_indices)})\n"

            code_interpreter.stop()
            return {
                "content": [{"text": output_text}],
                "status": "success",
                "metadata": {
                    "filename": presentation_filename,
                    "slide_index": slide_index,
                    "analysis": analysis,
                    "tool_type": "powerpoint_presentation",
                    "user_id": user_id,
                    "session_id": session_id
                }
            }

        finally:
            code_interpreter.stop()

    except Exception as e:
        logger.error(f"analyze_presentation error: {e}", exc_info=True)
        return {
            "content": [{
                "text": f"❌ **Error analyzing presentation:** {str(e)}"
            }],
            "status": "error"
        }


@tool(context=True)
def update_slide_content(
    presentation_name: str,
    slide_updates: list,
    output_name: str,
    tool_context: ToolContext
) -> Dict[str, Any]:
    """Update one or more slides with operations in a single call.

    Args:
        presentation_name: Source presentation name WITHOUT extension
        slide_updates: List of slide update dicts with structure:
            [
                {
                    "slide_index": int (0-based),
                    "operations": [
                        {"action": "set_text", "element_id": int, "text": str},
                        {"action": "replace_text", "element_id": int, "find": str, "replace": str},
                        {"action": "replace_image", "element_id": int, "image_path": str}
                    ]
                }
            ]
        output_name: Output presentation name WITHOUT extension (must differ from source)

    Supported Actions:
        - set_text: Replace entire element text (works on type: text)
        - replace_text: Find and replace within element (works on type: text)
        - replace_image: Replace element image (works on type: picture)

    Element IDs:
        - Get element_id from analyze_presentation output
        - Element IDs are 0-based indices within each slide
        - text type: Use set_text or replace_text
        - picture type: Use replace_image

    Example (single slide):
        update_slide_content("sales-deck",
            slide_updates=[{
                "slide_index": 5,
                "operations": [
                    {"action": "set_text", "element_id": 0, "text": "Q4 Results"},
                    {"action": "replace_text", "element_id": 1, "find": "2024", "replace": "2025"}
                ]
            }],
            output_name="sales-deck-v2")

    Example (multiple slides):
        update_slide_content("sales-deck",
            slide_updates=[
                {"slide_index": 2, "operations": [{"action": "set_text", "element_id": 0, "text": "New Title"}]},
                {"slide_index": 5, "operations": [
                    {"action": "replace_text", "element_id": 1, "find": "Quality assessment", "replace": "Quality evaluation"},
                    {"action": "replace_image", "element_id": 3, "image_path": "new-chart.png"}
                ]},
                {"slide_index": 8, "operations": [{"action": "set_text", "element_id": 1, "text": "Point 1\\nPoint 2\\nPoint 3"}]}
            ],
            output_name="sales-deck-v2")

    Notes:
        - Multi-line text (\\n) creates multiple paragraphs automatically
        - Formatting is preserved from original text
        - Use replace_text for long texts where you only need to change specific portions
        - Batch all modifications into ONE call to avoid data loss from parallel execution
    """
    try:
        logger.info("=== update_slide_content called ===")
        logger.info(f"Source: {presentation_name}, Updates: {len(slide_updates)} slide(s)")

        # Validate names
        is_valid_source, error_msg_source = _validate_presentation_name(presentation_name)
        if not is_valid_source:
            return {
                "content": [{
                    "text": f"❌ **Invalid source name**: {presentation_name}\n\n{error_msg_source}"
                }],
                "status": "error"
            }

        is_valid_output, error_msg_output = _validate_presentation_name(output_name)
        if not is_valid_output:
            return {
                "content": [{
                    "text": f"❌ **Invalid output name**: {output_name}\n\n{error_msg_output}"
                }],
                "status": "error"
            }

        if presentation_name == output_name:
            return {
                "content": [{
                    "text": f"❌ **Output name must be different from source name**\n\nSource: {presentation_name}\nOutput: {output_name}\n\nThis preserves the original file."
                }],
                "status": "error"
            }

        # Validate slide_updates
        if not slide_updates or not isinstance(slide_updates, list):
            return {
                "content": [{
                    "text": "❌ **Invalid slide_updates**: Must provide a non-empty list of slide update dicts"
                }],
                "status": "error"
            }

        # Validate each slide update
        for idx, update in enumerate(slide_updates):
            if not isinstance(update, dict):
                return {
                    "content": [{
                        "text": f"❌ **Invalid slide_updates[{idx}]**: Must be a dict with 'slide_index' and 'operations'"
                    }],
                    "status": "error"
                }

            if 'slide_index' not in update or 'operations' not in update:
                return {
                    "content": [{
                        "text": f"❌ **Invalid slide_updates[{idx}]**: Must have 'slide_index' and 'operations' keys"
                    }],
                    "status": "error"
                }

            if not isinstance(update['operations'], list) or not update['operations']:
                return {
                    "content": [{
                        "text": f"❌ **Invalid slide_updates[{idx}]['operations']**: Must be a non-empty list"
                    }],
                    "status": "error"
                }

        # Add extensions
        source_filename = f"{presentation_name}.pptx"
        output_filename = f"{output_name}.pptx"

        # Get user and session IDs
        user_id, session_id = _get_user_session_ids(tool_context)

        # Initialize presentation manager
        ppt_manager = PowerPointManager(user_id, session_id)

        # Load source from S3
        try:
            source_bytes = ppt_manager.load_from_s3(source_filename)
        except FileNotFoundError:
            documents = ppt_manager.list_s3_documents()
            available = [doc['filename'] for doc in documents if doc['filename'].endswith('.pptx')]
            return {
                "content": [{
                    "text": f"❌ **Source presentation not found**: {source_filename}\n\n**Available:**\n" + "\n".join([f"- {f}" for f in available])
                }],
                "status": "error"
            }

        # Get Code Interpreter
        code_interpreter_id = _get_code_interpreter_id()
        if not code_interpreter_id:
            return {
                "content": [{
                    "text": "❌ **Code Interpreter not configured**"
                }],
                "status": "error"
            }

        region = os.getenv('AWS_REGION', 'us-west-2')
        code_interpreter = CodeInterpreter(region)
        code_interpreter.start(identifier=code_interpreter_id)

        try:
            # Upload source
            ppt_manager.upload_to_code_interpreter(code_interpreter, source_filename, source_bytes)

            # Upload workspace images
            loaded_images = ppt_manager.load_workspace_images_to_ci(code_interpreter)

            # Upload ppt_helpers (contains PresentationEditor)
            _upload_ppt_helpers_to_ci(code_interpreter)

            # Generate safe code from slide updates
            from .lib.ppt_operations import generate_batch_update_slides_code
            safe_code = generate_batch_update_slides_code(
                source_filename,
                output_filename,
                slide_updates
            )

            logger.info(f"Generated code:\n{safe_code[:500]}...")

            # Execute
            response = code_interpreter.invoke("executeCode", {
                "code": safe_code,
                "language": "python",
                "clearContext": False
            })

            # Check for errors
            for event in response.get("stream", []):
                result = event.get("result", {})
                if result.get("isError", False):
                    error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                    logger.error(f"Update failed: {error_msg[:500]}")
                    code_interpreter.stop()

                    # Check if it's a file compatibility issue
                    if "AttributeError" in error_msg or "Cannot access" in error_msg:
                        return _get_file_compatibility_error_response(source_filename, error_msg, "update")

                    # Other errors
                    return {
                        "content": [{
                            "text": f"❌ **Slide update failed**\n\n**Error:**\n```\n{error_msg[:1000]}\n```"
                        }],
                        "status": "error"
                    }

            # Download result
            output_ci_path = ppt_manager.get_ci_path(output_filename)
            file_bytes = ppt_manager.download_from_code_interpreter(code_interpreter, output_ci_path)

            if not file_bytes:
                code_interpreter.stop()
                return {
                    "content": [{
                        "text": "❌ **Failed to retrieve updated presentation**"
                    }],
                    "status": "error"
                }

            # Save to S3
            s3_info = ppt_manager.save_to_s3(output_filename, file_bytes)

            # Save as artifact for Canvas display
            _save_ppt_artifact(
                tool_context=tool_context,
                filename=output_filename,
                s3_url=s3_info['s3_url'],
                size_kb=s3_info['size_kb'],
                tool_name='update_slide_content',
                user_id=user_id,
                session_id=session_id
            )

            # Get updated workspace list
            documents = ppt_manager.list_s3_documents()
            other_files_count = len([d for d in documents if d['filename'] != output_filename])

            # Calculate total operations
            total_operations = sum(len(update['operations']) for update in slide_updates)
            slide_numbers = [update['slide_index'] + 1 for update in slide_updates]

            # Success message
            if len(slide_updates) == 1:
                success_msg = f"""✅ **Slide updated successfully!**

**Original:** {source_filename} (preserved)
**Updated:** {output_filename}
**Slide:** {slide_numbers[0]}
**Operations:** {total_operations}
**Size:** {s3_info['size_kb']}
**Other files in workspace:** {other_files_count} presentation{'s' if other_files_count != 1 else ''}

**Next steps:**
- Use `update_slide_content` again for more edits
- Use `analyze_presentation` to verify changes
"""
            else:
                slides_str = ", ".join(str(n) for n in sorted(slide_numbers))
                success_msg = f"""✅ **Slides updated successfully!**

**Original:** {source_filename} (preserved)
**Updated:** {output_filename}
**Slides:** {slides_str}
**Total operations:** {total_operations}
**Size:** {s3_info['size_kb']}
**Other files in workspace:** {other_files_count} presentation{'s' if other_files_count != 1 else ''}

**Next steps:**
- Use `update_slide_content` again for more edits
- Use `analyze_presentation` to verify changes
"""

            code_interpreter.stop()
            return {
                "content": [{"text": success_msg}],
                "status": "success",
                "metadata": {
                    "source_filename": source_filename,
                    "filename": output_filename,
                    "slide_updates": slide_updates,
                    "total_operations": total_operations,
                    "size_kb": s3_info['size_kb'],
                    "s3_key": s3_info['s3_key'],
                    "tool_type": "powerpoint_presentation",
                    "user_id": user_id,
                    "session_id": session_id
                }
            }

        except Exception as e:
            code_interpreter.stop()
            logger.error(f"Slide update error: {e}", exc_info=True)
            return {
                "content": [{
                    "text": f"❌ **Slide update failed**\n\n**Error:** {str(e)}"
                }],
                "status": "error"
            }

    except Exception as e:
        logger.error(f"update_slide_content error: {e}", exc_info=True)
        return {
            "content": [{
                "text": f"❌ **Error:** {str(e)}"
            }],
            "status": "error"
        }


@tool(context=True)
def add_slide(
    presentation_name: str,
    layout_name: str,
    position: int,
    output_name: str,
    tool_context: ToolContext,
    custom_code: str | None = None
) -> Dict[str, Any]:
    """Add new slide with optional custom python-pptx code for maximum flexibility.

    Args:
        presentation_name: Source presentation name WITHOUT extension
        layout_name: Layout name. Use get_presentation_layouts() to get exact names.
        position: Position to insert (0-based, -1 to append)
        output_name: Output presentation name WITHOUT extension (must differ from source)
        custom_code: Optional Python code to customize the slide. Available variables:
            - slide: The newly created slide object
            - prs: Presentation object
            - Inches, Pt: pptx.util functions for measurements
            - RGBColor: pptx.dml.color.RGBColor for colors
            - MSO_SHAPE_TYPE: Shape type constants
            - CategoryChartData, XL_CHART_TYPE: For creating charts

    Example (simple - empty slide):
        add_slide("deck", "Title Slide", position=0, output_name="deck-v2")

    Example (title and bullet points):
        add_slide("deck", "Title and Content", position=2, output_name="deck-v2",
                  custom_code='''
                  # Set title
                  slide.shapes.title.text = "Q4 Results"

                  # Add bullet points
                  content = slide.placeholders[1]
                  tf = content.text_frame
                  tf.text = "Revenue: $1M"
                  p = tf.add_paragraph()
                  p.text = "Profit: $200K"
                  p = tf.add_paragraph()
                  p.text = "Growth: 25%"
                  ''')

    Example (image):
        add_slide("deck", "Blank", position=5, output_name="deck-v2",
                  custom_code='''
                  # Add image
                  slide.shapes.add_picture('chart.png', Inches(1), Inches(2), width=Inches(8))

                  # Add caption
                  textbox = slide.shapes.add_textbox(Inches(1), Inches(6), Inches(8), Inches(0.5))
                  textbox.text = "Revenue growth over 4 quarters"
                  ''')

    Example (chart):
        add_slide("deck", "Title Only", position=3, output_name="deck-v2",
                  custom_code='''
                  slide.shapes.title.text = "Revenue Growth"

                  # Create chart data
                  chart_data = CategoryChartData()
                  chart_data.categories = ['Q1', 'Q2', 'Q3', 'Q4']
                  chart_data.add_series('Revenue', (100, 120, 140, 160))

                  # Add chart
                  chart = slide.shapes.add_chart(
                      XL_CHART_TYPE.COLUMN_CLUSTERED,
                      Inches(2), Inches(2), Inches(6), Inches(4.5),
                      chart_data
                  )
                  ''')

    Example (complex layout with matplotlib):
        add_slide("deck", "Blank", position=10, output_name="deck-v2",
                  custom_code='''
                  import matplotlib.pyplot as plt

                  # Generate chart
                  plt.figure(figsize=(10, 6))
                  plt.bar(['Q1', 'Q2', 'Q3', 'Q4'], [100, 120, 140, 160])
                  plt.title('Quarterly Revenue')
                  plt.ylabel('Revenue ($K)')
                  plt.savefig('revenue_chart.png', dpi=150, bbox_inches='tight')
                  plt.close()

                  # Add to slide
                  slide.shapes.add_picture('revenue_chart.png', Inches(0.5), Inches(1), width=Inches(9))

                  # Add title
                  title_box = slide.shapes.add_textbox(Inches(1), Inches(0.3), Inches(8), Inches(0.6))
                  title_box.text = "2024 Revenue Performance"
                  title_box.text_frame.paragraphs[0].font.size = Pt(32)
                  title_box.text_frame.paragraphs[0].font.bold = True
                  ''')
    """
    try:
        logger.info("=== add_slide called ===")
        logger.info(f"Source: {presentation_name}, Layout: {layout_name}, Position: {position}")

        # Validate names
        is_valid_source, error_msg_source = _validate_presentation_name(presentation_name)
        if not is_valid_source:
            return {"content": [{"text": f"❌ **Invalid source name**: {presentation_name}\n\n{error_msg_source}"}], "status": "error"}

        is_valid_output, error_msg_output = _validate_presentation_name(output_name)
        if not is_valid_output:
            return {"content": [{"text": f"❌ **Invalid output name**: {output_name}\n\n{error_msg_output}"}], "status": "error"}

        if presentation_name == output_name:
            return {"content": [{"text": "❌ **Output name must be different from source name**"}], "status": "error"}

        source_filename = f"{presentation_name}.pptx"
        output_filename = f"{output_name}.pptx"

        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        try:
            source_bytes = ppt_manager.load_from_s3(source_filename)
        except FileNotFoundError:
            return {"content": [{"text": f"❌ **Source presentation not found**: {source_filename}"}], "status": "error"}

        code_interpreter_id = _get_code_interpreter_id()
        if not code_interpreter_id:
            return {"content": [{"text": "❌ **Code Interpreter not configured**"}], "status": "error"}

        region = os.getenv('AWS_REGION', 'us-west-2')
        code_interpreter = CodeInterpreter(region)
        code_interpreter.start(identifier=code_interpreter_id)

        try:
            ppt_manager.upload_to_code_interpreter(code_interpreter, source_filename, source_bytes)

            # Load workspace images if custom_code provided (might use images)
            if custom_code:
                ppt_manager.load_workspace_images_to_ci(code_interpreter)

            from .lib.ppt_operations import generate_add_slide_code
            safe_code = generate_add_slide_code(source_filename, output_filename, layout_name, position, custom_code)

            response = code_interpreter.invoke("executeCode", {"code": safe_code, "language": "python", "clearContext": False})

            for event in response.get("stream", []):
                result = event.get("result", {})
                if result.get("isError", False):
                    error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                    logger.error(f"Add slide failed: {error_msg[:500]}")
                    code_interpreter.stop()

                    # Check if it's a file compatibility issue
                    if "AttributeError" in error_msg or "Cannot access" in error_msg:
                        return _get_file_compatibility_error_response(source_filename, error_msg, "add slide to")

                    # Other errors
                    return {"content": [{"text": f"❌ **Failed to add slide**\n\n```\n{error_msg[:1000]}\n```"}], "status": "error"}

            output_ci_path = ppt_manager.get_ci_path(output_filename)
            file_bytes = ppt_manager.download_from_code_interpreter(code_interpreter, output_ci_path)

            if not file_bytes:
                code_interpreter.stop()
                return {"content": [{"text": "❌ **Failed to retrieve presentation**"}], "status": "error"}

            s3_info = ppt_manager.save_to_s3(output_filename, file_bytes)

            # Save as artifact for Canvas display
            _save_ppt_artifact(
                tool_context=tool_context,
                filename=output_filename,
                s3_url=s3_info['s3_url'],
                size_kb=s3_info['size_kb'],
                tool_name='add_slide',
                user_id=user_id,
                session_id=session_id
            )

            documents = ppt_manager.list_s3_documents()
            other_files_count = len([d for d in documents if d['filename'] != output_filename])

            success_msg = f"""✅ **Slide added successfully!**

**Original:** {source_filename} (preserved)
**Updated:** {output_filename}
**Layout:** {layout_name}
**Position:** {position if position >= 0 else 'end'}
**Size:** {s3_info['size_kb']}
**Other files in workspace:** {other_files_count} presentation{'s' if other_files_count != 1 else ''}"""

            code_interpreter.stop()
            return {
                "content": [{"text": success_msg}],
                "status": "success",
                "metadata": {
                    "filename": output_filename,
                    "layout_name": layout_name,
                    "position": position,
                    "size_kb": s3_info['size_kb'],
                    "s3_key": s3_info['s3_key'],
                    "tool_type": "powerpoint_presentation",
                    "user_id": user_id,
                    "session_id": session_id
                }
            }

        except Exception as e:
            code_interpreter.stop()
            raise e

    except Exception as e:
        logger.error(f"add_slide error: {e}", exc_info=True)
        return {"content": [{"text": f"❌ **Error:** {str(e)}"}], "status": "error"}


@tool(context=True)
def delete_slides(
    presentation_name: str,
    slide_indices: list,
    output_name: str,
    tool_context: ToolContext
) -> Dict[str, Any]:
    """Delete slides by indices.

    Args:
        presentation_name: Source presentation name WITHOUT extension
        slide_indices: List of slide indices to delete (0-based, e.g., [2, 5, 10])
        output_name: Output presentation name WITHOUT extension (must differ from source)

    Example:
        delete_slides("sales-deck", slide_indices=[5, 12], output_name="sales-deck-cleaned")
    """
    try:
        logger.info("=== delete_slides called ===")
        logger.info(f"Source: {presentation_name}, Indices: {slide_indices}")

        is_valid_source, error_msg_source = _validate_presentation_name(presentation_name)
        if not is_valid_source:
            return {"content": [{"text": f"❌ **Invalid source name**: {presentation_name}\n\n{error_msg_source}"}], "status": "error"}

        is_valid_output, error_msg_output = _validate_presentation_name(output_name)
        if not is_valid_output:
            return {"content": [{"text": f"❌ **Invalid output name**: {output_name}\n\n{error_msg_output}"}], "status": "error"}

        if presentation_name == output_name:
            return {"content": [{"text": "❌ **Output name must be different from source name**"}], "status": "error"}

        if not slide_indices or not isinstance(slide_indices, list):
            return {"content": [{"text": "❌ **Invalid slide_indices**: Must provide a non-empty list"}], "status": "error"}

        source_filename = f"{presentation_name}.pptx"
        output_filename = f"{output_name}.pptx"

        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        try:
            source_bytes = ppt_manager.load_from_s3(source_filename)
        except FileNotFoundError:
            return {"content": [{"text": f"❌ **Source presentation not found**: {source_filename}"}], "status": "error"}

        code_interpreter_id = _get_code_interpreter_id()
        if not code_interpreter_id:
            return {"content": [{"text": "❌ **Code Interpreter not configured**"}], "status": "error"}

        region = os.getenv('AWS_REGION', 'us-west-2')
        code_interpreter = CodeInterpreter(region)
        code_interpreter.start(identifier=code_interpreter_id)

        try:
            ppt_manager.upload_to_code_interpreter(code_interpreter, source_filename, source_bytes)

            from .lib.ppt_operations import generate_delete_slides_code
            safe_code = generate_delete_slides_code(source_filename, output_filename, slide_indices)

            response = code_interpreter.invoke("executeCode", {"code": safe_code, "language": "python", "clearContext": False})

            for event in response.get("stream", []):
                result = event.get("result", {})
                if result.get("isError", False):
                    error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                    logger.error(f"Delete slides failed: {error_msg[:500]}")
                    code_interpreter.stop()

                    # Check if it's a file compatibility issue
                    if "AttributeError" in error_msg or "Cannot access" in error_msg:
                        return _get_file_compatibility_error_response(source_filename, error_msg, "delete slides from")

                    # Other errors
                    return {"content": [{"text": f"❌ **Failed to delete slides**\n\n```\n{error_msg[:1000]}\n```"}], "status": "error"}

            output_ci_path = ppt_manager.get_ci_path(output_filename)
            file_bytes = ppt_manager.download_from_code_interpreter(code_interpreter, output_ci_path)

            if not file_bytes:
                code_interpreter.stop()
                return {"content": [{"text": "❌ **Failed to retrieve presentation**"}], "status": "error"}

            s3_info = ppt_manager.save_to_s3(output_filename, file_bytes)

            # Save as artifact for Canvas display
            _save_ppt_artifact(
                tool_context=tool_context,
                filename=output_filename,
                s3_url=s3_info['s3_url'],
                size_kb=s3_info['size_kb'],
                tool_name='delete_slides',
                user_id=user_id,
                session_id=session_id
            )

            documents = ppt_manager.list_s3_documents()
            other_files_count = len([d for d in documents if d['filename'] != output_filename])

            success_msg = f"""✅ **Slides deleted successfully!**

**Original:** {source_filename} (preserved)
**Updated:** {output_filename}
**Deleted slides:** {', '.join([str(i+1) for i in sorted(slide_indices)])}
**Count:** {len(slide_indices)} slide(s)
**Size:** {s3_info['size_kb']}
**Other files in workspace:** {other_files_count} presentation{'s' if other_files_count != 1 else ''}"""

            code_interpreter.stop()
            return {
                "content": [{"text": success_msg}],
                "status": "success",
                "metadata": {
                    "filename": output_filename,
                    "deleted_count": len(slide_indices),
                    "size_kb": s3_info['size_kb'],
                    "s3_key": s3_info['s3_key'],
                    "tool_type": "powerpoint_presentation",
                    "user_id": user_id,
                    "session_id": session_id
                }
            }

        except Exception as e:
            code_interpreter.stop()
            raise e

    except Exception as e:
        logger.error(f"delete_slides error: {e}", exc_info=True)
        return {"content": [{"text": f"❌ **Error:** {str(e)}"}], "status": "error"}


@tool(context=True)
def move_slide(
    presentation_name: str,
    from_index: int,
    to_index: int,
    output_name: str,
    tool_context: ToolContext
) -> Dict[str, Any]:
    """Move slide from one position to another.

    Args:
        presentation_name: Source presentation name WITHOUT extension
        from_index: Source position (0-based)
        to_index: Target position (0-based)
        output_name: Output presentation name WITHOUT extension (must differ from source)

    Example:
        move_slide("sales-deck", from_index=10, to_index=2, output_name="sales-deck-reordered")
    """
    try:
        logger.info("=== move_slide called ===")
        logger.info(f"Source: {presentation_name}, From: {from_index}, To: {to_index}")

        is_valid_source, error_msg_source = _validate_presentation_name(presentation_name)
        if not is_valid_source:
            return {"content": [{"text": f"❌ **Invalid source name**: {presentation_name}\n\n{error_msg_source}"}], "status": "error"}

        is_valid_output, error_msg_output = _validate_presentation_name(output_name)
        if not is_valid_output:
            return {"content": [{"text": f"❌ **Invalid output name**: {output_name}\n\n{error_msg_output}"}], "status": "error"}

        if presentation_name == output_name:
            return {"content": [{"text": "❌ **Output name must be different from source name**"}], "status": "error"}

        source_filename = f"{presentation_name}.pptx"
        output_filename = f"{output_name}.pptx"

        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        try:
            source_bytes = ppt_manager.load_from_s3(source_filename)
        except FileNotFoundError:
            return {"content": [{"text": f"❌ **Source presentation not found**: {source_filename}"}], "status": "error"}

        code_interpreter_id = _get_code_interpreter_id()
        if not code_interpreter_id:
            return {"content": [{"text": "❌ **Code Interpreter not configured**"}], "status": "error"}

        region = os.getenv('AWS_REGION', 'us-west-2')
        code_interpreter = CodeInterpreter(region)
        code_interpreter.start(identifier=code_interpreter_id)

        try:
            ppt_manager.upload_to_code_interpreter(code_interpreter, source_filename, source_bytes)

            from .lib.ppt_operations import generate_move_slide_code
            safe_code = generate_move_slide_code(source_filename, output_filename, from_index, to_index)

            response = code_interpreter.invoke("executeCode", {"code": safe_code, "language": "python", "clearContext": False})

            for event in response.get("stream", []):
                result = event.get("result", {})
                if result.get("isError", False):
                    error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                    logger.error(f"Move slide failed: {error_msg[:500]}")
                    code_interpreter.stop()

                    # Check if it's a file compatibility issue
                    if "AttributeError" in error_msg or "Cannot access" in error_msg:
                        return _get_file_compatibility_error_response(source_filename, error_msg, "move slide in")

                    # Other errors
                    return {"content": [{"text": f"❌ **Failed to move slide**\n\n```\n{error_msg[:1000]}\n```"}], "status": "error"}

            output_ci_path = ppt_manager.get_ci_path(output_filename)
            file_bytes = ppt_manager.download_from_code_interpreter(code_interpreter, output_ci_path)

            if not file_bytes:
                code_interpreter.stop()
                return {"content": [{"text": "❌ **Failed to retrieve presentation**"}], "status": "error"}

            s3_info = ppt_manager.save_to_s3(output_filename, file_bytes)

            # Save as artifact for Canvas display
            _save_ppt_artifact(
                tool_context=tool_context,
                filename=output_filename,
                s3_url=s3_info['s3_url'],
                size_kb=s3_info['size_kb'],
                tool_name='move_slide',
                user_id=user_id,
                session_id=session_id
            )

            documents = ppt_manager.list_s3_documents()
            other_files_count = len([d for d in documents if d['filename'] != output_filename])

            success_msg = f"""✅ **Slide moved successfully!**

**Original:** {source_filename} (preserved)
**Updated:** {output_filename}
**Moved:** Slide {from_index + 1} → Position {to_index + 1}
**Size:** {s3_info['size_kb']}
**Other files in workspace:** {other_files_count} presentation{'s' if other_files_count != 1 else ''}"""

            code_interpreter.stop()
            return {
                "content": [{"text": success_msg}],
                "status": "success",
                "metadata": {
                    "filename": output_filename,
                    "from_index": from_index,
                    "to_index": to_index,
                    "size_kb": s3_info['size_kb'],
                    "s3_key": s3_info['s3_key'],
                    "tool_type": "powerpoint_presentation",
                    "user_id": user_id,
                    "session_id": session_id
                }
            }

        except Exception as e:
            code_interpreter.stop()
            raise e

    except Exception as e:
        logger.error(f"move_slide error: {e}", exc_info=True)
        return {"content": [{"text": f"❌ **Error:** {str(e)}"}], "status": "error"}


@tool(context=True)
def duplicate_slide(
    presentation_name: str,
    slide_index: int,
    position: int,
    output_name: str,
    tool_context: ToolContext
) -> Dict[str, Any]:
    """Duplicate slide to specified position.

    Args:
        presentation_name: Source presentation name WITHOUT extension
        slide_index: Index of slide to duplicate (0-based)
        position: Position for duplicate (0-based, -1 for after original)
        output_name: Output presentation name WITHOUT extension (must differ from source)

    Example:
        duplicate_slide("sales-deck", slide_index=5, position=-1, output_name="sales-deck-v2")
    """
    try:
        logger.info("=== duplicate_slide called ===")
        logger.info(f"Source: {presentation_name}, Slide: {slide_index}, Position: {position}")

        is_valid_source, error_msg_source = _validate_presentation_name(presentation_name)
        if not is_valid_source:
            return {"content": [{"text": f"❌ **Invalid source name**: {presentation_name}\n\n{error_msg_source}"}], "status": "error"}

        is_valid_output, error_msg_output = _validate_presentation_name(output_name)
        if not is_valid_output:
            return {"content": [{"text": f"❌ **Invalid output name**: {output_name}\n\n{error_msg_output}"}], "status": "error"}

        if presentation_name == output_name:
            return {"content": [{"text": "❌ **Output name must be different from source name**"}], "status": "error"}

        source_filename = f"{presentation_name}.pptx"
        output_filename = f"{output_name}.pptx"

        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        try:
            source_bytes = ppt_manager.load_from_s3(source_filename)
        except FileNotFoundError:
            return {"content": [{"text": f"❌ **Source presentation not found**: {source_filename}"}], "status": "error"}

        code_interpreter_id = _get_code_interpreter_id()
        if not code_interpreter_id:
            return {"content": [{"text": "❌ **Code Interpreter not configured**"}], "status": "error"}

        region = os.getenv('AWS_REGION', 'us-west-2')
        code_interpreter = CodeInterpreter(region)
        code_interpreter.start(identifier=code_interpreter_id)

        try:
            ppt_manager.upload_to_code_interpreter(code_interpreter, source_filename, source_bytes)

            from .lib.ppt_operations import generate_duplicate_slide_code
            safe_code = generate_duplicate_slide_code(source_filename, output_filename, slide_index, position)

            response = code_interpreter.invoke("executeCode", {"code": safe_code, "language": "python", "clearContext": False})

            for event in response.get("stream", []):
                result = event.get("result", {})
                if result.get("isError", False):
                    error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                    logger.error(f"Duplicate slide failed: {error_msg[:500]}")
                    code_interpreter.stop()

                    # Check if it's a file compatibility issue
                    if "AttributeError" in error_msg or "Cannot access" in error_msg:
                        return _get_file_compatibility_error_response(source_filename, error_msg, "duplicate slide in")

                    # Other errors
                    return {"content": [{"text": f"❌ **Failed to duplicate slide**\n\n```\n{error_msg[:1000]}\n```"}], "status": "error"}

            output_ci_path = ppt_manager.get_ci_path(output_filename)
            file_bytes = ppt_manager.download_from_code_interpreter(code_interpreter, output_ci_path)

            if not file_bytes:
                code_interpreter.stop()
                return {"content": [{"text": "❌ **Failed to retrieve presentation**"}], "status": "error"}

            s3_info = ppt_manager.save_to_s3(output_filename, file_bytes)

            # Save as artifact for Canvas display
            _save_ppt_artifact(
                tool_context=tool_context,
                filename=output_filename,
                s3_url=s3_info['s3_url'],
                size_kb=s3_info['size_kb'],
                tool_name='duplicate_slide',
                user_id=user_id,
                session_id=session_id
            )

            documents = ppt_manager.list_s3_documents()
            other_files_count = len([d for d in documents if d['filename'] != output_filename])

            success_msg = f"""✅ **Slide duplicated successfully!**

**Original:** {source_filename} (preserved)
**Updated:** {output_filename}
**Duplicated:** Slide {slide_index + 1}
**New position:** {position if position >= 0 else f'{slide_index + 2} (after original)'}
**Size:** {s3_info['size_kb']}
**Other files in workspace:** {other_files_count} presentation{'s' if other_files_count != 1 else ''}"""

            code_interpreter.stop()
            return {
                "content": [{"text": success_msg}],
                "status": "success",
                "metadata": {
                    "filename": output_filename,
                    "slide_index": slide_index,
                    "position": position,
                    "size_kb": s3_info['size_kb'],
                    "s3_key": s3_info['s3_key'],
                    "tool_type": "powerpoint_presentation",
                    "user_id": user_id,
                    "session_id": session_id
                }
            }

        except Exception as e:
            code_interpreter.stop()
            raise e

    except Exception as e:
        logger.error(f"duplicate_slide error: {e}", exc_info=True)
        return {
            "content": [{
                "text": f"❌ **Error duplicating slide:** {str(e)}"
            }],
            "status": "error"
        }


@tool(context=True)
def update_slide_notes(
    presentation_name: str,
    slide_index: int,
    notes_text: str,
    output_name: str,
    tool_context: ToolContext
) -> Dict[str, Any]:
    """Update speaker notes for a specific slide.

    Replaces entire notes content for the specified slide.
    Use when user wants to review or modify presentation notes.

    Args:
        presentation_name: Source presentation name WITHOUT extension
        slide_index: Slide index (0-based)
        notes_text: New notes content (use \n for multi-line)
        output_name: Output presentation name WITHOUT extension (must differ from source)

    Example:
        update_slide_notes("sales-deck", slide_index=5,
                          notes_text="Remember to emphasize ROI\\nMention competitor comparison",
                          output_name="sales-deck-v2")
    """
    try:
        logger.info("=== update_slide_notes called ===")
        logger.info(f"Source: {presentation_name}, Slide: {slide_index}")

        is_valid_source, error_msg_source = _validate_presentation_name(presentation_name)
        if not is_valid_source:
            return {"content": [{"text": f"❌ **Invalid source name**: {presentation_name}\n\n{error_msg_source}"}], "status": "error"}

        is_valid_output, error_msg_output = _validate_presentation_name(output_name)
        if not is_valid_output:
            return {"content": [{"text": f"❌ **Invalid output name**: {output_name}\n\n{error_msg_output}"}], "status": "error"}

        if presentation_name == output_name:
            return {"content": [{"text": "❌ **Output name must be different from source name**"}], "status": "error"}

        source_filename = f"{presentation_name}.pptx"
        output_filename = f"{output_name}.pptx"

        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        try:
            source_bytes = ppt_manager.load_from_s3(source_filename)
        except FileNotFoundError:
            return {"content": [{"text": f"❌ **Source presentation not found**: {source_filename}"}], "status": "error"}

        code_interpreter_id = _get_code_interpreter_id()
        if not code_interpreter_id:
            return {"content": [{"text": "❌ **Code Interpreter not configured**"}], "status": "error"}

        region = os.getenv('AWS_REGION', 'us-west-2')
        code_interpreter = CodeInterpreter(region)
        code_interpreter.start(code_interpreter_id)

        try:
            ci_path = ppt_manager.upload_to_code_interpreter(code_interpreter, source_filename, source_bytes)

            from .lib.ppt_operations import generate_update_notes_code
            safe_code = generate_update_notes_code(source_filename, output_filename, slide_index, notes_text)

            response = code_interpreter.invoke("executeCode", {"code": safe_code, "language": "python", "clearContext": False})

            for event in response.get("stream", []):
                result = event.get("result", {})
                if result.get("isError", False):
                    error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                    logger.error(f"Update notes failed: {error_msg[:500]}")
                    code_interpreter.stop()

                    if "AttributeError" in error_msg or "Cannot access" in error_msg:
                        return _get_file_compatibility_error_response(source_filename, error_msg, "update notes in")

                    return {"content": [{"text": f"❌ **Failed to update notes**\n\n```\n{error_msg[:1000]}\n```"}], "status": "error"}

            output_ci_path = ppt_manager.get_ci_path(output_filename)
            file_bytes = ppt_manager.download_from_code_interpreter(code_interpreter, output_ci_path)

            if not file_bytes:
                code_interpreter.stop()
                return {"content": [{"text": "❌ **Failed to retrieve presentation**"}], "status": "error"}

            s3_info = ppt_manager.save_to_s3(output_filename, file_bytes)

            # Save as artifact for Canvas display
            _save_ppt_artifact(
                tool_context=tool_context,
                filename=output_filename,
                s3_url=s3_info['s3_url'],
                size_kb=s3_info['size_kb'],
                tool_name='update_slide_notes',
                user_id=user_id,
                session_id=session_id
            )

            documents = ppt_manager.list_s3_documents()
            other_files_count = len([d for d in documents if d['filename'] != output_filename])

            notes_preview = notes_text[:100] + "..." if len(notes_text) > 100 else notes_text
            success_msg = f"""✅ **Slide notes updated successfully!**

**Original:** {source_filename} (preserved)
**Updated:** {output_filename}
**Slide:** {slide_index + 1}
**Notes:** "{notes_preview}"
**Size:** {s3_info['size_kb']}
**Other files in workspace:** {other_files_count} presentation{'s' if other_files_count != 1 else ''}"""

            code_interpreter.stop()
            return {
                "content": [{"text": success_msg}],
                "status": "success",
                "metadata": {
                    "filename": output_filename,
                    "slide_index": slide_index,
                    "size_kb": s3_info['size_kb'],
                    "s3_key": s3_info['s3_key'],
                    "tool_type": "powerpoint_presentation",
                    "user_id": user_id,
                    "session_id": session_id
                }
            }

        except Exception as e:
            code_interpreter.stop()
            raise e

    except Exception as e:
        logger.error(f"update_slide_notes error: {e}", exc_info=True)
        return {
            "content": [{
                "text": f"❌ **Error updating slide notes:** {str(e)}"
            }],
            "status": "error"
        }


@tool(context=True)
def create_presentation(
    presentation_name: str,
    outline: dict | str | None,
    template_name: str | None,
    tool_context: ToolContext,
    theme: str | None = None
) -> Dict[str, Any]:
    """Create new presentation from outline or blank.

    Args:
        presentation_name: Output presentation name WITHOUT extension
        outline: Structured outline dict (None for blank)
                 IMPORTANT: Must be valid JSON - NO trailing commas, NO comments
                 Format: {
                     "title": str,
                     "subtitle": str,
                     "slides": [
                         {"title": str, "type": "bullet|chart|image|table|custom", "content": [...]},
                         {"title": str, "type": "custom", "custom_code": "...python code..."}
                     ]
                 }
        template_name: Template presentation name (optional). Takes priority over theme.
                       If not specified, will use built-in theme or default.
        theme: Built-in theme name (optional). Available themes:
               'modern-blue', 'professional-gray', 'vibrant-orange',
               'elegant-purple', 'clean-green'. Default: 'modern-blue'

    Slide Types:
        - "bullet" or "content": Bullet points (content: list of strings)
        - "chart": Chart data (content: dict with chart config)
        - "image": Image (content: image path or dict)
        - "table": Table (content: dict with headers/rows)
        - "custom": Execute custom python-pptx code (custom_code: string)
                    NOTE: Title is auto-set from "title" field. Do NOT add title
                    textbox in custom_code - only add images, charts, or body content.

    Example (blank with default minimal theme):
        create_presentation("new-deck", outline=None, template_name=None)

    Example (blank with specific theme):
        create_presentation("new-deck", outline=None, template_name=None, theme="vibrant-orange")

    Example (with user template):
        create_presentation("new-deck", outline={...}, template_name="company-theme")

    Example (bullet points with minimal theme):
        outline = {
            "title": "Q4 Results",
            "subtitle": "Financial Overview",
            "slides": [
                {
                    "title": "Summary",
                    "type": "bullet",
                    "content": ["Revenue: $1M", "Profit: $200K", "Growth: 25%"]
                }
            ]
        }
        create_presentation("q4-results", outline=outline, template_name=None, theme="minimal")

    Example (custom code with matplotlib):
        outline = {
            "title": "Data Analysis",
            "slides": [
                {
                    "title": "Revenue Trend",
                    "type": "custom",
                    "custom_code": '''
import matplotlib.pyplot as plt

# Generate chart
plt.figure(figsize=(10, 6))
plt.bar(['Q1', 'Q2', 'Q3', 'Q4'], [100, 120, 140, 160])
plt.title('Quarterly Revenue')
plt.ylabel('Revenue ($K)')
plt.savefig('revenue.png', dpi=150)
plt.close()

# Add to slide
slide.shapes.add_picture('revenue.png', Inches(1), Inches(2), width=Inches(8))
                    '''
                },
                {
                    "title": "Key Metrics",
                    "type": "custom",
                    "custom_code": '''
# Create chart
chart_data = CategoryChartData()
chart_data.categories = ['Jan', 'Feb', 'Mar']
chart_data.add_series('Sales', (100, 120, 140))

chart = slide.shapes.add_chart(
    XL_CHART_TYPE.COLUMN_CLUSTERED,
    Inches(2), Inches(2), Inches(6), Inches(4),
    chart_data
)
                    '''
                }
            ]
        }
        create_presentation("data-analysis", outline=outline, template_name=None)
    """
    try:
        logger.info("=== create_presentation called ===")
        logger.info(f"Name: {presentation_name}, Has outline: {outline is not None}")

        # Parse outline if it's a JSON string (LLM sometimes sends JSON as string)
        if isinstance(outline, str):
            import json
            import re

            logger.info(f"Received outline as string, length: {len(outline)}")
            logger.debug(f"Outline string (first 500 chars): {outline[:500]}")

            try:
                # Try standard JSON parsing first
                outline = json.loads(outline)
                logger.info("Successfully parsed outline from JSON string")
            except json.JSONDecodeError as e:
                # Try fixing common JSON issues
                logger.warning(f"Initial JSON parse failed: {str(e)}, attempting fixes...")

                try:
                    # Remove trailing commas before ] or }
                    fixed_json = re.sub(r',(\s*[}\]])', r'\1', outline)

                    # Remove comments (// style)
                    fixed_json = re.sub(r'//.*?$', '', fixed_json, flags=re.MULTILINE)

                    # Try parsing again
                    outline = json.loads(fixed_json)
                    logger.info("Successfully parsed outline after fixing JSON issues")
                except json.JSONDecodeError as e2:
                    # Log the problematic JSON for debugging
                    logger.error(f"JSON parse failed even after fixes. Error: {str(e2)}")
                    logger.error(f"Problematic JSON snippet around error position: {outline[max(0, e2.pos-50):min(len(outline), e2.pos+50)]}")

                    return {
                        "content": [{
                            "text": f"❌ **Invalid JSON format for outline**\n\nError: {str(e2)}\n\n**Position**: Line {e2.lineno}, Column {e2.colno}\n\n**Hint**: Check for trailing commas, unescaped quotes, or invalid characters around the error position.\n\nPlease provide a valid JSON object."
                        }],
                        "status": "error"
                    }

        # Validate name
        is_valid, error_msg = _validate_presentation_name(presentation_name)
        if not is_valid:
            return {"content": [{"text": f"❌ **Invalid presentation name**: {presentation_name}\n\n{error_msg}"}], "status": "error"}

        presentation_filename = f"{presentation_name}.pptx"

        user_id, session_id = _get_user_session_ids(tool_context)
        ppt_manager = PowerPointManager(user_id, session_id)

        # Check if file already exists
        try:
            ppt_manager.load_from_s3(presentation_filename)
            return {
                "content": [{
                    "text": f"❌ **Presentation already exists**: {presentation_filename}\n\nPlease use a different name or delete the existing file first."
                }],
                "status": "error"
            }
        except FileNotFoundError:
            pass  # Good, file doesn't exist

        code_interpreter_id = _get_code_interpreter_id()
        if not code_interpreter_id:
            return {"content": [{"text": "❌ **Code Interpreter not configured**"}], "status": "error"}

        region = os.getenv('AWS_REGION', 'us-west-2')
        code_interpreter = CodeInterpreter(region)
        code_interpreter.start(identifier=code_interpreter_id)

        try:
            # Load template if specified, or use default theme
            # Handle "null", "None", "undefined" strings as None
            if template_name and template_name not in ['null', 'None', 'undefined', '']:
                # User specified template
                template_filename = f"{template_name}.pptx"
                try:
                    template_bytes = ppt_manager.load_from_s3(template_filename)
                    ppt_manager.upload_to_code_interpreter(code_interpreter, template_filename, template_bytes)
                    logger.info(f"Using user template: {template_filename}")
                except FileNotFoundError:
                    code_interpreter.stop()
                    return {
                        "content": [{
                            "text": f"❌ **Template not found**: {template_filename}"
                        }],
                        "status": "error"
                    }
            else:
                # No user template specified, use built-in theme
                template_filename = None

                # Determine which built-in theme to apply
                if not theme:
                    theme = 'minimal'  # Default to minimal theme

                logger.info(f"Using built-in theme: {theme}")

            # Upload ppt_helpers
            _upload_ppt_helpers_to_ci(code_interpreter)

            # Upload workspace images if outline includes images
            if outline and outline.get('slides'):
                ppt_manager.load_workspace_images_to_ci(code_interpreter)

            # Generate creation code
            import json

            if outline:
                # Save outline to JSON file for safe transfer to Code Interpreter
                outline_json = json.dumps(outline, ensure_ascii=False, indent=2)
                outline_filename = f"outline_{presentation_name}.json"

                # Upload outline JSON file to Code Interpreter
                outline_upload_code = f"""
import json

# Save outline to file
outline_data = {repr(outline_json)}
with open('{outline_filename}', 'w', encoding='utf-8') as f:
    f.write(outline_data)

print(f"Outline file saved: {outline_filename}")
"""
                response = code_interpreter.invoke("executeCode", {
                    "code": outline_upload_code,
                    "language": "python",
                    "clearContext": False
                })

                # Check for errors
                for event in response.get("stream", []):
                    result = event.get("result", {})
                    if result.get("isError", False):
                        error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                        logger.error(f"Failed to upload outline: {error_msg[:200]}")
                        code_interpreter.stop()
                        return {
                            "content": [{"text": f"❌ **Failed to prepare outline**: {error_msg[:500]}"}],
                            "status": "error"
                        }

                # Create from outline using file
                code = f"""
from pptx import Presentation
from ppt_helpers import generate_ppt_structure
import json

# Load template or create blank
prs = Presentation({f"'{template_filename}'" if template_filename else ""})

# Load outline from file
with open('{outline_filename}', 'r', encoding='utf-8') as f:
    outline = json.load(f)

# Generate from outline with theme
generate_ppt_structure(prs, outline, theme_name={f"'{theme}'" if theme and not template_filename else "None"})

# Save
prs.save('{presentation_filename}')

print(f"✅ Created presentation with {{len(prs.slides)}} slides")
""".strip()
            else:
                # Create blank presentation
                theme_code = ""
                if theme and not template_filename:
                    theme_code = f"""
# Apply theme to title slide
from ppt_helpers import BUILTIN_THEMES, _apply_theme_to_slide_shapes
theme = BUILTIN_THEMES.get('{theme}', BUILTIN_THEMES['minimal'])
_apply_theme_to_slide_shapes(slide, theme)
"""

                code = f"""
from pptx import Presentation

# Create blank presentation (title slide only)
prs = Presentation({f"'{template_filename}'" if template_filename else ""})

# Add title slide if completely blank
if len(prs.slides) == 0:
    title_slide_layout = prs.slide_layouts[0]
    slide = prs.slides.add_slide(title_slide_layout)
    title = slide.shapes.title
    subtitle = slide.placeholders[1]
    title.text = "New Presentation"
    subtitle.text = "Created with AgentCore"
{theme_code}
# Save
prs.save('{presentation_filename}')

print(f"✅ Created blank presentation with {{len(prs.slides)}} slide(s)")
""".strip()

            response = code_interpreter.invoke("executeCode", {"code": code, "language": "python", "clearContext": False})

            # Check for errors
            for event in response.get("stream", []):
                result = event.get("result", {})
                if result.get("isError", False):
                    error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                    logger.error(f"Create presentation failed: {error_msg[:500]}")
                    code_interpreter.stop()
                    return {"content": [{"text": f"❌ **Failed to create presentation**\n\n```\n{error_msg[:1000]}\n```"}], "status": "error"}

            # Download result
            output_ci_path = ppt_manager.get_ci_path(presentation_filename)
            file_bytes = ppt_manager.download_from_code_interpreter(code_interpreter, output_ci_path)

            if not file_bytes:
                code_interpreter.stop()
                return {"content": [{"text": "❌ **Failed to retrieve presentation**"}], "status": "error"}

            # Save to S3
            s3_info = ppt_manager.save_to_s3(presentation_filename, file_bytes)

            # Save as artifact for Canvas display
            _save_ppt_artifact(
                tool_context=tool_context,
                filename=presentation_filename,
                s3_url=s3_info['s3_url'],
                size_kb=s3_info['size_kb'],
                tool_name='create_presentation',
                user_id=user_id,
                session_id=session_id
            )

            # Get updated workspace list
            documents = ppt_manager.list_s3_documents()
            other_files_count = len([d for d in documents if d['filename'] != presentation_filename])

            # Success message
            theme_display = None
            if template_filename:
                theme_display = template_filename
            elif theme:
                theme_display = f"Built-in theme: {theme}"
            else:
                theme_display = "Default"

            if outline:
                slide_count = len(outline.get('slides', [])) + 1  # +1 for title slide
                success_msg = f"""✅ **Presentation created from outline!**

**Filename:** {presentation_filename}
**Title:** {outline.get('title', 'Untitled')}
**Slides:** {slide_count}
**Theme:** {theme_display}
**Size:** {s3_info['size_kb']}
**Other files in workspace:** {other_files_count} presentation{'s' if other_files_count != 1 else ''}

**Next steps:**
- Use `analyze_presentation` to view structure
- Use `update_slide_content` to refine content
"""
            else:
                success_msg = f"""✅ **Blank presentation created!**

**Filename:** {presentation_filename}
**Theme:** {theme_display}
**Size:** {s3_info['size_kb']}
**Other files in workspace:** {other_files_count} presentation{'s' if other_files_count != 1 else ''}

**Next steps:**
- Use `add_slide` to add more slides
- Use `update_slide_content` to add content
"""

            code_interpreter.stop()
            return {
                "content": [{"text": success_msg}],
                "status": "success",
                "metadata": {
                    "filename": presentation_filename,
                    "has_outline": outline is not None,
                    "template": template_filename,
                    "size_kb": s3_info['size_kb'],
                    "s3_key": s3_info['s3_key'],
                    "tool_type": "powerpoint_presentation",
                    "user_id": user_id,
                    "session_id": session_id
                }
            }

        except Exception as e:
            code_interpreter.stop()
            raise e

    except Exception as e:
        logger.error(f"create_presentation error: {e}", exc_info=True)
        return {"content": [{"text": f"❌ **Error:** {str(e)}"}], "status": "error"}


@tool(context=True)
def preview_presentation_slides(
    presentation_name: str,
    slide_numbers: list[int],
    tool_context: ToolContext
) -> Dict[str, Any]:
    """Get slide screenshots for YOU (the agent) to visually inspect before editing.

    This tool is for YOUR internal use - to see the actual layout, formatting,
    and content of slides before making modifications. Images are sent to you,
    not displayed to the user.

    Args:
        presentation_name: Presentation name without extension (e.g., "sales-deck")
        slide_numbers: List of slide numbers to preview (1-indexed).
                      Use empty list [] for all slides.
                      Example: [1, 3, 5] or []

    Use BEFORE modifying a presentation to:
    - See exact slide layout and formatting
    - Identify images, charts, or animations
    - Understand placeholder positions
    - Plan precise edits based on visual layout
    """
    import subprocess
    import tempfile
    import io
    from pdf2image import convert_from_path

    # Get user and session IDs
    user_id, session_id = _get_user_session_ids(tool_context)

    # Validate and prepare filename
    presentation_filename = f"{presentation_name}.pptx"
    logger.info(f"preview_presentation_slides: {presentation_filename}, slides {slide_numbers}")

    try:
        # Initialize presentation manager
        ppt_manager = PowerPointManager(user_id, session_id)

        # Check if presentation exists
        documents = ppt_manager.list_s3_documents()
        doc_info = next((d for d in documents if d['filename'] == presentation_filename), None)

        if not doc_info:
            available = [d['filename'] for d in documents if d['filename'].endswith('.pptx')]
            return {
                "content": [{
                    "text": f"Presentation not found: {presentation_filename}\n\n"
                           f"Available presentations: {', '.join(available) if available else 'None'}"
                }],
                "status": "error"
            }

        # Download presentation from S3
        pptx_bytes = ppt_manager.load_from_s3(presentation_filename)

        with tempfile.TemporaryDirectory() as temp_dir:
            # Save presentation to temp file
            pptx_path = os.path.join(temp_dir, presentation_filename)
            with open(pptx_path, 'wb') as f:
                f.write(pptx_bytes)

            # Convert PPTX to PDF using LibreOffice
            logger.info(f"Converting {presentation_filename} to PDF...")
            result = subprocess.run(
                ['soffice', '--headless', '--convert-to', 'pdf', '--outdir', temp_dir, pptx_path],
                capture_output=True,
                text=True,
                timeout=120  # 120 second timeout for large presentations
            )

            if result.returncode != 0:
                logger.error(f"LibreOffice conversion failed: {result.stderr}")
                return {
                    "content": [{
                        "text": f"PDF conversion failed\n\n{result.stderr}"
                    }],
                    "status": "error"
                }

            pdf_path = os.path.join(temp_dir, presentation_filename.replace('.pptx', '.pdf'))

            if not os.path.exists(pdf_path):
                return {
                    "content": [{
                        "text": "PDF file not created\n\nLibreOffice conversion may have failed silently."
                    }],
                    "status": "error"
                }

            # Get total pages in PDF (each slide becomes a page)
            from pdf2image import pdfinfo_from_path
            pdf_info = pdfinfo_from_path(pdf_path)
            total_slides = pdf_info.get('Pages', 1)

            # Determine which slides to preview
            if not slide_numbers:
                # Empty list means all slides
                target_slides = list(range(1, total_slides + 1))
            else:
                # Validate requested slide numbers
                invalid_slides = [s for s in slide_numbers if s < 1 or s > total_slides]
                if invalid_slides:
                    return {
                        "content": [{
                            "text": f"Invalid slide number(s): {invalid_slides}\n\n"
                                   f"Presentation has {total_slides} slides (1 to {total_slides})"
                        }],
                        "status": "error"
                    }
                target_slides = slide_numbers

            # Build content with images
            content = [{
                "text": f"**{presentation_filename}** - {len(target_slides)} slide(s) of {total_slides} total"
            }]

            for slide_num in target_slides:
                logger.info(f"Converting slide {slide_num} to image...")
                images = convert_from_path(
                    pdf_path,
                    first_page=slide_num,
                    last_page=slide_num,
                    dpi=150
                )

                if images:
                    img_buffer = io.BytesIO()
                    images[0].save(img_buffer, format='PNG')
                    img_bytes = img_buffer.getvalue()

                    content.append({"text": f"**Slide {slide_num}**"})
                    content.append({
                        "image": {
                            "format": "png",
                            "source": {"bytes": img_bytes}
                        }
                    })

            logger.info(f"Successfully generated {len(target_slides)} preview(s)")

            return {
                "content": content,
                "status": "success",
                "metadata": {
                    "filename": presentation_filename,
                    "slide_numbers": target_slides,
                    "total_slides": total_slides,
                    "tool_type": "powerpoint_presentation",
                    "user_id": user_id,
                    "session_id": session_id,
                    "hideImageInChat": True
                }
            }

    except subprocess.TimeoutExpired:
        logger.error("LibreOffice conversion timed out")
        return {
            "content": [{
                "text": "Conversion timed out\n\nThe presentation may be too large or complex."
            }],
            "status": "error"
        }
    except Exception as e:
        logger.error(f"preview_presentation_slides failed: {e}")
        return {
            "content": [{
                "text": f"Failed to generate preview\n\n{str(e)}"
            }],
            "status": "error"
        }
