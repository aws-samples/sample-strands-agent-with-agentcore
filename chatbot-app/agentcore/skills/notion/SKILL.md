---
name: notion
description: Search, read, create, and update Notion pages and databases. Supports knowledge capture, meeting prep, research documentation, and spec-to-task workflows.
---

# Notion

## Available Tools

- **notion_search(query?, filter_type?, page_size?)**: Search across all accessible pages and databases.
  - `query` (string, optional): Search text. Empty string returns all accessible pages.
  - `filter_type` (string, optional): `"page"` or `"database"`. Use `"database"` to list databases.
  - `page_size` (integer, optional, default: 10, max: 100)

- **notion_fetch(page_id, include_block_ids?)**: Fetch a page's full content as readable markdown (metadata + all blocks in one call).
  - `page_id` (string, required): Page or database entry ID.
  - `include_block_ids` (boolean, optional, default: false): If true, appends each block's ID as `<!-- id:... -->`. Use this when you need to update a specific block with `notion_update_block`.
  - Returns: title, URL, last-edited time, and full body as markdown.

- **notion_create_page(parent_type, parent_id, title, properties_json?, content_markdown?)**: Create a new page.
  - `parent_type` (string, required): `"database"`, `"page"`, or `"workspace"` (workspace root)
  - `parent_id` (string, required): Parent UUID — ignored when `parent_type="workspace"`
  - `title` (string, required): Page title
  - `properties_json` (string, optional): Database properties as a **JSON string** — e.g., `'{"Status": {"select": {"name": "In Progress"}}}'`
  - `content_markdown` (string, optional): Initial body content as markdown (see Markdown Support below)

- **notion_update_page(page_id, properties_json, archived?)**: Update page properties (metadata/database fields only, not content blocks).

- **notion_update_block(block_id, content_markdown)**: Replace the content of a specific existing block.
  - `block_id` (string, required): Block ID — obtain via `notion_fetch(include_block_ids=True)`
  - `content_markdown` (string, required): New content as a single markdown line (only the first block is used)
  - `page_id` (string, required)
  - `properties_json` (string, required): Properties as a **JSON string**
  - `archived` (boolean, optional): `true` to archive, `false` to unarchive

- **notion_append_blocks(page_id, content_markdown)**: Append new content blocks to the end of an existing page.
  - `page_id` (string, required)
  - `content_markdown` (string, required): Markdown content to append (see Markdown Support below)

## Markdown Support

Both `notion_create_page` (content_markdown) and `notion_append_blocks` support:

| Syntax | Block type |
|--------|-----------|
| `# Title` / `## Heading` / `### Sub` | heading_1 / heading_2 / heading_3 |
| `- item` or `* item` | bulleted_list_item |
| `1. item` | numbered_list_item |
| `- [ ] task` | to_do (unchecked) |
| `- [x] task` | to_do (checked) |
| ` ```python\ncode\n``` ` | code block with language |
| `> text` | quote |
| `---` | divider |
| `**bold**` | bold inline |
| `*italic*` | italic inline |
| `` `code` `` | inline code |

## Common Workflows

**Find and read a page:**
```
1. notion_search(query="page name") → get page id
2. notion_fetch(page_id) → read full content
```

**Create a new page with content:**
```
notion_create_page(
  parent_type="page",
  parent_id="<parent-page-id>",
  title="My Page",
  content_markdown="## Overview\n\nContent here..."
)
```

**Add content to existing page:**
```
notion_append_blocks(
  page_id="<page-id>",
  content_markdown="## New Section\n\n- Point 1\n- Point 2"
)
```

**Edit a specific block:**
```
1. notion_fetch(page_id, include_block_ids=True)
   → ## Old Heading  <!-- id:abc-123 -->
2. notion_update_block(block_id="abc-123", content_markdown="## New Heading")
```

**List databases:**
```
notion_search(filter_type="database")
```

## Use-Case Guides

For specific workflow patterns, load the reference files:

- **knowledge-capture.md** — Save conversation insights, decisions, and how-to guides to Notion wikis and databases
- **meeting-intelligence.md** — Prepare meeting materials by gathering Notion context and creating pre-reads and agendas
- **research-documentation.md** — Research across Notion pages, synthesize findings, and write structured reports
- **spec-to-implementation.md** — Turn spec pages into implementation plans, tasks, and progress tracking

Load a reference with: `skill_dispatcher("notion", reference="knowledge-capture.md")`
