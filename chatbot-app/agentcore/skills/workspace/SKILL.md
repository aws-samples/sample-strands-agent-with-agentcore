---
name: workspace
description: Read and write files in the shared session workspace. Use this to access files created by any skill — code-agent outputs, office documents, images, and more. All within the same isolated session.
---

# Workspace

Provides unified read/write access to all files in the current session. The `userId` and `sessionId` are injected automatically — you only specify the logical path.

## Path Conventions

| Prefix | What it accesses |
|--------|-----------------|
| `code-agent/<file>` | Files created by the code agent (auto-synced) |
| `code-interpreter/<file>` | Files saved by code interpreter via `output_filename` |
| `documents/powerpoint/<file>` | PowerPoint presentations |
| `documents/word/<file>` | Word documents |
| `documents/excel/<file>` | Excel spreadsheets |
| `documents/image/<file>` | Images from other tools |

> **Note:** Code interpreter only saves to workspace when `output_filename` is set in `execute_code`. Files from `execute_command` or `file_operations` stay inside the sandbox.

## Usage

**See everything in the session:**
```
workspace_list()
workspace_list("code-agent/")
```

**Read a file the code agent created:**
```
workspace_read("code-agent/calculator.png")   # binary → base64
workspace_read("code-agent/report.md")        # text → string
```

**Pass a file from one skill to another:**
```
result = workspace_read("documents/excel/data.xlsx")   # encoding: base64
workspace_write("code-agent/data.xlsx", result["content"], encoding="base64")
```

## Notes

- Text files return `encoding: "text"` with plain string content
- Binary files (images, Office docs, PDF, etc.) return `encoding: "base64"`
- `workspace_write` accepts both encodings — use `"base64"` for binary
- Files written here are immediately available to all other skills in the session
