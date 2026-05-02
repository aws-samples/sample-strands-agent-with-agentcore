---
name: web-search
description: Search the web and fetch content from URLs for current information, news, and research topics.
---

# Web Search

## Available Tools
- **ddg_web_search(query, max_results=5)**: Search DuckDuckGo and return results with title, snippet, and link.
- **fetch_url_content(url, include_html=False, max_length=50000)**: Fetch a URL and extract clean text content.

## Parameters

### ddg_web_search
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | str | (required) | Search query string |
| `max_results` | int | 5 | Number of results (max 10) |

### fetch_url_content
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | str | (required) | URL to fetch (must start with http:// or https://) |
| `include_html` | bool | False | Include raw HTML in response |
| `max_length` | int | 50000 | Maximum character length of extracted text |

## Usage Guidelines
- Use specific, targeted search queries for best results
- Set max_results to 3-5 for focused searches, up to 10 for broad research
- Use fetch_url_content to read full page content from search result links
- Break complex research into multiple targeted queries rather than one broad query
- fetch_url_content automatically strips navigation, scripts, and boilerplate HTML
- Reduce max_length for quick summaries or when you only need the beginning of a page

## Citation Format

When presenting information from search results or fetched pages, wrap every specific claim in `<cite>` tags:

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
