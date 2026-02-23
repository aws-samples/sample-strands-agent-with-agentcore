"""
Code Agent A2A Server

Receives coding tasks via A2A protocol and executes them autonomously
using built-in tools: Read, Write, Edit, Bash, Glob, Grep.

Authentication: CLAUDE_CODE_USE_BEDROCK=1 + IAM execution role (no API key needed)
Requires: Node.js + @anthropic-ai/claude-code installed in container (claude-agent-sdk spawns the claude CLI)

For local testing:
    CLAUDE_CODE_USE_BEDROCK=1 ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-6 \
    uvicorn src.main:app --port 9000 --reload
"""

import json
import logging
import os
import uuid
import zipfile
from pathlib import Path
from typing import Optional, List, Dict, Tuple

from fastapi import FastAPI
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater, InMemoryTaskStore
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.apps import A2AStarletteApplication
from a2a.types import AgentCard, AgentCapabilities, AgentSkill, Part, TextPart

import uvicorn
from claude_agent_sdk import query, ClaudeAgentOptions

# Claude Agent SDK cannot run inside an existing Claude Code session.
# Unset CLAUDECODE so nested invocation is allowed in all environments.
os.environ.pop("CLAUDECODE", None)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class _SuppressHealthCheck(logging.Filter):
    """Filter out noisy /ping health check access logs from uvicorn."""
    def filter(self, record: logging.LogRecord) -> bool:
        return "GET /ping" not in record.getMessage()


logging.getLogger("uvicorn.access").addFilter(_SuppressHealthCheck())

# ============================================================
# Configuration
# ============================================================
AWS_REGION = os.getenv("AWS_REGION", "us-west-2")
PORT = int(os.getenv("PORT", "9000"))
PROJECT_NAME = os.getenv("PROJECT_NAME", "strands-agent-chatbot")
ENVIRONMENT = os.getenv("ENVIRONMENT", "dev")
WORKSPACE_BASE = os.getenv("WORKSPACE_BASE", "/tmp/workspaces")


def _resolve_document_bucket() -> str:
    """Get document bucket name from env var, falling back to SSM."""
    bucket = os.getenv("DOCUMENT_BUCKET", "")
    if bucket:
        return bucket
    try:
        import boto3
        ssm = boto3.client("ssm", region_name=AWS_REGION)
        resp = ssm.get_parameter(Name=f"/{PROJECT_NAME}/{ENVIRONMENT}/agentcore/document-bucket")
        return resp["Parameter"]["Value"]
    except Exception as e:
        logger.warning(f"[Config] Could not resolve DOCUMENT_BUCKET from SSM: {e}")
        return ""


DOCUMENT_BUCKET = _resolve_document_bucket()

# ~/.claude/ — where Claude Code CLI stores session .jsonl files
CLAUDE_HOME = Path.home() / ".claude"

# Tools available to the coding agent.
# Task and Notebook* are excluded: Task spawns sub-agents (hard to control),
# Notebook tools are not needed in a coding workspace.
ALLOWED_TOOLS = [
    "Read", "Write", "Edit", "Bash", "Glob", "Grep",
    "TodoRead", "TodoWrite",
    "WebFetch", "WebSearch",
]

# Tool name → user-friendly status message for streaming
TOOL_STATUS_MAP = {
    "Read":      "Reading file",
    "Write":     "Writing file",
    "Edit":      "Editing file",
    "Bash":      "Running command",
    "Glob":      "Searching files",
    "Grep":      "Searching content",
    "WebSearch": "Searching web",
    "WebFetch":  "Fetching URL",
}

# In-memory map: "{user_id}-{session_id}" → claude_agent_sdk session_id
# Allows resuming the same Claude Agent session across multiple A2A calls
_sdk_sessions: dict = {}



# ============================================================
# S3 File Handling
# ============================================================

