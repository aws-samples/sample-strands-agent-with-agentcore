---
name: tavily-search
description: AI-powered web search and content extraction
available_tools:
  - tavily___tavily_search
  - tavily___tavily_extract
---
# Tavily AI Search

## Available Tools

- **tavily___tavily_search(query, search_depth, topic)**: AI-powered web search with summarized results.
  - `query` (string, required): Search query
  - `search_depth` (string, default: "basic"): "basic" or "advanced"
  - `topic` (string, default: "general"): "general", "news", or "research"

- **tavily___tavily_extract(urls, extract_depth)**: Extract clean content from web URLs.
  - `urls` (string, required): Comma-separated URLs
  - `extract_depth` (string, default: "basic"): "basic" or "advanced"

## Usage Guidelines
- Set search_depth to "advanced" for comprehensive research, "basic" for quick lookups.
- Set topic to "news" for recent events, "research" for academic/technical topics.
- Use tavily_extract to get full page content from specific URLs found in search results.
