"""Diagram generation tool using Bedrock Code Interpreter

This tool generates diagrams and charts by executing Python code in AWS Bedrock Code Interpreter.
It supports matplotlib, pandas, and numpy for creating visualizations.

Generated diagrams are automatically saved to workspace for reuse in Word/Excel/PowerPoint documents.
"""

from strands import tool, ToolContext
from typing import Dict, Any, Optional
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


@tool(context=True)
def generate_diagram_and_validate(
    python_code: str,
    diagram_filename: str,
    tool_context: ToolContext
) -> Dict[str, Any]:
    """Generate diagrams and charts using Python code via Bedrock Code Interpreter.

    Available libraries: matplotlib.pyplot, pandas, numpy

    Args:
        python_code: Python code for diagram generation.
                    Must include: plt.savefig(diagram_filename, dpi=300, bbox_inches='tight')
                    Best practices:
                    - Use figsize=(10, 6) or larger for readable diagrams
                    - Include proper labels, titles, and legends
                    - Use high DPI (300) for crisp output
        diagram_filename: PNG filename (must end with .png).
                         Example: 'revenue-chart.png'

    Returns:
        Diagram as image in ToolResult format:
        {
            "content": [
                {"text": "✅ Diagram generated: ..."},
                {"image": {"format": "png", "source": {"bytes": b"..."}}}
            ],
            "status": "success"
        }
        - The diagram is returned as raw PNG bytes (not base64)
        - Automatically saved to workspace for reuse in Word/Excel/PowerPoint documents
    """
    from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter
    from workspace import ImageManager

    # Validate diagram_filename
    if not diagram_filename or not diagram_filename.endswith('.png'):
        return {
            "content": [{
                "text": f"❌ Invalid filename. Must end with .png (e.g., 'my_diagram.png')\nYou provided: {diagram_filename}"
            }],
            "status": "error"
        }

    try:
        logger.info(f"Generating diagram via Code Interpreter: {diagram_filename}")

        # 1. Get Custom Code Interpreter ID
        code_interpreter_id = _get_code_interpreter_id()

        if not code_interpreter_id:
            return {
                "content": [{
                    "text": """❌ Custom Code Interpreter ID not found.

Code Interpreter tools require Custom Code Interpreter.
Please deploy AgentCore Runtime Stack to create Custom Code Interpreter."""
                }],
                "status": "error"
            }

        # 2. Initialize Code Interpreter with Custom resource
        region = os.getenv('AWS_REGION', 'us-west-2')
        code_interpreter = CodeInterpreter(region)

        logger.info(f"🔐 Starting Custom Code Interpreter (ID: {code_interpreter_id})")
        code_interpreter.start(identifier=code_interpreter_id)

        logger.info(f"Code Interpreter started - executing code for {diagram_filename}")

        # 3. Execute Python code
        response = code_interpreter.invoke("executeCode", {
            "code": python_code,
            "language": "python",
            "clearContext": False
        })

        logger.info(f"Code execution completed for {diagram_filename}")

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
                        "text": f"""❌ Python code execution failed

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
                    "text": """❌ No result from Bedrock Code Interpreter

The code was sent but no result was returned.
Please try again or simplify your code."""
                }],
                "status": "error"
            }

        logger.info("Code execution successful, downloading file...")

        # 5. Download the generated file
        file_content = None
        try:
            download_response = code_interpreter.invoke("readFiles", {"paths": [diagram_filename]})

            for event in download_response.get("stream", []):
                result = event.get("result", {})
                if "content" in result and len(result["content"]) > 0:
                    content_block = result["content"][0]
                    # File content can be in 'data' (bytes) or 'resource.blob'
                    if "data" in content_block:
                        file_content = content_block["data"]
                    elif "resource" in content_block and "blob" in content_block["resource"]:
                        file_content = content_block["resource"]["blob"]

                    if file_content:
                        break

            if not file_content:
                raise Exception(f"No file content returned for {diagram_filename}")

            logger.info(f"Successfully downloaded diagram: {diagram_filename} ({len(file_content)} bytes)")

            # Save to workspace for reuse in documents
            user_id, session_id = _get_user_session_ids(tool_context)
            image_manager = ImageManager(user_id, session_id)
            s3_info = image_manager.save_to_s3(
                diagram_filename,
                file_content,
                metadata={'source': 'diagram_tool', 'tool': 'generate_diagram_and_validate'}
            )
            logger.info(f"Saved diagram to workspace: {s3_info['s3_key']}")

        except Exception as e:
            logger.error(f"Failed to download diagram file: {str(e)}")
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
                    "text": f"""❌ Failed to download diagram file

**Error:** Could not download '{diagram_filename}'
**Exception:** {str(e)}

**Available files in session:** {', '.join(available_files) if available_files else 'None'}

**Fix:** Make sure your code creates the file with the exact filename:
```python
plt.savefig('{diagram_filename}', dpi=300, bbox_inches='tight')
```"""
                }],
                "status": "error"
            }

        finally:
            code_interpreter.stop()

        # 6. Get workspace summary
        user_id, session_id = _get_user_session_ids(tool_context)
        image_manager = ImageManager(user_id, session_id)
        workspace_images = image_manager.list_s3_documents()
        other_images_count = len([img for img in workspace_images if img['filename'] != diagram_filename])

        file_size_kb = len(file_content) / 1024
        logger.info(f"Diagram successfully generated: {file_size_kb:.1f} KB")

        # 7. Return ToolResult in Strands SDK format
        from strands.types.tools import ToolResult

        return {
            "content": [
                {
                    "text": f"""✅ **Diagram generated: {diagram_filename}**

Saved to workspace for reuse in documents.
**Size:** {file_size_kb:.1f} KB
**Other images in workspace:** {other_images_count} image{'s' if other_images_count != 1 else ''}"""
                },
                {
                    "image": {
                        "format": "png",
                        "source": {
                            "bytes": file_content  # Raw bytes, not base64
                        }
                    }
                }
            ],
            "status": "success"
        }

    except Exception as e:
        import traceback
        logger.error(f"Diagram generation failed: {str(e)}")

        from strands.types.tools import ToolResult

        return {
            "content": [{
                "text": f"""❌ Failed to generate diagram

**Error:** {str(e)}

**Traceback:**
```
{traceback.format_exc()[:500]}
```"""
            }],
            "status": "error"
        }
