---
name: tavily-search
description: AI-powered web search and content extraction
---

# Tavily AI Search

## Available Tools

- **tavily_search(query, search_depth?, topic?)**: AI-powered web search that returns relevant, summarized results.
  - `query` (string, required): Search query
  - `search_depth` (string, optional, default: "basic"): "basic" for quick lookups, "advanced" for comprehensive research
  - `topic` (string, optional, default: "general"): "general", "news", or "research"

- **tavily_extract(urls, extract_depth?)**: Extract clean, readable content from one or more web URLs.
  - `urls` (string, required): Comma-separated URLs to extract content from
  - `extract_depth` (string, optional, default: "basic"): "basic" or "advanced"

## Usage Guidelines

- Use `tavily_search` for research queries that benefit from AI-curated results.
- Set `search_depth` to "advanced" for comprehensive research, "basic" for quick lookups.
- Set `topic` to "news" for recent events, "research" for academic/technical topics.
- Use `tavily_extract` to get full page content from specific URLs found in search results.
- Tavily excels at recent information and news — prefer it for time-sensitive queries.

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
