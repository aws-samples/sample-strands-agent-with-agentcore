---
name: arxiv-search
description: Search and retrieve scientific papers from ArXiv
---

# ArXiv Paper Search

## Available Tools

- **arxiv_search(query)**: Search scientific papers on ArXiv by keyword, author, or topic.
  - `query` (string, required): Search query for papers

- **arxiv_get_paper(paper_ids)**: Get detailed paper content (abstract, metadata, content preview) from ArXiv.
  - `paper_ids` (string, required): Comma-separated paper IDs (e.g., "2301.12345" or "2301.12345,2302.67890")

## Usage Guidelines

- Use specific academic keywords for best search results (e.g., "transformer attention mechanism" rather than "AI").
- Paper IDs follow the format: `2301.12345` or `cs.AI/2301.12345`.
- When presenting results, include: title, authors, abstract summary, and ArXiv link.
- Use `arxiv_search` first to find relevant papers, then `arxiv_get_paper` for detailed content.
- Pass multiple paper IDs at once as comma-separated values for efficiency.

## Citation Format

When presenting information from papers, wrap every specific claim in `<cite>` tags:

```
<cite source="PAPER_TITLE" url="https://arxiv.org/abs/PAPER_ID">claim text</cite>
```

**Rules:**
- Cite findings, methods, statistics, and specific claims from papers.
- The `source` attribute should contain the paper title.
- The `url` attribute should contain the ArXiv URL (`https://arxiv.org/abs/XXXX.XXXXX`).
- Do NOT cite your own reasoning or general knowledge.
- Use the minimum number of citations necessary to support claims.
