---
name: wikipedia-search
description: Wikipedia article search and retrieval
available_tools:
  - wikipedia___wikipedia_search
  - wikipedia___wikipedia_get_article
---
# Wikipedia

## Available Tools

- **wikipedia___wikipedia_search(query)**: Search Wikipedia for articles.
  - `query` (string, required): Search query

- **wikipedia___wikipedia_get_article(title, summary_only)**: Get Wikipedia article content.
  - `title` (string, required): Exact article title (case-sensitive, use title from search results)
  - `summary_only` (bool, default: false): Return summary only

## Usage Guidelines
- Only English Wikipedia is supported. Translate non-English queries to English before searching.
- Search first with wikipedia_search, then get content with wikipedia_get_article.
- Article titles are case-sensitive; use the exact title from search results.
- Use summary_only=true for quick factual lookups.
