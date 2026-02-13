---
name: wikipedia-search
description: Wikipedia article search and retrieval
---

# Wikipedia

## Available Tools

- **wikipedia_search(query)**: Search Wikipedia for articles matching a query.
  - `query` (string, required): Search query

- **wikipedia_get_article(title, summary_only?)**: Get content of a Wikipedia article by exact title.
  - `title` (string, required): Article title (case-sensitive, use exact title from search results)
  - `summary_only` (boolean, optional, default: false): Return only the summary instead of full text

## Usage Guidelines

- Use `wikipedia_search` first to find the correct article title, then `wikipedia_get_article` for full content.
- Article titles are case-sensitive — use the exact title from search results.
- Use `summary_only=true` for quick factual lookups when full article content isn't needed.
- Wikipedia content is best for background information, definitions, and historical context.

## Citation Format

When presenting information from Wikipedia, wrap every specific claim in `<cite>` tags:

```
<cite source="Wikipedia: ARTICLE_TITLE" url="https://en.wikipedia.org/wiki/ARTICLE_TITLE">claim text</cite>
```

**Rules:**
- Cite factual claims, statistics, dates, and specific information from articles.
- The `source` attribute should include the article title (e.g., `"Wikipedia: Quantum Computing"`).
- The `url` attribute should contain the Wikipedia article URL.
- Do NOT cite your own reasoning or general knowledge.
- Use the minimum number of citations necessary to support claims.
