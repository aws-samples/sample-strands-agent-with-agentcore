---
name: web-search
description: "Search the web using DuckDuckGo and optionally fetch full content from result URLs. Use this skill when you need to find information on the web, research topics, or gather content from multiple web pages. Can perform searches, fetch content from specific URLs, or combine both (search and automatically fetch content from top results). Trigger whenever the user needs web information, wants to research a topic, or needs content from URLs."
license: MIT
---

# Web Search Skill

## Quick Reference

| Task | Command |
|------|---------|
| Search the web | `python scripts/web_search.py --query "your search query"` |
| Fetch content from URL | `python scripts/web_search.py --fetch-url "https://example.com"` |
| Search and fetch content | `python scripts/web_search.py --query "your query" --fetch-content --top-n 3` |

---

## Features

### Web Search (DuckDuckGo)

Search the web for information, news, articles, and research:

```bash
python scripts/web_search.py --query "Python async programming tutorial"
```

Options:
- `--query`: Search query string
- `--max-results`: Maximum number of search results (default: 5, max: 10)

### URL Content Fetching

Fetch and extract text content from web pages:

```bash
python scripts/web_search.py --fetch-url "https://example.com/article"
```

Options:
- `--fetch-url`: URL to fetch content from
- `--include-html`: Include raw HTML in response
- `--max-length`: Maximum character length (default: 50000)

### Search + Auto-Fetch

Perform a search and automatically fetch content from top results:

```bash
python scripts/web_search.py --query "AWS Lambda best practices" --fetch-content --top-n 3
```

This will:
1. Search the web for your query
2. Fetch full content from the top N results
3. Return both search results and extracted content

Options:
- `--fetch-content`: Enable automatic content fetching
- `--top-n`: Number of top results to fetch content from (default: 3)

---

## Usage Examples

### Example 1: Research a Topic

```bash
# Find latest information
python scripts/web_search.py --query "AI developments 2025"

# Get detailed content from top 2 results
python scripts/web_search.py --query "AI developments 2025" --fetch-content --top-n 2
```

### Example 2: Company Research

```bash
# Search for company information
python scripts/web_search.py --query "Amazon company culture"

# Fetch content from specific career page
python scripts/web_search.py --fetch-url "https://www.amazon.jobs/en/landing_pages/values"
```

### Example 3: Technical Documentation

```bash
# Find documentation
python scripts/web_search.py --query "React hooks documentation"

# Fetch specific doc page
python scripts/web_search.py --fetch-url "https://react.dev/reference/react/hooks"
```

---

## Output Format

### Search Results

```json
{
  "success": true,
  "query": "search query",
  "result_count": 5,
  "results": [
    {
      "index": 1,
      "title": "Page Title",
      "snippet": "Brief description...",
      "link": "https://example.com"
    }
  ]
}
```

### Fetched Content

```json
{
  "success": true,
  "url": "https://example.com",
  "title": "Page Title",
  "content_type": "text/html",
  "text_content": "Extracted text...",
  "text_length": 5000,
  "status_code": 200
}
```

### Combined (Search + Fetch)

```json
{
  "success": true,
  "query": "search query",
  "search_results": [...],
  "fetched_content": [
    {
      "index": 1,
      "url": "https://example.com",
      "title": "Page Title",
      "text_content": "...",
      "fetch_success": true
    }
  ]
}
```

---

## Dependencies

```bash
pip install ddgs httpx beautifulsoup4
```

- `ddgs` - DuckDuckGo search
- `httpx` - Async HTTP client
- `beautifulsoup4` - HTML parsing and text extraction

---

## Error Handling

The skill handles common errors gracefully:

- Invalid URLs
- Network timeouts (30 second timeout)
- HTTP errors (404, 500, etc.)
- Rate limiting
- Missing dependencies

All errors return structured JSON with error details.

---

## Best Practices

1. **Be specific with queries**: Use detailed search terms for better results
2. **Limit results**: Use `--max-results` to control the number of search results
3. **Use fetch-content wisely**: Fetching content from many URLs can be slow
4. **Check success field**: Always check `"success": true/false` in responses
5. **Handle timeouts**: Some websites may be slow or unreachable

---

## Notes

- Uses DuckDuckGo for privacy-friendly search (no API key required)
- Respects website robots.txt and rate limits
- Extracts clean text content, removing scripts, styles, and navigation
- 30-second timeout for URL fetching
- Content is truncated to max_length to prevent excessive data
