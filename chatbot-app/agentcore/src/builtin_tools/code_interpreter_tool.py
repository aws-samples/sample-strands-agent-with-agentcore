"""General-purpose Code Interpreter tools using AWS Bedrock AgentCore Code Interpreter.

Provides 3 tools wrapping AgentCoreCodeInterpreter:
  - execute_code:    Run Python/JS/TS code
  - execute_command: Run shell commands
  - file_operations: Read/write/list/remove files in the sandbox

Session state persists across calls within the same user session.
The SKILL.md provides detailed guidance on available libraries and patterns.
"""

from strands import tool, ToolContext
from skill import register_skill
from typing import Any, Dict, List, Literal, Optional
import json
import logging
import os

logger = logging.getLogger(__name__)

# Module-level interpreter cache: session_key → (AgentCoreCodeInterpreter, session_name)
_interpreters: Dict[str, Any] = {}


def _get_code_interpreter_id() -> Optional[str]:
    """Get Custom Code Interpreter ID from environment or Parameter Store."""
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


def _get_session_key(tool_context: ToolContext) -> str:
    """Build a session key from ToolContext for interpreter reuse."""
    invocation_state = tool_context.invocation_state
    user_id = invocation_state.get('user_id', 'default_user')
    session_id = invocation_state.get('session_id', 'default_session')
    return f"{user_id}-{session_id}"


def _get_interpreter(tool_context: ToolContext):
    """Get or create an AgentCoreCodeInterpreter for the current session.

    Reuses interpreters across tool calls within the same user session.
    Creates a session with a custom Code Interpreter identifier if configured.

    Returns:
        tuple: (interpreter, session_name) or (None, None)
    """
    from strands_tools.code_interpreter import AgentCoreCodeInterpreter
    from strands_tools.code_interpreter.agent_core_code_interpreter import (
        BedrockAgentCoreCodeInterpreterClient,
        SessionInfo,
    )

    session_key = _get_session_key(tool_context)

    if session_key not in _interpreters:
        identifier = _get_code_interpreter_id()
        if not identifier:
            return None, None

        region = os.getenv('AWS_REGION', 'us-west-2')
        interpreter = AgentCoreCodeInterpreter(region=region)

        # Create a session with the custom identifier
        client = BedrockAgentCoreCodeInterpreterClient(region=region)
        client.start(identifier=identifier, name=session_key)

        interpreter._sessions[session_key] = SessionInfo(
            session_id=client.session_id,
            description=f"Code interpreter session: {session_key}",
            client=client,
        )

        _interpreters[session_key] = (interpreter, session_key)
        logger.info(f"Created CodeInterpreter for session: {session_key} (identifier: {identifier})")

    return _interpreters[session_key]


def _extract_text(result: Dict[str, Any]) -> str:
    """Extract text content from a tool result dict."""
    content = result.get("content", [])
    parts = []
    for item in content:
        if isinstance(item, dict):
            text = item.get("text", "")
            if text:
                parts.append(text)
        elif isinstance(item, str):
            parts.append(item)
    return "\n".join(parts) if parts else json.dumps(result)


def _save_to_workspace(tool_context: ToolContext, filename: str, file_bytes: bytes) -> Optional[dict]:
    """Save a generated file to the workspace (S3)."""
    try:
        invocation_state = tool_context.invocation_state
        user_id = invocation_state.get('user_id', 'default_user')
        session_id = invocation_state.get('session_id', 'default_session')

        lower = filename.lower()
        if lower.endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp')):
            from workspace import ImageManager
            manager = ImageManager(user_id, session_id)
        elif lower.endswith(('.xlsx', '.xls', '.csv')):
            from workspace import ExcelManager
            manager = ExcelManager(user_id, session_id)
        elif lower.endswith(('.docx', '.doc')):
            from workspace import WordManager
            manager = WordManager(user_id, session_id)
        elif lower.endswith(('.pptx', '.ppt')):
            from workspace import PowerPointManager
            manager = PowerPointManager(user_id, session_id)
        else:
            from workspace import ImageManager
            manager = ImageManager(user_id, session_id)

        s3_info = manager.save_to_s3(
            filename, file_bytes,
            metadata={'source': 'code_interpreter_tool'},
        )
        logger.info(f"Saved to workspace: {s3_info['s3_key']}")
        return s3_info
    except Exception as e:
        logger.warning(f"Could not save to workspace: {e}")
        return None