def download_s3_files(s3_files: List[Dict], workspace: Path) -> List[str]:
    """
    Download files listed in metadata["s3_files"] into the workspace.

    Each entry: {"s3_uri": "s3://bucket/key", "filename": "code.zip"}
    Zip files are auto-extracted into a subdirectory named after the zip.

    Returns human-readable descriptions of what was placed in the workspace.
    """
    if not s3_files:
        return []

    import boto3
    from botocore.exceptions import ClientError

    s3 = boto3.client("s3", region_name=AWS_REGION)
    descriptions = []

    for entry in s3_files:
        s3_uri = entry.get("s3_uri", "")
        filename = entry.get("filename") or Path(s3_uri).name

        if not s3_uri.startswith("s3://"):
            logger.warning(f"[S3] Invalid URI skipped: {s3_uri}")
            continue

        bucket, key = s3_uri[5:].split("/", 1)
        dest = workspace / filename

        try:
            s3.download_file(bucket, key, str(dest))
            logger.info(f"[S3] {s3_uri} → {dest}")

            if filename.endswith(".zip"):
                extract_dir = workspace / Path(filename).stem
                extract_dir.mkdir(exist_ok=True)
                with zipfile.ZipFile(dest, "r") as zf:
                    zf.extractall(extract_dir)
                descriptions.append(
                    f"- `{filename}` (zip) → extracted to `{extract_dir.name}/`"
                )
                logger.info(f"[S3] Extracted → {extract_dir}")
            else:
                descriptions.append(f"- `{filename}`")

        except ClientError as e:
            logger.error(f"[S3] Download failed {s3_uri}: {e}")
            descriptions.append(f"- `{filename}` ⚠️ download failed")

    return descriptions


# ============================================================
# Session Persistence (S3 sync/restore)
# ============================================================

def _s3():
    import boto3
    return boto3.client("s3", region_name=AWS_REGION)


def _workspace_s3_prefix(user_id: str, session_id: str) -> str:
    return f"code-agent-workspace/{user_id}/{session_id}"


def _claude_home_s3_prefix(user_id: str, session_id: str) -> str:
    return f"code-agent-sessions/{user_id}/{session_id}/claude-home"


def _sdk_session_id_s3_key(user_id: str, session_id: str) -> str:
    return f"code-agent-sessions/{user_id}/{session_id}/sdk_session_id"


# Directories excluded from S3 sync/restore (build artifacts, dependency caches)
_SYNC_EXCLUDE_DIRS = {
    "node_modules", ".next", ".nuxt", ".svelte-kit",  # JS/TS
    ".venv", "venv", "env", ".env",                   # Python virtualenvs
    "__pycache__", ".mypy_cache", ".pytest_cache",    # Python caches
    "dist", "build", "out", "target",                 # Build outputs
    ".gradle", ".m2",                                 # Java/Kotlin
    ".cache", ".parcel-cache", ".turbo",              # General caches
    ".git",                                           # Git internals
}


def _should_exclude(rel: Path) -> bool:
    """Return True if any path component is in the exclude list."""
    return any(part in _SYNC_EXCLUDE_DIRS for part in rel.parts)


def _sync_dir_to_s3(local_dir: Path, bucket: str, s3_prefix: str, s3_client) -> int:
    """Upload all files under local_dir to s3://bucket/s3_prefix/. Returns upload count."""
    uploaded = 0
    for file_path in local_dir.rglob("*"):
        if not file_path.is_file():
            continue
        rel = file_path.relative_to(local_dir)
        if _should_exclude(rel):
            continue
        s3_key = f"{s3_prefix}/{rel}"
        try:
            s3_client.upload_file(str(file_path), bucket, s3_key)
            uploaded += 1
        except Exception as e:
            logger.warning(f"[S3 sync] Failed to upload {file_path}: {e}")
    return uploaded


def _restore_dir_from_s3(local_dir: Path, bucket: str, s3_prefix: str, s3_client) -> int:
    """Download all files from s3://bucket/s3_prefix/ to local_dir. Returns download count."""
    local_dir.mkdir(parents=True, exist_ok=True)
    paginator = s3_client.get_paginator("list_objects_v2")
    downloaded = 0
    try:
        for page in paginator.paginate(Bucket=bucket, Prefix=s3_prefix + "/"):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if key.endswith("/"):
                    continue
                rel = key[len(s3_prefix) + 1:]
                if not rel:
                    continue
                if _should_exclude(Path(rel)):
                    continue
                dest = local_dir / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                try:
                    s3_client.download_file(bucket, key, str(dest))
                    downloaded += 1
                except Exception as e:
                    logger.warning(f"[S3 restore] Failed to download {key}: {e}")
    except Exception as e:
        logger.warning(f"[S3 restore] List failed for prefix '{s3_prefix}': {e}")
    return downloaded


