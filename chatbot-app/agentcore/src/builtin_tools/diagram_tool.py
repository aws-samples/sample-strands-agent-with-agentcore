"""Visual design and chart generation tools using Bedrock Code Interpreter

Two tools for different use cases:
- generate_chart: Data visualization with matplotlib/plotly
- create_visual_design: Posters, infographics, artwork with reportlab/Pillow/svgwrite

Generated outputs are automatically saved to workspace for reuse in Word/Excel/PowerPoint documents.
"""

from strands import tool, ToolContext
from skill import register_skill
from typing import Dict, Any, Optional
from builtin_tools.lib.tool_response import build_success_response, build_image_response
import logging
import os

logger = logging.getLogger(__name__)


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
    invocation_state = tool_context.invocation_state
    user_id = invocation_state.get('user_id', 'default_user')
    session_id = invocation_state.get('session_id', 'default_session')

    logger.info(f"Extracted IDs: user_id={user_id}, session_id={session_id}")
    return user_id, session_id


def _execute_code_interpreter(
    python_code: str,
    output_filename: str,
    tool_context: ToolContext,
    tool_name: str
) -> Dict[str, Any]:
    """Common Code Interpreter execution logic for both chart and design tools.

    Handles: initialization -> code execution -> file download -> S3 save -> result return.

    Args:
        python_code: Python code to execute
        output_filename: Expected output filename (.png or .pdf)
        tool_context: Strands ToolContext
        tool_name: Name of the calling tool (for metadata)

    Returns:
        ToolResult dict with content and status
    """
    from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter
    from workspace import ImageManager

    # Validate filename extension
    valid_extensions = ('.png', '.pdf')
    if not output_filename or not output_filename.lower().endswith(valid_extensions):
        return {
            "content": [{
                "text": f"Invalid filename. Must end with .png or .pdf (e.g., 'my-design.png')\nYou provided: {output_filename}"
            }],
            "status": "error"
        }

    try:
        logger.info(f"[{tool_name}] Generating output via Code Interpreter: {output_filename}")

        # 1. Get Custom Code Interpreter ID
        code_interpreter_id = _get_code_interpreter_id()

        if not code_interpreter_id:
            return {
                "content": [{
                    "text": """Custom Code Interpreter ID not found.

Code Interpreter tools require Custom Code Interpreter.
Please deploy AgentCore Runtime Stack to create Custom Code Interpreter."""
                }],
                "status": "error"
            }

        # 2. Initialize Code Interpreter with Custom resource
        region = os.getenv('AWS_REGION', 'us-west-2')
        code_interpreter = CodeInterpreter(region)

        logger.info(f"Starting Custom Code Interpreter (ID: {code_interpreter_id})")
        code_interpreter.start(identifier=code_interpreter_id)

        logger.info(f"Code Interpreter started - executing code for {output_filename}")

        # 3. Execute Python code
        response = code_interpreter.invoke("executeCode", {
            "code": python_code,
            "language": "python",
            "clearContext": False
        })

        logger.info(f"Code execution completed for {output_filename}")

        # 4. Check for errors
        execution_success = False
        execution_output = ""

        for event in response.get("stream", []):
            result = event.get("result", {})
            if result.get("isError", False):
                error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                logger.error(f"Code execution failed: {error_msg[:200]}")
                code_interpreter.stop()

                return {
                    "content": [{
                        "text": f"""Python code execution failed

**Error Output:**
```
{error_msg[:500]}
```

**Your Code:**
```python
{python_code[:500]}{'...' if len(python_code) > 500 else ''}
```

Please fix the error and try again."""
                    }],
                    "status": "error"
                }

            execution_output = result.get("structuredContent", {}).get("stdout", "")
            execution_success = True

        if not execution_success:
            logger.warning("Code Interpreter: No result returned")
            code_interpreter.stop()
            return {
                "content": [{
                    "text": """No result from Bedrock Code Interpreter

The code was sent but no result was returned.
Please try again or simplify your code."""
                }],
                "status": "error"
            }

        logger.info("Code execution successful, downloading file...")

        # 5. Download the generated file
        file_content = None
        try:
            download_response = code_interpreter.invoke("readFiles", {"paths": [output_filename]})

            for event in download_response.get("stream", []):
                result = event.get("result", {})
                if "content" in result and len(result["content"]) > 0:
                    content_block = result["content"][0]
                    if "data" in content_block:
                        file_content = content_block["data"]
                    elif "resource" in content_block and "blob" in content_block["resource"]:
                        file_content = content_block["resource"]["blob"]

                    if file_content:
                        break

            if not file_content:
                raise Exception(f"No file content returned for {output_filename}")

            logger.info(f"Successfully downloaded output: {output_filename} ({len(file_content)} bytes)")

            # Save to workspace for reuse in documents
            user_id, session_id = _get_user_session_ids(tool_context)
            image_manager = ImageManager(user_id, session_id)
            s3_info = image_manager.save_to_s3(
                output_filename,
                file_content,
                metadata={'source': 'diagram_tool', 'tool': tool_name}
            )
            logger.info(f"Saved output to workspace: {s3_info['s3_key']}")

        except Exception as e:
            logger.error(f"Failed to download output file: {str(e)}")
            code_interpreter.stop()

            # List available files for debugging
            available_files = []
            try:
                file_list_response = code_interpreter.invoke("listFiles", {"path": ""})
                for event in file_list_response.get("stream", []):
                    result = event.get("result", {})
                    if "content" in result:
                        for item in result.get("content", []):
                            if item.get("description") == "File":
                                filename = item.get("name", "")
                                if filename:
                                    available_files.append(filename)
            except:
                pass

            return {
                "content": [{
                    "text": f"""Failed to download output file

**Error:** Could not download '{output_filename}'
**Exception:** {str(e)}

**Available files in session:** {', '.join(available_files) if available_files else 'None'}

**Fix:** Make sure your code saves to the exact filename: '{output_filename}'"""
                }],
                "status": "error"
            }

        finally:
            code_interpreter.stop()

        # 6. Get workspace summary
        user_id, session_id = _get_user_session_ids(tool_context)
        image_manager = ImageManager(user_id, session_id)
        workspace_images = image_manager.list_s3_documents()
        other_images_count = len([img for img in workspace_images if img['filename'] != output_filename])

        file_size_kb = len(file_content) / 1024
        logger.info(f"Output successfully generated: {file_size_kb:.1f} KB")

        # 7. Build result content
        is_pdf = output_filename.lower().endswith('.pdf')
        file_format = "pdf" if is_pdf else "png"

        result_content = [
            {
                "text": f"""**Generated: {output_filename}**

Saved to workspace for reuse in documents.
**Size:** {file_size_kb:.1f} KB
**Other files in workspace:** {other_images_count} file{'s' if other_images_count != 1 else ''}"""
            }
        ]

        metadata = {
            "filename": output_filename,
            "s3_key": s3_info['s3_key'],
            "size_kb": f"{file_size_kb:.1f}",
            "format": file_format,
            "tool_type": tool_name,
            "user_id": user_id,
            "session_id": session_id,
        }

        # Add image preview for PNG files
        if not is_pdf:
            image_blocks = [{
                "image": {
                    "format": "png",
                    "source": {
                        "bytes": file_content
                    }
                }
            }]
            return build_image_response(result_content, image_blocks, metadata)
        else:
            result_content[0]["text"] += "\n\n*PDF generated. Use the document download feature to view.*"
            return build_success_response(result_content[0]["text"], metadata)

    except Exception as e:
        import traceback
        logger.error(f"[{tool_name}] Generation failed: {str(e)}")

        return {
            "content": [{
                "text": f"""Failed to generate output

**Error:** {str(e)}

**Traceback:**
```
{traceback.format_exc()[:500]}
```"""
            }],
            "status": "error"
        }


