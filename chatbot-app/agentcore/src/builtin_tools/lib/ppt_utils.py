"""
PowerPoint Utility Functions

Helper functions for PowerPoint presentation tools.
Separated from main tool file for better maintainability.
"""

import os
import re
import logging
import base64
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)


def validate_presentation_name(name: str) -> Tuple[bool, Optional[str]]:
    """Validate presentation name (without extension).

    Rules:
    - Only letters (a-z, A-Z), numbers (0-9), hyphens (-), and underscores (_)
    - No spaces or special characters
    - No consecutive hyphens
    - No leading/trailing hyphens

    Returns:
        (is_valid, error_message)
    """
    if not name:
        return False, "Presentation name cannot be empty"

    if not re.match(r'^[a-zA-Z0-9_\-]+$', name):
        invalid_chars = re.findall(r'[^a-zA-Z0-9_\-]', name)
        return False, f"Invalid characters: {set(invalid_chars)}. Use only letters, numbers, hyphens, underscores."

    if '--' in name:
        return False, "Cannot contain consecutive hyphens (--)"

    if name.startswith('-') or name.endswith('-'):
        return False, "Cannot start or end with a hyphen"

    return True, None


def sanitize_presentation_name(filename: str) -> str:
    """Sanitize filename for Bedrock API (removes extension).

    Use for existing files being read from S3.
    For new files, use validate_presentation_name() instead.
    """
    if '.' in filename:
        name, _ = filename.rsplit('.', 1)
    else:
        name = filename

    name = name.replace('_', '-').replace(' ', '-')
    name = re.sub(r'[^a-zA-Z0-9\-\(\)\[\]]', '', name)
    name = re.sub(r'\-+', '-', name)
    name = name.strip('-')

    if not name:
        name = 'presentation'

    return name


def get_code_interpreter_id() -> Optional[str]:
    """Get Code Interpreter ID from environment or Parameter Store."""
    code_interpreter_id = os.getenv('CODE_INTERPRETER_ID')
    if code_interpreter_id:
        return code_interpreter_id

    try:
        import boto3
        project_name = os.getenv('PROJECT_NAME', 'strands-agent-chatbot')
        environment = os.getenv('ENVIRONMENT', 'dev')
        region = os.getenv('AWS_REGION', 'us-west-2')
        param_name = f"/{project_name}/{environment}/agentcore/code-interpreter-id"

        ssm = boto3.client('ssm', region_name=region)
        response = ssm.get_parameter(Name=param_name)
        return response['Parameter']['Value']
    except Exception as e:
        logger.warning(f"Code Interpreter ID not found: {e}")
        return None


def get_user_session_ids(tool_context) -> Tuple[str, str]:
    """Extract user_id and session_id from ToolContext."""
    invocation_state = tool_context.invocation_state
    user_id = invocation_state.get('user_id', 'default_user')
    session_id = invocation_state.get('session_id', 'default_session')
    return user_id, session_id


def save_ppt_artifact(
    tool_context,
    filename: str,
    s3_url: str,
    size_kb: str,
    tool_name: str,
    user_id: str,
    session_id: str
) -> None:
    """Save PowerPoint as artifact to agent.state for Canvas display."""
    from datetime import datetime, timezone

    try:
        ppt_name = filename.replace('.pptx', '')
        artifact_id = f"ppt-{ppt_name}"

        artifacts = tool_context.agent.state.get("artifacts") or {}

        artifacts[artifact_id] = {
            "id": artifact_id,
            "type": "powerpoint_presentation",
            "title": filename,
            "content": s3_url,
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

        tool_context.agent.state.set("artifacts", artifacts)

        session_manager = tool_context.invocation_state.get("session_manager")
        if not session_manager and hasattr(tool_context.agent, 'session_manager'):
            session_manager = tool_context.agent.session_manager

        if session_manager:
            session_manager.sync_agent(tool_context.agent)
            logger.info(f"Saved PPT artifact: {artifact_id}")

    except Exception as e:
        logger.error(f"Failed to save PPT artifact: {e}")


def get_file_compatibility_error(filename: str, error_msg: str, operation: str) -> Dict[str, Any]:
    """Generate file compatibility error response."""
    return {
        "content": [{
            "text": f"**Cannot {operation} presentation: File compatibility issue**\n\n"
                   f"The file `{filename}` is not compatible with the editing tools.\n\n"
                   f"**Options:**\n"
                   f"1. Re-save in PowerPoint as .pptx and re-upload\n"
                   f"2. Save as PDF and I'll create a new presentation from it\n\n"
                   f"<details><summary>Error details</summary>\n\n```\n{error_msg[:500]}\n```\n</details>"
        }],
        "status": "error"
    }


def upload_ppt_helpers_to_ci(code_interpreter) -> None:
    """Upload ppt_helpers.py module to Code Interpreter workspace."""
    try:
        helpers_path = os.path.join(os.path.dirname(__file__), 'ppt_helpers.py')

        if not os.path.exists(helpers_path):
            logger.warning(f"ppt_helpers.py not found at {helpers_path}")
            return

        with open(helpers_path, 'rb') as f:
            helpers_bytes = f.read()

        encoded_content = base64.b64encode(helpers_bytes).decode('utf-8')

        upload_code = f'''
import base64

module_content = base64.b64decode('{encoded_content}')

with open('presentation_editor.py', 'wb') as f:
    f.write(module_content)

with open('ppt_helpers.py', 'wb') as f:
    f.write(module_content)

print("ppt_helpers modules loaded")
'''

        response = code_interpreter.invoke("executeCode", {
            "code": upload_code,
            "language": "python",
            "clearContext": False
        })

        for event in response.get("stream", []):
            result = event.get("result", {})
            if result.get("isError", False):
                error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                logger.error(f"Failed to upload ppt_helpers: {error_msg[:200]}")
                return

    except Exception as e:
        logger.error(f"Failed to upload ppt_helpers: {e}")


def make_error_response(message: str) -> Dict[str, Any]:
    """Create standard error response."""
    return {
        "content": [{"text": f"**Error:** {message}"}],
        "status": "error"
    }


def make_success_response(message: str, **metadata) -> Dict[str, Any]:
    """Create standard success response."""
    from .tool_response import build_success_response
    return build_success_response(message, metadata)