def restore_session(user_id: str, session_id: str, workspace: Path) -> Optional[str]:
    """Restore workspace + ~/.claude/ from S3. Returns sdk_session_id if previously saved."""
    if not DOCUMENT_BUCKET:
        return None

    s3 = _s3()

    # 1. Restore workspace files
    n = _restore_dir_from_s3(workspace, DOCUMENT_BUCKET, _workspace_s3_prefix(user_id, session_id), s3)
    if n:
        logger.info(f"[S3 restore] Workspace: {n} files")

    # 2. Restore ~/.claude/ (contains session .jsonl for resume=)
    n = _restore_dir_from_s3(CLAUDE_HOME, DOCUMENT_BUCKET, _claude_home_s3_prefix(user_id, session_id), s3)
    if n:
        logger.info(f"[S3 restore] Claude home: {n} files")

    # 3. Retrieve sdk_session_id saved from previous run
    try:
        resp = s3.get_object(Bucket=DOCUMENT_BUCKET, Key=_sdk_session_id_s3_key(user_id, session_id))
        sdk_session_id = resp["Body"].read().decode("utf-8").strip()
        logger.info(f"[S3 restore] sdk_session_id: {sdk_session_id}")
        return sdk_session_id
    except s3.exceptions.NoSuchKey:
        return None
    except Exception as e:
        logger.warning(f"[S3 restore] Could not retrieve sdk_session_id: {e}")
        return None


def sync_session(user_id: str, session_id: str, workspace: Path, sdk_session_id: Optional[str]) -> None:
    """Sync workspace + ~/.claude/ to S3 after task completion."""
    if not DOCUMENT_BUCKET:
        return

    s3 = _s3()

    # 1. Sync workspace files
    n = _sync_dir_to_s3(workspace, DOCUMENT_BUCKET, _workspace_s3_prefix(user_id, session_id), s3)
    logger.info(f"[S3 sync] Workspace: {n} files")

    # 2. Sync ~/.claude/ so session .jsonl survives container restarts
    if CLAUDE_HOME.exists():
        n = _sync_dir_to_s3(CLAUDE_HOME, DOCUMENT_BUCKET, _claude_home_s3_prefix(user_id, session_id), s3)
        logger.info(f"[S3 sync] Claude home: {n} files")

    # 3. Save sdk_session_id for next run
    if sdk_session_id:
        try:
            s3.put_object(
                Bucket=DOCUMENT_BUCKET,
                Key=_sdk_session_id_s3_key(user_id, session_id),
                Body=sdk_session_id.encode("utf-8"),
                ContentType="text/plain",
            )
            logger.info(f"[S3 sync] sdk_session_id saved")
        except Exception as e:
            logger.warning(f"[S3 sync] Failed to save sdk_session_id: {e}")


def _clear_session_history(user_id: str, session_id: str) -> None:
    """Delete conversation history and sdk_session_id from S3.

    Called on reset_session=True. Workspace files are intentionally preserved —
    the user may want to start a new conversation about the same codebase.
    Also clears ~/.claude/ locally so no stale session files remain.
    """
    if not DOCUMENT_BUCKET:
        return

    s3 = _s3()

    # Delete Claude home snapshot (conversation .jsonl files)
    claude_prefix = _claude_home_s3_prefix(user_id, session_id)
    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=DOCUMENT_BUCKET, Prefix=claude_prefix + "/"):
            objects = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if objects:
                s3.delete_objects(Bucket=DOCUMENT_BUCKET, Delete={"Objects": objects})
        logger.info(f"[S3 reset] Cleared Claude session history")
    except Exception as e:
        logger.warning(f"[S3 reset] Could not clear Claude session history: {e}")

    # Delete stored sdk_session_id
    try:
        s3.delete_object(Bucket=DOCUMENT_BUCKET, Key=_sdk_session_id_s3_key(user_id, session_id))
    except Exception as e:
        logger.warning(f"[S3 reset] Could not delete sdk_session_id: {e}")

    # Clear local ~/.claude/ so stale .jsonl files don't interfere
    import shutil  # noqa: PLC0415
    if CLAUDE_HOME.exists():
        shutil.rmtree(CLAUDE_HOME, ignore_errors=True)
        logger.info(f"[S3 reset] Cleared local ~/.claude/")


