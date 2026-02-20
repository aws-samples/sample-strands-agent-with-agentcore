"""
GitHub Tools for MCP Server

Provides GitHub tools with per-user OAuth authentication.
These tools are registered to a shared FastMCP instance.

Tools (read):
- github_search_repos: Search repositories
- github_get_repo: Get repository details
- github_list_issues: List issues in a repository
- github_get_issue: Get a single issue
- github_list_pulls: List pull requests in a repository
- github_get_pull: Get a single pull request
- github_get_file: Get file contents from a repository
- github_search_code: Search code across repositories

Tools (write):
- github_create_branch: Create a new branch
- github_push_files: Create or update files on a branch
- github_create_pull_request: Open a pull request
"""
import base64
import json
import logging
from typing import Dict, List, Optional, Tuple

from mcp.server.fastmcp import Context
from agentcore_oauth import OAuthHelper, get_token_with_elicitation

logger = logging.getLogger(__name__)

# GitHub API configuration
GITHUB_API_BASE = "https://api.github.com"

# OAuth helper for GitHub
_github_oauth = OAuthHelper(
    provider_name="github-oauth-provider",
    scopes=["repo", "read:org"],
)


# ── GitHub API Caller ─────────────────────────────────────────────────

# Shared HTTP client for connection pooling
try:
    import httpx
    _http_client: Optional[httpx.AsyncClient] = None

    async def _get_http_client() -> httpx.AsyncClient:
        """Get or create shared HTTP client for connection reuse."""
        global _http_client
        if _http_client is None or _http_client.is_closed:
            _http_client = httpx.AsyncClient(timeout=30.0)
        return _http_client

    def _get_headers(access_token: str) -> Dict[str, str]:
        """Get standard GitHub API headers."""
        return {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def call_github_api_get(
        access_token: str, endpoint: str, params: Optional[Dict] = None
    ) -> Dict:
        """GitHub REST API GET caller."""
        url = f"{GITHUB_API_BASE}/{endpoint}"
        headers = _get_headers(access_token)
        client = await _get_http_client()
        response = await client.get(url, headers=headers, params=params)
        response.raise_for_status()
        return response.json()

    async def call_github_api_post(
        access_token: str, endpoint: str, data: Optional[Dict] = None
    ) -> Dict:
        """GitHub REST API POST caller."""
        url = f"{GITHUB_API_BASE}/{endpoint}"
        headers = _get_headers(access_token)
        client = await _get_http_client()
        response = await client.post(url, headers=headers, json=data or {})
        response.raise_for_status()
        return response.json()

    async def call_github_api_put(
        access_token: str, endpoint: str, data: Optional[Dict] = None
    ) -> Dict:
        """GitHub REST API PUT caller."""
        url = f"{GITHUB_API_BASE}/{endpoint}"
        headers = _get_headers(access_token)
        client = await _get_http_client()
        response = await client.put(url, headers=headers, json=data or {})
        response.raise_for_status()
        return response.json()

except ImportError:
    pass


# ── Helper Functions ─────────────────────────────────────────────────


def _parse_repo(repo: str) -> Tuple[str, str]:
    """Parse 'owner/repo' string into (owner, repo_name).

    Args:
        repo: Repository in "owner/repo" format.

    Returns:
        Tuple of (owner, repo_name).

    Raises:
        ValueError: If format is invalid.
    """
    parts = repo.split("/", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError(
            f"Invalid repo format: '{repo}'. Expected 'owner/repo' "
            f"(e.g. 'aws-samples/sample-strands-agent-with-agentcore')."
        )
    return parts[0], parts[1]


# ── Tool Registration ───────────────────────────────────────────────────


def register_github_tools(mcp):
    """Register GitHub tools to a FastMCP instance.

    Tools registered:
    - github_search_repos
    - github_get_repo
    - github_list_issues
    - github_get_issue
    - github_list_pulls
    - github_get_pull
    - github_get_file
    - github_search_code
    - github_create_branch
    - github_push_files
    - github_create_pull_request
    """

    @mcp.tool()
    async def github_search_repos(
        query: str,
        page_size: int = 10,
        ctx: Context = None,
    ) -> str:
        """Search GitHub repositories.

        Args:
            query: Search query (GitHub search syntax supported,
                   e.g. "strands agent language:python").
            page_size: Number of results (1-100, default 10).
        """
        page_size = max(1, min(100, page_size))

        try:
            access_token = await get_token_with_elicitation(ctx, _github_oauth, "GitHub")
            if access_token is None:
                return "Authorization was declined by the user."

            data = await call_github_api_get(
                access_token, "search/repositories",
                params={"q": query, "per_page": page_size},
            )

            results = []
            for repo in data.get("items", []):
                results.append({
                    "full_name": repo.get("full_name"),
                    "description": repo.get("description"),
                    "html_url": repo.get("html_url"),
                    "language": repo.get("language"),
                    "stargazers_count": repo.get("stargazers_count"),
                    "updated_at": repo.get("updated_at"),
                    "topics": repo.get("topics", []),
                })

            return json.dumps({
                "total_count": data.get("total_count", 0),
                "results": results,
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error searching repos: {e}")
            return f"Error searching repositories: {str(e)}"

    @mcp.tool()
    async def github_get_repo(
        repo: str,
        ctx: Context = None,
    ) -> str:
        """Get details of a GitHub repository.

        Args:
            repo: Repository in "owner/repo" format
                  (e.g. "aws-samples/sample-strands-agent-with-agentcore").
        """
        try:
            owner, repo_name = _parse_repo(repo)
        except ValueError as e:
            return str(e)

        try:
            access_token = await get_token_with_elicitation(ctx, _github_oauth, "GitHub")
            if access_token is None:
                return "Authorization was declined by the user."

            data = await call_github_api_get(
                access_token, f"repos/{owner}/{repo_name}",
            )

            result = {
                "full_name": data.get("full_name"),
                "description": data.get("description"),
                "html_url": data.get("html_url"),
                "language": data.get("language"),
                "default_branch": data.get("default_branch"),
                "stargazers_count": data.get("stargazers_count"),
                "forks_count": data.get("forks_count"),
                "open_issues_count": data.get("open_issues_count"),
                "topics": data.get("topics", []),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
                "license": data.get("license", {}).get("spdx_id") if data.get("license") else None,
                "visibility": data.get("visibility"),
            }

            return json.dumps(result, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error getting repo: {e}")
            return f"Error getting repository: {str(e)}"

    @mcp.tool()
    async def github_list_issues(
        repo: str,
        state: str = "open",
        labels: Optional[str] = None,
        page_size: int = 20,
        ctx: Context = None,
    ) -> str:
        """List issues in a GitHub repository.

        Args:
            repo: Repository in "owner/repo" format.
            state: Filter by state: "open", "closed", or "all" (default "open").
            labels: Comma-separated list of label names to filter by. Optional.
            page_size: Number of results (1-100, default 20).
        """
        try:
            owner, repo_name = _parse_repo(repo)
        except ValueError as e:
            return str(e)

        page_size = max(1, min(100, page_size))

        try:
            access_token = await get_token_with_elicitation(ctx, _github_oauth, "GitHub")
            if access_token is None:
                return "Authorization was declined by the user."

            params = {"state": state, "per_page": page_size}
            if labels:
                params["labels"] = labels

            data = await call_github_api_get(
                access_token, f"repos/{owner}/{repo_name}/issues",
                params=params,
            )

            results = []
            for issue in data:
                # Skip pull requests (GitHub API returns PRs in issues endpoint)
                if issue.get("pull_request"):
                    continue
                results.append({
                    "number": issue.get("number"),
                    "title": issue.get("title"),
                    "state": issue.get("state"),
                    "html_url": issue.get("html_url"),
                    "user": issue.get("user", {}).get("login"),
                    "labels": [l.get("name") for l in issue.get("labels", [])],
                    "created_at": issue.get("created_at"),
                    "updated_at": issue.get("updated_at"),
                    "comments": issue.get("comments"),
                })

            return json.dumps({
                "total_count": len(results),
                "issues": results,
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error listing issues: {e}")
            return f"Error listing issues: {str(e)}"

    @mcp.tool()
    async def github_get_issue(
        repo: str,
        number: int,
        ctx: Context = None,
    ) -> str:
        """Get a single issue from a GitHub repository, including its body.

        Args:
            repo: Repository in "owner/repo" format.
            number: Issue number.
        """
        try:
            owner, repo_name = _parse_repo(repo)
        except ValueError as e:
            return str(e)

        try:
            access_token = await get_token_with_elicitation(ctx, _github_oauth, "GitHub")
            if access_token is None:
                return "Authorization was declined by the user."

            data = await call_github_api_get(
                access_token, f"repos/{owner}/{repo_name}/issues/{number}",
            )

            result = {
                "number": data.get("number"),
                "title": data.get("title"),
                "state": data.get("state"),
                "html_url": data.get("html_url"),
                "user": data.get("user", {}).get("login"),
                "labels": [l.get("name") for l in data.get("labels", [])],
                "assignees": [a.get("login") for a in data.get("assignees", [])],
                "milestone": data.get("milestone", {}).get("title") if data.get("milestone") else None,
                "body": data.get("body"),
                "comments": data.get("comments"),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
                "closed_at": data.get("closed_at"),
            }

            return json.dumps(result, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error getting issue: {e}")
            return f"Error getting issue: {str(e)}"

    @mcp.tool()
    async def github_list_pulls(
        repo: str,
        state: str = "open",
        page_size: int = 20,
        ctx: Context = None,
    ) -> str:
        """List pull requests in a GitHub repository.

        Args:
            repo: Repository in "owner/repo" format.
            state: Filter by state: "open", "closed", or "all" (default "open").
            page_size: Number of results (1-100, default 20).
        """
        try:
            owner, repo_name = _parse_repo(repo)
        except ValueError as e:
            return str(e)

        page_size = max(1, min(100, page_size))

        try:
            access_token = await get_token_with_elicitation(ctx, _github_oauth, "GitHub")
            if access_token is None:
                return "Authorization was declined by the user."

            data = await call_github_api_get(
                access_token, f"repos/{owner}/{repo_name}/pulls",
                params={"state": state, "per_page": page_size},
            )

            results = []
            for pr in data:
                results.append({
                    "number": pr.get("number"),
                    "title": pr.get("title"),
                    "state": pr.get("state"),
                    "html_url": pr.get("html_url"),
                    "user": pr.get("user", {}).get("login"),
                    "head": pr.get("head", {}).get("ref"),
                    "base": pr.get("base", {}).get("ref"),
                    "draft": pr.get("draft"),
                    "created_at": pr.get("created_at"),
                    "updated_at": pr.get("updated_at"),
                    "merged_at": pr.get("merged_at"),
                })

            return json.dumps({
                "total_count": len(results),
                "pull_requests": results,
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error listing pull requests: {e}")
            return f"Error listing pull requests: {str(e)}"

    @mcp.tool()
    async def github_get_pull(
        repo: str,
        number: int,
        ctx: Context = None,
    ) -> str:
        """Get a single pull request from a GitHub repository, including its body and merge details.

        Args:
            repo: Repository in "owner/repo" format.
            number: Pull request number.
        """
        try:
            owner, repo_name = _parse_repo(repo)
        except ValueError as e:
            return str(e)

        try:
            access_token = await get_token_with_elicitation(ctx, _github_oauth, "GitHub")
            if access_token is None:
                return "Authorization was declined by the user."

            data = await call_github_api_get(
                access_token, f"repos/{owner}/{repo_name}/pulls/{number}",
            )

            result = {
                "number": data.get("number"),
                "title": data.get("title"),
                "state": data.get("state"),
                "html_url": data.get("html_url"),
                "user": data.get("user", {}).get("login"),
                "head": data.get("head", {}).get("ref"),
                "base": data.get("base", {}).get("ref"),
                "draft": data.get("draft"),
                "mergeable": data.get("mergeable"),
                "merged": data.get("merged"),
                "body": data.get("body"),
                "labels": [l.get("name") for l in data.get("labels", [])],
                "assignees": [a.get("login") for a in data.get("assignees", [])],
                "requested_reviewers": [r.get("login") for r in data.get("requested_reviewers", [])],
                "additions": data.get("additions"),
                "deletions": data.get("deletions"),
                "changed_files": data.get("changed_files"),
                "commits": data.get("commits"),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
                "merged_at": data.get("merged_at"),
                "closed_at": data.get("closed_at"),
            }

            return json.dumps(result, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error getting pull request: {e}")
            return f"Error getting pull request: {str(e)}"

    @mcp.tool()
    async def github_get_file(
        repo: str,
        path: str,
        ref: Optional[str] = None,
        ctx: Context = None,
    ) -> str:
        """Get file contents from a GitHub repository.

        Returns the decoded text content for files, or a listing for directories.

        Args:
            repo: Repository in "owner/repo" format.
            path: File path within the repository (e.g. "src/main.py" or "README.md").
            ref: Branch, tag, or commit SHA. Defaults to the repo's default branch. Optional.
        """
        try:
            owner, repo_name = _parse_repo(repo)
        except ValueError as e:
            return str(e)

        try:
            access_token = await get_token_with_elicitation(ctx, _github_oauth, "GitHub")
            if access_token is None:
                return "Authorization was declined by the user."

            params = {}
            if ref:
                params["ref"] = ref

            data = await call_github_api_get(
                access_token, f"repos/{owner}/{repo_name}/contents/{path}",
                params=params if params else None,
            )

            # Directory listing
            if isinstance(data, list):
                entries = []
                for item in data:
                    entries.append({
                        "name": item.get("name"),
                        "type": item.get("type"),
                        "path": item.get("path"),
                        "size": item.get("size"),
                    })
                return json.dumps({
                    "type": "directory",
                    "path": path,
                    "entries": entries,
                }, ensure_ascii=False, indent=2)

            # File content
            content = data.get("content", "")
            encoding = data.get("encoding", "")

            if encoding == "base64":
                decoded = base64.b64decode(content).decode("utf-8", errors="replace")
            else:
                decoded = content

            result = {
                "type": "file",
                "path": data.get("path"),
                "name": data.get("name"),
                "size": data.get("size"),
                "sha": data.get("sha"),
                "content": decoded,
            }

            return json.dumps(result, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error getting file: {e}")
            return f"Error getting file: {str(e)}"

    @mcp.tool()
    async def github_search_code(
        query: str,
        page_size: int = 10,
        ctx: Context = None,
    ) -> str:
        """Search code across GitHub repositories.

        Args:
            query: Search query (GitHub code search syntax supported,
                   e.g. "OAuthHelper repo:aws-samples/sample-strands-agent-with-agentcore").
            page_size: Number of results (1-100, default 10).
        """
        page_size = max(1, min(100, page_size))

        try:
            access_token = await get_token_with_elicitation(ctx, _github_oauth, "GitHub")
            if access_token is None:
                return "Authorization was declined by the user."

            data = await call_github_api_get(
                access_token, "search/code",
                params={"q": query, "per_page": page_size},
            )

            results = []
            for item in data.get("items", []):
                results.append({
                    "name": item.get("name"),
                    "path": item.get("path"),
                    "repository": item.get("repository", {}).get("full_name"),
                    "html_url": item.get("html_url"),
                    "sha": item.get("sha"),
                })

            return json.dumps({
                "total_count": data.get("total_count", 0),
                "results": results,
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error searching code: {e}")
            return f"Error searching code: {str(e)}"

    # ── Write Tools ───────────────────────────────────────────────────

    @mcp.tool()
    async def github_create_branch(
        repo: str,
        branch: str,
        from_branch: Optional[str] = None,
        ctx: Context = None,
    ) -> str:
        """Create a new branch in a GitHub repository.

        Use a clear, conventional branch name (e.g. "fix/null-check", "feat/add-retry").
        For external repos, check CONTRIBUTING.md for branch naming conventions first.

        Args:
            repo: Repository in "owner/repo" format.
            branch: Name of the new branch to create.
            from_branch: Source branch to branch from. Defaults to the repo's default branch. Optional.
        """
        try:
            owner, repo_name = _parse_repo(repo)
        except ValueError as e:
            return str(e)

        try:
            access_token = await get_token_with_elicitation(ctx, _github_oauth, "GitHub")
            if access_token is None:
                return "Authorization was declined by the user."

            # Get the SHA of the source branch
            if from_branch is None:
                repo_data = await call_github_api_get(
                    access_token, f"repos/{owner}/{repo_name}",
                )
                from_branch = repo_data.get("default_branch", "main")

            ref_data = await call_github_api_get(
                access_token, f"repos/{owner}/{repo_name}/git/ref/heads/{from_branch}",
            )
            sha = ref_data.get("object", {}).get("sha")

            # Create the new branch
            data = await call_github_api_post(
                access_token, f"repos/{owner}/{repo_name}/git/refs",
                data={"ref": f"refs/heads/{branch}", "sha": sha},
            )

            return json.dumps({
                "success": True,
                "message": f"Branch '{branch}' created from '{from_branch}'",
                "ref": data.get("ref"),
                "sha": sha,
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error creating branch: {e}")
            return f"Error creating branch: {str(e)}"

    @mcp.tool()
    async def github_push_files(
        repo: str,
        branch: str,
        files_json: str,
        message: str,
        ctx: Context = None,
    ) -> str:
        """Create or update files on a branch via the GitHub Contents API.

        Pushes each file sequentially. For existing files, the current SHA is
        fetched automatically so the update succeeds.

        Commit message guidelines:
        - Write like a human: concise, lowercase subject, imperative mood (e.g. "fix null check in parser").
        - Never include Co-Authored-By, "Generated by", or any AI/LLM attribution.
        - Match the repo's existing commit style if prior commits are available.

        Args:
            repo: Repository in "owner/repo" format.
            branch: Target branch name.
            files_json: JSON array of file objects, each with "path" and "content" keys.
                        Example: '[{"path": "src/hello.py", "content": "print(\\"hi\\")"}]'
            message: Commit message for the push.
        """
        try:
            owner, repo_name = _parse_repo(repo)
        except ValueError as e:
            return str(e)

        try:
            files = json.loads(files_json)
        except json.JSONDecodeError:
            return "Error: files_json is not valid JSON"

        if not isinstance(files, list) or not files:
            return "Error: files_json must be a non-empty JSON array"

        try:
            access_token = await get_token_with_elicitation(ctx, _github_oauth, "GitHub")
            if access_token is None:
                return "Authorization was declined by the user."

            pushed = []
            for file_entry in files:
                path = file_entry.get("path", "")
                content = file_entry.get("content", "")

                if not path:
                    continue

                # Base64-encode the content
                encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")

                body = {
                    "message": message,
                    "content": encoded,
                    "branch": branch,
                }

                # Try to get existing file SHA for updates
                try:
                    existing = await call_github_api_get(
                        access_token,
                        f"repos/{owner}/{repo_name}/contents/{path}",
                        params={"ref": branch},
                    )
                    if isinstance(existing, dict) and existing.get("sha"):
                        body["sha"] = existing["sha"]
                except Exception:
                    pass  # File doesn't exist yet, creating new

                data = await call_github_api_put(
                    access_token,
                    f"repos/{owner}/{repo_name}/contents/{path}",
                    data=body,
                )

                pushed.append({
                    "path": path,
                    "sha": data.get("content", {}).get("sha"),
                })

            return json.dumps({
                "success": True,
                "message": f"Pushed {len(pushed)} file(s) to '{branch}'",
                "commit_message": message,
                "files": pushed,
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error pushing files: {e}")
            return f"Error pushing files: {str(e)}"

    @mcp.tool()
    async def github_create_pull_request(
        repo: str,
        title: str,
        head: str,
        base: str,
        body: str = "",
        draft: bool = False,
        ctx: Context = None,
    ) -> str:
        """Create a pull request in a GitHub repository.

        PR writing guidelines:
        - Write title and body as a human developer would: short title, concise body describing what and why.
        - No emojis, no "Generated by AI" footers, no Co-Authored-By lines.
        - For external/open-source repos, read CONTRIBUTING.md (via github_get_file) first and follow its
          PR template, branch naming, and process. Create a linked issue first if the project requires it.
        - Keep the body brief: a few sentences on motivation and a short summary of changes. Avoid verbose
          bullet-point lists or section headers that look auto-generated.

        Args:
            repo: Repository in "owner/repo" format.
            title: Pull request title.
            head: The branch that contains your changes.
            base: The branch you want to merge into (e.g. "main").
            body: Pull request description (markdown). Optional.
            draft: Create as draft PR. Default False.
        """
        try:
            owner, repo_name = _parse_repo(repo)
        except ValueError as e:
            return str(e)

        try:
            access_token = await get_token_with_elicitation(ctx, _github_oauth, "GitHub")
            if access_token is None:
                return "Authorization was declined by the user."

            data = await call_github_api_post(
                access_token, f"repos/{owner}/{repo_name}/pulls",
                data={
                    "title": title,
                    "head": head,
                    "base": base,
                    "body": body,
                    "draft": draft,
                },
            )

            result = {
                "success": True,
                "number": data.get("number"),
                "title": data.get("title"),
                "html_url": data.get("html_url"),
                "state": data.get("state"),
                "head": data.get("head", {}).get("ref"),
                "base": data.get("base", {}).get("ref"),
                "draft": data.get("draft"),
            }

            return json.dumps(result, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error creating pull request: {e}")
            return f"Error creating pull request: {str(e)}"

    logger.info(
        "[GitHub] Registered 11 tools: "
        "github_search_repos, github_get_repo, github_list_issues, "
        "github_get_issue, github_list_pulls, github_get_pull, "
        "github_get_file, github_search_code, github_create_branch, "
        "github_push_files, github_create_pull_request"
    )
