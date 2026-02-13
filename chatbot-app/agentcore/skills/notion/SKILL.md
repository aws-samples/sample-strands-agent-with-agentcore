---
name: notion
description: Search, read, create, and update Notion pages and databases
---

# Notion

## Available Tools

- **notion_search(query?, filter_type?, page_size?)**: Search across all accessible Notion pages and databases.
  - `query` (string, optional, default: ""): Search text. Empty returns all accessible pages.
  - `filter_type` (string, optional): Filter by "page" or "database"
  - `page_size` (integer, optional, default: 10, max: 100): Number of results

- **notion_list_databases(page_size?)**: List all databases shared with the integration.
  - `page_size` (integer, optional, default: 10, max: 100)

- **notion_query_database(database_id, filter_json?, sorts_json?, page_size?)**: Query a database with optional filters and sorts.
  - `database_id` (string, required): Database ID
  - `filter_json` (string, optional): Filter as a **JSON string** (e.g., `'{"property": "Status", "select": {"equals": "Done"}}'`)
  - `sorts_json` (string, optional): Sorts as a **JSON string** (e.g., `'[{"property": "Created", "direction": "descending"}]'`)
  - `page_size` (integer, optional, default: 10, max: 100)

- **notion_get_page(page_id)**: Get page properties and metadata.
  - `page_id` (string, required)

- **notion_create_page(parent_type, parent_id, title, properties_json?, content_markdown?)**: Create a new page.
  - `parent_type` (string, required): "database" or "page"
  - `parent_id` (string, required): Parent database or page ID
  - `title` (string, required): Page title
  - `properties_json` (string, optional): Additional properties as a **JSON string** (e.g., `'{"Status": {"select": {"name": "In Progress"}}}'`)
  - `content_markdown` (string, optional): Initial page content in markdown. Paragraphs separated by blank lines become separate blocks.

- **notion_update_page(page_id, properties_json, archived?)**: Update page properties.
  - `page_id` (string, required)
  - `properties_json` (string, required): Properties as a **JSON string** (e.g., `'{"Status": {"select": {"name": "Done"}}}'`)
  - `archived` (boolean, optional): Set true to archive, false to unarchive

- **notion_get_block_children(block_id, page_size?)**: Get content blocks of a page.
  - `block_id` (string, required): Page or block ID
  - `page_size` (integer, optional, default: 50, max: 100)

- **notion_append_blocks(page_id, content_markdown)**: Append content blocks to a page.
  - `page_id` (string, required): Page ID to append to
  - `content_markdown` (string, required): Content as markdown. Supports: headings (# ## ###), bullets (- *), numbered lists (1.), code blocks, quotes (>)

## Common Operations

**Find pages**: `notion_search(query)` to locate pages and databases by keyword.

**Read page content** (two-step):
1. `notion_get_page(page_id)` — get properties and metadata
2. `notion_get_block_children(page_id)` — get the actual content blocks

**Add content to existing page**: `notion_append_blocks(page_id, content_markdown)` with markdown-formatted text.

**Create new page**:
- In a database: `notion_create_page(parent_type="database", parent_id="...", title="...", properties_json='{"Status": {"select": {"name": "To Do"}}}')`
- As child of a page: `notion_create_page(parent_type="page", parent_id="...", title="...")`

**Update page properties**: `notion_update_page(page_id, properties_json='{"Status": {"select": {"name": "Done"}}}')` — changes properties only, not content blocks.

**Important**: `filter_json`, `sorts_json`, and `properties_json` must be **JSON strings**, not parsed objects.

When creating pages in databases, match the database's property schema. Use `notion_query_database` first to inspect existing entries.