def ensure_claude_md(workspace: Path) -> None:
    """Create CLAUDE.md in the workspace if it does not already exist.

    Claude Code CLI auto-loads this file as project memory when setting_sources
    includes 'project'. It persists across sessions via S3 sync.
    """
    claude_md = workspace / "CLAUDE.md"
    if claude_md.exists():
        return

    content = """\
# Code Agent Workspace

Files here persist across sessions.

## Verification
Before marking a task complete, run the code or tests to confirm it actually works.
If no test exists, write one or run the code with representative input.
"Compiles" is not done. "Runs correctly" is done.

## Progress tracking
For multi-step tasks, maintain `progress.md` to track completed and remaining steps.
This file survives context resets — update it as you go.

## Conventions
Read the existing codebase before introducing patterns. Follow what's already there.

## Notes
- Uploaded files are pre-downloaded into this workspace before each task
- Prior conversation history is available — reference it naturally, don't re-read it
"""
    claude_md.write_text(content)


def build_task_with_files(task_text: str, file_descriptions: List[str]) -> str:
    """Prepend a file context block to the task when S3 files were downloaded."""
    if not file_descriptions:
        return task_text

    files_block = "\n".join(file_descriptions)
    return (
        f"The following files have been downloaded to your workspace:\n"
        f"{files_block}\n\n"
        f"{task_text}"
    )


# ============================================================
# A2A Executor
# ============================================================

