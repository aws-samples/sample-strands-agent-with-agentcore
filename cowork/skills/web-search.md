---
name: web-search
description: Search the web using DuckDuckGo and fetch URL content
available_tools:
  - web-search___ddg_web_search
  - web-search___fetch_url_content
---
# Web Search

## Available Tools

- **web-search___ddg_web_search(query, max_results)**: Search DuckDuckGo for current information.
  - `query` (string, required): Search query
  - `max_results` (int, default: 5): Number of results (max 10)

- **web-search___fetch_url_content(url, include_html, max_length)**: Fetch and extract text from a URL.
  - `url` (string, required): URL to fetch
  - `include_html` (bool, default: false): Include raw HTML
  - `max_length` (int, default: 50000): Max character length

## Usage Guidelines
- Use specific, targeted queries for best results.
- Combine search + fetch: find links with ddg_web_search, read content with fetch_url_content.
- Break complex research into multiple targeted queries.
