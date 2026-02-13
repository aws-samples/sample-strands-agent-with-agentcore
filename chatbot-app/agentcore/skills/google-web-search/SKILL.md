---
name: google-web-search
description: Google web search with integrated image results
---

# Google Web Search

## Available Tools

- **google_web_search(query, include_images?)**: Search the web using Google Custom Search. Returns results with titles, snippets, links, and optional image results.
  - `query` (string, required): Search query
  - `include_images` (boolean, optional, default: true): Include image results alongside web results

## Usage Guidelines

- Formulate clear, specific search queries for best results.
- Use quotes for exact phrase matching (e.g., `"machine learning" best practices 2025`).
- For comprehensive research, perform multiple targeted searches rather than one broad query.
- Image results are included by default. Set `include_images=false` for text-only searches.

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
