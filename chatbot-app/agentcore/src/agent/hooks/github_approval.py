"""Hook for user approval before GitHub write operations using Strands Interrupts"""

import json
import logging
from typing import Any
from strands.hooks import HookProvider, HookRegistry, BeforeToolCallEvent
from agent.hooks.utils import resolve_tool_call

logger = logging.getLogger(__name__)

# GitHub MCP tools that modify repositories
GITHUB_WRITE_TOOLS = {
    "github_create_branch",
    "github_push_files",
    "github_create_pull_request",
}


class GitHubApprovalHook(HookProvider):
    """Request user approval via Strands Interrupts before GitHub write operations.

    Uses event.interrupt() to pause execution and wait for user confirmation
    before creating branches, pushing files, or opening pull requests.
    """

    def __init__(self, app_name: str = "chatbot"):
        self.app_name = app_name

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self.request_approval)

    def request_approval(self, event: BeforeToolCallEvent) -> None:
        """Request user approval before executing GitHub write tools"""
        tool_name, tool_input = resolve_tool_call(event)

        if tool_name not in GITHUB_WRITE_TOOLS:
            return

        if tool_name == "github_create_branch":
            repo = tool_input.get("repo", "")
            branch = tool_input.get("branch", "")
            from_branch = tool_input.get("from_branch", "default branch")

            approval = event.interrupt(
                f"{self.app_name}-github-branch-approval",
                reason={
                    "tool_name": tool_name,
                    "repo": repo,
                    "branch": branch,
                    "from_branch": from_branch,
                    "summary": f"Create branch '{branch}' from '{from_branch}' on {repo}",
                }
            )

        elif tool_name == "github_push_files":
            repo = tool_input.get("repo", "")
            branch = tool_input.get("branch", "")
            message = tool_input.get("message", "")
            files_json = tool_input.get("files_json", "[]")
            try:
                files = json.loads(files_json)
                file_paths = [f.get("path", "") for f in files]
            except (json.JSONDecodeError, TypeError):
                file_paths = []

            approval = event.interrupt(
                f"{self.app_name}-github-push-approval",
                reason={
                    "tool_name": tool_name,
                    "repo": repo,
                    "branch": branch,
                    "commit_message": message,
                    "files": file_paths,
                    "file_count": len(file_paths),
                    "summary": f"Push {len(file_paths)} file(s) to '{branch}' on {repo}: {message}",
                }
            )

        elif tool_name == "github_create_pull_request":
            repo = tool_input.get("repo", "")
            title = tool_input.get("title", "")
            head = tool_input.get("head", "")
            base = tool_input.get("base", "")
            draft = tool_input.get("draft", False)

            approval = event.interrupt(
                f"{self.app_name}-github-pr-approval",
                reason={
                    "tool_name": tool_name,
                    "repo": repo,
                    "title": title,
                    "head": head,
                    "base": base,
                    "draft": draft,
                    "summary": f"Create PR '{title}' ({head} -> {base}) on {repo}",
                }
            )

        if approval and approval.lower() in ["y", "yes", "approve", "approved"]:
            logger.debug(f"GitHub {tool_name} approved by user")
            return
        else:
            logger.info(f"GitHub {tool_name} rejected by user")
            event.cancel_tool = f"User declined {tool_name}"