class ClaudeCodeExecutor(AgentExecutor):
    """
    A2A Executor that wraps Claude Agent SDK.

    Each incoming A2A task is executed by claude_agent_sdk.query().
    Tool usage events are streamed back as intermediate A2A artifacts.
    The final result is emitted as the "code_result" artifact.

    Session continuity: the SDK session_id (captured from the init message)
    is stored and reused on subsequent calls with the same user+session pair,
    so Claude retains context (files read, edits made, etc.) across turns.
    """

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        updater = TaskUpdater(event_queue, context.task_id, context.context_id)

        # --- Extract task text ---
        task_text = _extract_text(context)
        if not task_text:
            await updater.add_artifact(
                [Part(root=TextPart(text="Error: No task provided"))],
                name="error"
            )
            await updater.complete()
            return

        # --- Extract metadata (session_id, user_id passed by orchestrator) ---
        metadata = _extract_metadata(context)
        session_id = metadata.get("session_id", str(uuid.uuid4()))
        user_id = metadata.get("user_id", "default_user")

        logger.info(f"[ClaudeCodeExecutor] session={session_id}, user={user_id}")
        logger.info(f"[ClaudeCodeExecutor] task={task_text[:200]}")

        # --- Per-session workspace directory ---
        workspace = Path(WORKSPACE_BASE) / user_id / session_id
        workspace.mkdir(parents=True, exist_ok=True)

        # --- Session management ---
        sdk_key = f"{user_id}-{session_id}"
        reset_session = metadata.get("reset_session", False)
        compact_session = metadata.get("compact_session", False)

        if reset_session:
            # Clear in-memory session and wipe S3 conversation data (keep workspace files)
            _sdk_sessions.pop(sdk_key, None)
            _clear_session_history(user_id, session_id)
            sdk_session_id = None
            logger.info(f"[ClaudeCodeExecutor] Session reset — starting fresh")
        else:
            sdk_session_id = _sdk_sessions.get(sdk_key)
            if not sdk_session_id:
                # Not in memory — container may have restarted; try to restore from S3
                sdk_session_id = restore_session(user_id, session_id, workspace)
                if sdk_session_id:
                    _sdk_sessions[sdk_key] = sdk_session_id
                    logger.info(f"[ClaudeCodeExecutor] Session restored from S3: {sdk_session_id}")
                else:
                    logger.info(f"[ClaudeCodeExecutor] Starting new SDK session")
            else:
                logger.info(f"[ClaudeCodeExecutor] Resuming SDK session (in-memory): {sdk_session_id}")

        # --- Ensure CLAUDE.md exists in workspace (project memory for Claude Code CLI) ---
        ensure_claude_md(workspace)

        # --- Download user-uploaded S3 files into workspace ---
        s3_files = metadata.get("s3_files", [])
        file_descriptions = download_s3_files(s3_files, workspace)
        task_text = build_task_with_files(task_text, file_descriptions)

        await updater.submit()

        step_counter = 0
        todo_counter = 0
        final_result = None
        files_changed: set = set()   # paths written/edited during this task
        last_todos: list = []        # most recent TodoWrite state

        # --- Compact conversation history before running the task (if requested) ---
        # Sends /compact as a standalone prompt — the SDK summarises prior turns
        # into a fresh context while preserving the session_id for resume.
        if compact_session and sdk_session_id:
            logger.info(f"[ClaudeCodeExecutor] Compacting conversation history…")
            try:
                compact_options = ClaudeAgentOptions(
                    allowed_tools=ALLOWED_TOOLS,
                    resume=sdk_session_id,
                    permission_mode="bypassPermissions",
                    cwd=str(workspace),
                    system_prompt={"type": "preset", "preset": "claude_code"},
                    setting_sources=["project"],
                    max_turns=1,
                )
                async for msg in query(prompt="/compact", options=compact_options):
                    # Keep sdk_session_id up-to-date after compaction
                    if hasattr(msg, "subtype") and msg.subtype == "init":
                        new_sid = getattr(msg, "session_id", None)
                        if new_sid:
                            sdk_session_id = new_sid
                            _sdk_sessions[sdk_key] = new_sid
                logger.info(f"[ClaudeCodeExecutor] Compaction done — session: {sdk_session_id}")
            except Exception as e:
                # Compaction failure is non-fatal; proceed with the original session
                logger.warning(f"[ClaudeCodeExecutor] Compaction failed (proceeding anyway): {e}")

        try:
            options = ClaudeAgentOptions(
                allowed_tools=ALLOWED_TOOLS,
                resume=sdk_session_id,        # None on first call → new session
                permission_mode="bypassPermissions",  # No interactive prompts in server mode
                cwd=str(workspace),
                system_prompt={"type": "preset", "preset": "claude_code"},
                setting_sources=["project"],  # Auto-loads CLAUDE.md from workspace
            )

            async for message in query(prompt=task_text, options=options):

                # Capture SDK session_id from init event (for future resume)
                if hasattr(message, "subtype") and message.subtype == "init":
                    new_sid = getattr(message, "session_id", None)
                    if new_sid and new_sid != sdk_session_id:
                        _sdk_sessions[sdk_key] = new_sid
                        logger.info(f"[ClaudeCodeExecutor] SDK session stored: {new_sid}")

                # Stream tool use as intermediate progress artifact
                elif hasattr(message, "type") and message.type == "assistant":
                    msg_content = getattr(message, "message", {})
                    if isinstance(msg_content, dict):
                        for block in msg_content.get("content", []):
                            if isinstance(block, dict) and block.get("type") == "tool_use":
                                tool_name = block.get("name", "")

                                if tool_name == "TodoWrite":
                                    # Emit current todo state as a streaming artifact.
                                    # Each call replaces the full list — receiver takes the latest.
                                    todo_counter += 1
                                    todos = block.get("input", {}).get("todos", [])
                                    last_todos = todos
                                    await updater.add_artifact(
                                        [Part(root=TextPart(text=json.dumps(todos)))],
                                        name=f"code_todos_{todo_counter}"
                                    )
                                    done = sum(1 for t in todos if t.get("status") == "completed")
                                    logger.info(f"[ClaudeCodeExecutor] Todos: {done}/{len(todos)} completed")
                                else:
                                    # Track files modified by Write / Edit
                                    if tool_name in ("Write", "Edit"):
                                        fp = block.get("input", {}).get("file_path", "")
                                        if fp:
                                            files_changed.add(fp)

                                    step_counter += 1
                                    step_text = _format_tool_step(step_counter, block)
                                    await updater.add_artifact(
                                        [Part(root=TextPart(text=step_text))],
                                        name=f"code_step_{step_counter}"
                                    )
                                    logger.info(f"[ClaudeCodeExecutor] {step_text}")

                # Capture final result
                elif hasattr(message, "result"):
                    final_result = message.result
                    logger.info(f"[ClaudeCodeExecutor] Done: {str(final_result)}")

        except Exception as e:
            logger.exception("[ClaudeCodeExecutor] Execution error")
            await updater.add_artifact(
                [Part(root=TextPart(text=f"Error: {str(e)}"))],
                name="error"
            )
            await updater.failed()
            return

        # Emit final result as a structured JSON payload.
        # - summary: the agent's text response (used by the orchestrator LLM)
        # - files_changed: paths written/edited during this task
        # - todos: final TodoWrite state (empty list if agent didn't use todos)
        # - steps: total tool-use steps executed
        result_payload = {
            "status": "completed",
            "summary": str(final_result) if final_result else "",
            "files_changed": sorted(files_changed),
            "todos": last_todos,
            "steps": step_counter,
        }
        await updater.add_artifact(
            [Part(root=TextPart(text=json.dumps(result_payload, ensure_ascii=False)))],
            name="code_result"
        )

        # --- Sync workspace + Claude session to S3 for cold-start recovery ---
        sync_session(user_id, session_id, workspace, _sdk_sessions.get(sdk_key))

        await updater.complete()

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise NotImplementedError("Cancel not supported")


