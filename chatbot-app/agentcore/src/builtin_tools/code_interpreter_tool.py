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
    """Save a generated file to the code-interpreter workspace (S3)."""
    try:
        import boto3
        from workspace.config import get_workspace_bucket

        invocation_state = tool_context.invocation_state
        user_id = invocation_state.get('user_id', 'default_user')
        session_id = invocation_state.get('session_id', 'default_session')

        bucket = get_workspace_bucket()
        s3_key = f"code-interpreter-workspace/{user_id}/{session_id}/{filename}"

        boto3.client('s3').put_object(
            Bucket=bucket,
            Key=s3_key,
            Body=file_bytes,
            Metadata={'source': 'code_interpreter_tool'},
        )
        logger.info(f"Saved to workspace: s3://{bucket}/{s3_key}")
        return {'s3_key': s3_key, 'bucket': bucket}
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


# -----------------------------------------------------------------------
# Helpers for workspace ↔ sandbox sync
# -----------------------------------------------------------------------

_TEXT_EXTENSIONS = {
    '.txt', '.py', '.js', '.ts', '.json', '.csv', '.md',
    '.html', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg',
    '.sh', '.r', '.sql', '.log',
}


def _is_text_file(filename: str) -> bool:
    return os.path.splitext(filename)[1].lower() in _TEXT_EXTENSIONS


def _ws_path_to_s3_key(user_id: str, session_id: str, ws_path: str) -> str:
    """Map logical workspace path to S3 key (mirrors workspace.py logic)."""
    ws_path = ws_path.lstrip('/')
    if ws_path.startswith('code-interpreter'):
        suffix = ws_path[len('code-interpreter'):].lstrip('/')
        return f"code-interpreter-workspace/{user_id}/{session_id}/{suffix}"
    if ws_path.startswith('code-agent'):
        suffix = ws_path[len('code-agent'):].lstrip('/')
        return f"code-agent-workspace/{user_id}/{session_id}/{suffix}"
    if ws_path.startswith('documents'):
        suffix = ws_path[len('documents'):].lstrip('/')
        return f"documents/{user_id}/{session_id}/{suffix}"
    return f"documents/{user_id}/{session_id}/{ws_path}"


def _extract_file_list(result: dict) -> list:
    """Parse a listFiles result into a list of file path strings."""
    text = _extract_text(result).strip()
    if not text:
        return []
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return [str(f) for f in data]
        if isinstance(data, dict) and 'files' in data:
            return [str(f) for f in data['files']]
    except Exception:
        pass
    # Fallback: newline-separated filenames
    return [ln.strip() for ln in text.splitlines() if ln.strip() and ln.strip() not in ('.', '..')]


# -----------------------------------------------------------------------
# Tool 4: ci_push_to_workspace
# -----------------------------------------------------------------------

@tool(context=True)
def ci_push_to_workspace(
    paths: list = None,
    tool_context: ToolContext = None,
) -> str:
    """Save files from the CI sandbox to the shared workspace (S3).

    Use this after code execution to persist output files so other skills
    (or a future session) can access them via workspace_read / workspace_list.

    Args:
        paths: Sandbox file paths to save (e.g. ["chart.png", "results.json"]).
               If omitted, all files in the sandbox root are saved.

    Returns:
        JSON with the list of saved files and their workspace paths.
    """
    from strands_tools.code_interpreter.models import ReadFilesAction, ListFilesAction

    interpreter, session_name = _get_interpreter(tool_context)
    if interpreter is None:
        return json.dumps({"error": "Code Interpreter not available.", "status": "error"})

    try:
        # Discover files if no paths given
        if not paths:
            list_action = ListFilesAction(type="listFiles", session_name=session_name, path=".")
            list_result = interpreter.list_files(list_action)
            paths = _extract_file_list(list_result)
            if not paths:
                return json.dumps({"files_saved": [], "count": 0, "status": "ok"})

        saved = []
        for path in paths:
            try:
                read_action = ReadFilesAction(
                    type="readFiles", session_name=session_name, paths=[path]
                )
                read_result = interpreter.read_files(read_action)

                filename = os.path.basename(path)
                for item in read_result.get("content", []):
                    if not isinstance(item, dict):
                        continue
                    # Binary content
                    blob = item.get("data") or item.get("resource", {}).get("blob")
                    if blob:
                        _save_to_workspace(tool_context, filename, blob)
                        saved.append(f"code-interpreter/{filename}")
                        break
                    # Text content
                    text = item.get("text", "")
                    if text:
                        _save_to_workspace(tool_context, filename, text.encode("utf-8"))
                        saved.append(f"code-interpreter/{filename}")
                        break
            except Exception as e:
                logger.warning(f"ci_push: could not save '{path}': {e}")

        return json.dumps({"files_saved": saved, "count": len(saved), "status": "ok"})

    except Exception as e:
        logger.error(f"ci_push_to_workspace error: {e}")
        return json.dumps({"error": str(e), "status": "error"})


