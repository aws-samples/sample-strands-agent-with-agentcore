# Knowledge Capture

Transforms conversations, discussions, and insights into structured documentation in Notion. Captures knowledge from chat context, formats it appropriately, and saves it to the right location with proper organization.

## Workflow

### 1. Extract content to capture

From the conversation context, identify:
- Key concepts and definitions
- Decisions made and rationale
- How-to information and procedures
- Important insights or learnings
- Q&A pairs

### 2. Classify content type

| Type | Structure |
|------|-----------|
| **Concept/Definition** | Overview → Definition → Characteristics → Examples → Related |
| **How-To Guide** | Overview → Prerequisites → Steps (numbered) → Verification → Troubleshooting |
| **Decision Record** | Context → Decision → Rationale → Options Considered → Consequences |
| **FAQ Entry** | Short Answer → Detailed Explanation → Examples → Related Questions |
| **Learning/Post-mortem** | What Happened → What Went Well → What Didn't → Root Causes → Actions |

### 3. Find the right destination

```
notion_search(query="wiki") → find wiki or knowledge base pages
notion_search(filter_type="database") → find documentation databases
```

Destination options:
- **General wiki page** — standalone knowledge article
- **Project wiki** — child of a project page
- **Documentation database** — structured docs with properties (Type, Category, Tags, Status)
- **Decision log database** — properties: Decision, Date, Status, Domain, Deciders
- **FAQ database** — properties: Question, Category, Tags, Last Reviewed

### 4. Create the page

```
notion_create_page(
  parent_type="page",          # or "database"
  parent_id="<wiki-page-id>",
  title="How to Deploy to Production",
  content_markdown="""
## Overview

Brief description of the topic.

## Prerequisites

- [ ] Required item 1
- [ ] Required item 2

## Steps

1. First step
2. Second step
3. Third step

## Related

- Link to related topic
"""
)
```

For database pages, include properties:
```
notion_create_page(
  parent_type="database",
  parent_id="<docs-db-id>",
  title="Decision: Switch to PostgreSQL",
  properties_json='{"Type": {"select": {"name": "Decision"}}, "Status": {"select": {"name": "Accepted"}}}',
  content_markdown="..."
)
```

### 5. Make content discoverable

After creating the page, link it from relevant hub pages:

```
notion_search(query="engineering docs index") → find the index page
notion_fetch(page_id="<index-page-id>") → read current content
notion_append_blocks(
  page_id="<index-page-id>",
  content_markdown="- [How to Deploy to Production](<new-page-url>)"
)
```

## Tips

- **Capture promptly** — document while the conversation context is fresh
- **Structure consistently** — use the templates above for similar content types
- **Search first** — check if a page already exists before creating a new one
- **Write for search** — use clear titles and common keywords
- **Add context** — include why this matters and when to use it
- **Link extensively** — connect related knowledge for easy navigation

## Common Issues

- **Not sure where to save**: Default to a general wiki page, easy to move later
- **Content is fragmentary**: Group related fragments into a cohesive document
- **Already exists**: Use `notion_fetch` to read the existing page, then `notion_append_blocks` to update it
