---
name: github
description: Search repositories, browse code, manage issues/PRs, and create branches and pull requests via GitHub OAuth (3LO).
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

- Always read existing files with `github_get_file` before modifying them.
- Write operations require user confirmation — explain what will change before calling.
- For multi-file changes: create a branch → push all files in one `github_push_files` call → open PR.
- Use `github_search_code` with `repo:owner/name` qualifier to scope searches to a specific repository.