# -----------------------------------------------------------------------
# Tool 1: execute_code
# -----------------------------------------------------------------------

@tool(context=True)
def execute_code(
    code: str,
    language: str = "python",
    output_filename: str = "",
    tool_context: ToolContext = None,
) -> str:
    """Execute code in a sandboxed Code Interpreter environment.

    Supports Python (recommended, 200+ libraries), JavaScript, and TypeScript.
    Use print() to return text results. Variables persist across calls.

    Args:
        code: Code to execute.
        language: "python" (default), "javascript", or "typescript".
        output_filename: Optional. If provided, downloads this file after execution
                        and saves it to workspace. Code must save a file with this exact name.

    Returns:
        Execution stdout, or file confirmation if output_filename is set.
    """
    from strands_tools.code_interpreter.models import ExecuteCodeAction, LanguageType

    interpreter, session_name = _get_interpreter(tool_context)
    if interpreter is None:
        return json.dumps({
            "error": "Code Interpreter not available. Deploy AgentCore Runtime Stack.",
            "status": "error",
        })

    # Map language string to enum
    lang_map = {
        "python": LanguageType.PYTHON,
        "javascript": LanguageType.JAVASCRIPT,
        "typescript": LanguageType.TYPESCRIPT,
    }
    lang_enum = lang_map.get(language.lower(), LanguageType.PYTHON)

    try:
        action = ExecuteCodeAction(
            type="executeCode",
            session_name=session_name,
            code=code,
            language=lang_enum,
            clear_context=False,
        )
        result = interpreter.execute_code(action)
        output = _extract_text(result)

        if result.get("status") == "error":
            return json.dumps({
                "error": output,
                "code_snippet": code[:300],
                "status": "error",
            })

        # If no output file requested, return stdout
        if not output_filename:
            return output or "(no output)"

        # Download output file via file_operations read
        from strands_tools.code_interpreter.models import ReadFilesAction
        read_action = ReadFilesAction(
            type="readFiles",
            session_name=session_name,
            paths=[output_filename],
        )
        read_result = interpreter.read_files(read_action)

        # Try to extract binary content for workspace save
        file_saved = False
        read_content = read_result.get("content", [])
        for item in read_content:
            if isinstance(item, dict):
                blob = None
                if "data" in item:
                    blob = item["data"]
                elif "resource" in item and "blob" in item.get("resource", {}):
                    blob = item["resource"]["blob"]
                if blob:
                    s3_info = _save_to_workspace(tool_context, output_filename, blob)
                    file_saved = True
                    size_kb = len(blob) / 1024

                    summary = f"Code executed. File saved: {output_filename} ({size_kb:.1f} KB)"
                    if output:
                        summary += f"\n\nstdout:\n{output[:500]}"

                    # Return image inline if applicable
                    lower_name = output_filename.lower()
                    if lower_name.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')):
                        return json.dumps({
                            "content": [
                                {"text": summary},
                                {"image": {
                                    "format": "png" if lower_name.endswith(".png") else "jpeg",
                                    "source": {"bytes": "__IMAGE_BYTES__"},
                                }},
                            ],
                            "status": "success",
                        })

                    return summary

        if not file_saved:
            return json.dumps({
                "warning": f"Code executed but could not download '{output_filename}'.",
                "stdout": output[:500] if output else "(none)",
                "status": "partial",
            })

    except Exception as e:
        logger.error(f"execute_code error: {e}")
        return json.dumps({"error": str(e), "status": "error"})