# -----------------------------------------------------------------------
# Tool 5: ci_pull_from_workspace
# -----------------------------------------------------------------------

@tool(context=True)
def ci_pull_from_workspace(
    workspace_paths: list,
    tool_context: ToolContext = None,
) -> str:
    """Load files from the shared workspace (S3) into the CI sandbox.

    Use this to make data files, scripts, or documents available inside
    the sandbox before running code that needs them.

    Args:
        workspace_paths: Logical workspace paths to upload into the sandbox.
                         e.g. ["code-interpreter/data.csv",
                               "documents/excel/sales.xlsx"]

    Returns:
        JSON with the list of files uploaded to the sandbox.
    """
    import base64
    import boto3
    from workspace.config import get_workspace_bucket
    from strands_tools.code_interpreter.models import (
        WriteFilesAction, FileContent, ExecuteCodeAction, LanguageType,
    )

    interpreter, session_name = _get_interpreter(tool_context)
    if interpreter is None:
        return json.dumps({"error": "Code Interpreter not available.", "status": "error"})

    try:
        invocation_state = tool_context.invocation_state
        user_id = invocation_state.get("user_id", "default_user")
        session_id = invocation_state.get("session_id", "default_session")

        bucket = get_workspace_bucket()
        s3 = boto3.client("s3")

        text_entries = []   # FileContent list for batch write
        uploaded = []

        for ws_path in workspace_paths:
            s3_key = _ws_path_to_s3_key(user_id, session_id, ws_path)
            filename = os.path.basename(ws_path)
            try:
                data = s3.get_object(Bucket=bucket, Key=s3_key)["Body"].read()
            except Exception as e:
                logger.warning(f"ci_pull: could not read '{ws_path}' from S3: {e}")
                continue

            if _is_text_file(filename):
                text_entries.append(FileContent(path=filename, text=data.decode("utf-8", errors="replace")))
                uploaded.append(filename)
            else:
                # Binary: write via a base64-decode Python script
                b64 = base64.b64encode(data).decode("utf-8")
                decode_script = (
                    f"import base64\n"
                    f"with open('{filename}', 'wb') as _f:\n"
                    f"    _f.write(base64.b64decode('{b64}'))\n"
                    f"print('Written: {filename}')\n"
                )
                action = ExecuteCodeAction(
                    type="executeCode",
                    session_name=session_name,
                    code=decode_script,
                    language=LanguageType.PYTHON,
                    clear_context=False,
                )
                interpreter.execute_code(action)
                uploaded.append(filename)

        # Batch-write all text files
        if text_entries:
            action = WriteFilesAction(type="writeFiles", session_name=session_name, content=text_entries)
            interpreter.write_files(action)

        return json.dumps({"files_uploaded": uploaded, "count": len(uploaded), "status": "ok"})

    except Exception as e:
        logger.error(f"ci_pull_from_workspace error: {e}")
        return json.dumps({"error": str(e), "status": "error"})


# --- Skill registration ---
register_skill("code-interpreter", tools=[
    execute_code, execute_command, file_operations,
    ci_push_to_workspace, ci_pull_from_workspace,
])
