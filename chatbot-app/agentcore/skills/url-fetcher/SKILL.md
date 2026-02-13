---
name: url-fetcher
description: Fetch and extract text content from web page URLs.
---

# URL Fetcher

## Available Tool
- **fetch_url_content(url, include_html=False, max_length=50000)**: Fetch a URL and extract clean text content.

## Parameters
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | str | (required) | URL to fetch (must start with http:// or https://) |
| `include_html` | bool | False | Include raw HTML in response |
| `max_length` | int | 50000 | Maximum character length of extracted text |

## Usage Guidelines
- Useful for reading articles, documentation, job postings, and other web content
- Automatically strips navigation, scripts, and boilerplate HTML
- Extracts page title and clean text content
- Use include_html=True only when you need to analyze the page structure
- Reduce max_length for quick summaries or when you only need the beginning of a page

## Error Handling
- Returns error JSON if the URL is unreachable, times out (30s), or returns non-200 status
- Always check the `success` field in the response before using the content

## Citation Format

When presenting information from fetched pages, wrap every specific claim in `<cite>` tags:

```
<cite source="SOURCE_TITLE" url="URL">claim text</cite>
```

**Rules:**
- Cite factual claims, statistics, quotes, and specific information from fetched content.
- The `source` attribute should contain the page title or site name.
- The `url` attribute should contain the fetched URL.
- Do NOT cite your own reasoning or general knowledge.
- Use the minimum number of citations necessary to support claims.