@tool(context=True)
def generate_chart(
    python_code: str,
    output_filename: str,
    tool_context: ToolContext
) -> Dict[str, Any]:
    """Generate data charts and graphs using matplotlib or plotly via Bedrock Code Interpreter.

    Args:
        python_code: Python code for chart generation.
                    Must save to output_filename (e.g., plt.savefig(output_filename, dpi=300, bbox_inches='tight')).
                    Available: matplotlib, plotly, pandas, numpy, bokeh.
        output_filename: Output PNG filename (must end with .png).

    Returns:
        Chart image in ToolResult format with workspace save confirmation.
    """
    return _execute_code_interpreter(python_code, output_filename, tool_context, "generate_chart")


@tool(context=True)
def create_visual_design(
    python_code: str,
    output_filename: str,
    tool_context: ToolContext
) -> Dict[str, Any]:
    """Create visual designs (posters, infographics, artwork, flow diagrams) via Bedrock Code Interpreter.

    Args:
        python_code: Python code for visual design generation.
                    Must save to output_filename.
                    Available: reportlab, Pillow, svgwrite, matplotlib, fonttools, Wand, opencv-python.
        output_filename: Output filename (must end with .png or .pdf).

    Returns:
        Design output in ToolResult format with workspace save confirmation.
    """
    return _execute_code_interpreter(python_code, output_filename, tool_context, "create_visual_design")


# --- Skill registration ---
register_skill("visual-design", tools=[generate_chart, create_visual_design])
