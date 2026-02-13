---
name: web-search
description: Search the web using DuckDuckGo for current information, news, and research topics.
---

# Web Search

## Available Tool
- **ddg_web_search(query, max_results=5)**: Search DuckDuckGo and return results with title, snippet, and link.

## Parameters
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | str | (required) | Search query string |
| `max_results` | int | 5 | Number of results (max 10) |

## Usage Guidelines
- Use specific, targeted search queries for best results
- Set max_results to 3-5 for focused searches, up to 10 for broad research
- Combine with the url-fetcher skill to read full page content from search result links
- Break complex research into multiple targeted queries rather than one broad query

## Citation Format

When presenting information from search results, wrap every specific claim in `<cite>` tags:

```
<cite source="SOURCE_TITLE" url="URL">claim text</cite>
```

**Rules:**
- Cite factual claims, statistics, quotes, and specific information from search results.
- The `source` attribute should contain the title or name of the source.
- The `url` attribute should contain the source URL when available.
- Do NOT cite your own reasoning or general knowledge.
- If search results don't contain relevant information, inform the user rather than guessing.
- Use the minimum number of citations necessary to support claims.