# ============================================================
# Helpers
# ============================================================

def _extract_text(context: RequestContext) -> str:
    """Extract plain text from the A2A message parts."""
    if not (context.message and hasattr(context.message, "parts")):
        return ""
    text = ""
    for part in context.message.parts:
        if hasattr(part, "root") and hasattr(part.root, "text"):
            text += part.root.text
        elif hasattr(part, "text"):
            text += part.text
    return text.strip()


def _extract_metadata(context: RequestContext) -> dict:
    """Extract metadata dict from MessageSendParams or Message."""
    metadata = context.metadata or {}
    if not metadata and context.message and hasattr(context.message, "metadata"):
        metadata = context.message.metadata or {}
    return metadata


def _format_tool_step(step: int, block: dict) -> str:
    """Format a tool_use block into a human-readable progress string."""
    tool_name = block.get("name", "")
    tool_input = block.get("input", {})
    status = TOOL_STATUS_MAP.get(tool_name, f"Running {tool_name}")

    context_info = ""
    if isinstance(tool_input, dict):
        for key in ["file_path", "path", "command", "query", "pattern"]:
            if key in tool_input:
                val = str(tool_input[key])[:80]
                context_info = f": {val}"
                break

    return f"⚙️ {status}{context_info}"


# ============================================================
# App Factory
# ============================================================

AGENT_SKILLS = [
    AgentSkill(
        id="execute_coding_task",
        name="Execute Coding Task",
        description=(
            "Autonomously implement features, fix bugs, refactor code, and run tests "
            "using Claude Agent SDK tools (Read, Write, Edit, Bash, Glob, Grep). "
            "Maintains session context across multiple calls for iterative workflows."
        ),
        inputModes=["text/plain"],
        outputModes=["text/plain"],
        tags=["coding", "development", "automation", "debugging"],
        examples=[
            "Add input validation to src/auth.py and write unit tests",
            "Fix the failing tests in tests/test_api.py",
            "Refactor the database module to use async/await",
            "Implement a REST endpoint for user profile updates",
        ]
    ),
]


def create_app() -> FastAPI:
    """Create FastAPI application with A2A server."""
    runtime_url = os.environ.get("AGENTCORE_RUNTIME_URL", f"http://127.0.0.1:{PORT}/")

    app = FastAPI(
        title="Code Agent A2A Server",
        description="Autonomous coding agent powered by Claude Agent SDK.",
        version="1.0.0"
    )

    agent_card = AgentCard(
        name="Code Agent",
        description=(
            "Autonomous coding agent. "
            "Implements features, fixes bugs, refactors code, and runs tests "
            "with full file system access."
        ),
        url=runtime_url,
        version="1.0.0",
        capabilities=AgentCapabilities(streaming=True),
        defaultInputModes=["text/plain"],
        defaultOutputModes=["text/plain"],
        skills=AGENT_SKILLS,
    )

    task_store = InMemoryTaskStore()
    request_handler = DefaultRequestHandler(
        agent_executor=ClaudeCodeExecutor(),
        task_store=task_store,
    )

    a2a_starlette_app = A2AStarletteApplication(
        agent_card=agent_card,
        http_handler=request_handler,
    )

    @app.get("/ping")
    def ping():
        return {
            "status": "healthy",
            "agent": "Code Agent",
            "version": "1.0.0",
            "skills": ["execute_coding_task"],
        }

    app.mount("/", a2a_starlette_app.build())
    logger.info(f"Code Agent A2A Server configured at {runtime_url}")
    return app


app = create_app()

if __name__ == "__main__":
    logger.info(f"Starting Code Agent on port {PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