# -----------------------------------------------------------------------
# Tool 2: execute_command
# -----------------------------------------------------------------------

@tool(context=True)
def execute_command(
    command: str,
    tool_context: ToolContext = None,
) -> str:
    """Execute a shell command in the Code Interpreter sandbox.

    Useful for: installing packages (pip install), listing files (ls),
    checking environment (python --version), running scripts, etc.

    Args:
        command: Shell command to execute (e.g. "ls -la", "pip install requests").

    Returns:
        Command stdout/stderr output.
    """
    from strands_tools.code_interpreter.models import ExecuteCommandAction

    interpreter, session_name = _get_interpreter(tool_context)
    if interpreter is None:
        return json.dumps({
            "error": "Code Interpreter not available. Deploy AgentCore Runtime Stack.",
            "status": "error",
        })

    try:
        action = ExecuteCommandAction(
            type="executeCommand",
            session_name=session_name,
            command=command,
        )
        result = interpreter.execute_command(action)
        return _extract_text(result)

    except Exception as e:
        logger.error(f"execute_command error: {e}")
        return json.dumps({"error": str(e), "status": "error"})


# -----------------------------------------------------------------------
# Tool 3: file_operations
# -----------------------------------------------------------------------

@tool(context=True)
def file_operations(
    operation: str,
    paths: list = None,
    content: list = None,
    tool_context: ToolContext = None,
) -> str:
    """Manage files in the Code Interpreter sandbox.

    Args:
        operation: One of "read", "write", "list", "remove".
        paths: File paths (required for read/remove/list).
              - read:   ["file1.txt", "file2.csv"]
              - remove: ["old_file.txt"]
              - list:   ["." ] or ["/path/to/dir"]  (single path)
        content: File content entries (required for write).
                Each entry: {"path": "output.txt", "text": "file content here"}

    Returns:
        Operation result (file content, file list, or confirmation).
    """
    from strands_tools.code_interpreter.models import (
        ReadFilesAction,
        WriteFilesAction,
        ListFilesAction,
        RemoveFilesAction,
        FileContent,
    )

    interpreter, session_name = _get_interpreter(tool_context)
    if interpreter is None:
        return json.dumps({
            "error": "Code Interpreter not available. Deploy AgentCore Runtime Stack.",
            "status": "error",
        })

    try:
        if operation == "read":
            if not paths:
                return json.dumps({"error": "paths required for read operation", "status": "error"})
            action = ReadFilesAction(type="readFiles", session_name=session_name, paths=paths)
            result = interpreter.read_files(action)
            return _extract_text(result)

        elif operation == "write":
            if not content:
                return json.dumps({"error": "content required for write operation", "status": "error"})
            file_contents = [
                FileContent(path=entry["path"], text=entry["text"])
                for entry in content
            ]
            action = WriteFilesAction(type="writeFiles", session_name=session_name, content=file_contents)
            result = interpreter.write_files(action)
            return _extract_text(result)

        elif operation == "list":
            list_path = paths[0] if paths else "."
            action = ListFilesAction(type="listFiles", session_name=session_name, path=list_path)
            result = interpreter.list_files(action)
            return _extract_text(result)

        elif operation == "remove":
            if not paths:
                return json.dumps({"error": "paths required for remove operation", "status": "error"})
            action = RemoveFilesAction(type="removeFiles", session_name=session_name, paths=paths)
            result = interpreter.remove_files(action)
            return _extract_text(result)

        else:
            return json.dumps({
                "error": f"Unknown operation: '{operation}'. Use: read, write, list, remove",
                "status": "error",
            })

    except Exception as e:
        logger.error(f"file_operations ({operation}) error: {e}")
        return json.dumps({"error": str(e), "status": "error"})


# --- Skill registration ---
register_skill("code-interpreter", tools=[execute_code, execute_command, file_operations])
