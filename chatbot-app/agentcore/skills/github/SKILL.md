---
name: github
description: Manage GitHub issues, PRs, branches, and repositories via OAuth (3LO). For reading issues or PR details, not for deep code analysis — delegate that to code-agent.
---

# GitHub

## Available Tools

**Read**
- **github_search_repos(query, max_results?)**: Search GitHub repositories.
- **github_get_repo(owner, repo)**: Get repository details (description, stars, language, topics).
- **github_list_issues(owner, repo, state?, labels?, max_results?)**: List issues. `state`: open | closed | all.
- **github_get_issue(owner, repo, issue_number)**: Get a single issue with comments.
- **github_list_pulls(owner, repo, state?, max_results?)**: List pull requests.
- **github_get_pull(owner, repo, pull_number)**: Get a single pull request with diff summary.
- **github_get_file(owner, repo, path, ref?)**: Get file contents. `ref` defaults to default branch.
- **github_search_code(query, max_results?)**: Search code across GitHub (use `repo:owner/name` to scope).

**Write** *(requires user approval)*
- **github_create_branch(owner, repo, branch, from_branch?)**: Create a new branch.
- **github_push_files(owner, repo, branch, files, message)**: Create or update files. `files`: list of `{path, content}`.
- **github_create_pull_request(owner, repo, title, body, head, base?)**: Open a pull request.

## Usage Guidelines

- **Never perform write operations autonomously.** Only call `github_create_branch`, `github_push_files`, or `github_create_pull_request` when the user has explicitly requested or approved the action. If the user's intent is ambiguous, ask for confirmation before proceeding.
- Always read existing files with `github_get_file` before modifying them.
- Before calling any write tool, explain exactly what will change (branch name, target files, PR details) and wait for user agreement.
- For multi-file changes: create a branch → push all files in one `github_push_files` call → open PR.
- Use `github_search_code` with `repo:owner/name` qualifier to scope searches to a specific repository.
