---
name: arxiv-search
description: Search and retrieve scientific papers from arXiv
available_tools:
  - arxiv___arxiv_search
  - arxiv___arxiv_get_paper
---
# arXiv Paper Search

## Available Tools

- **arxiv___arxiv_search(query)**: Search scientific papers on arXiv.
  - `query` (string, required): Search query for papers

- **arxiv___arxiv_get_paper(paper_ids)**: Get detailed paper content from arXiv.
  - `paper_ids` (string, required): Comma-separated paper IDs (e.g., "2301.12345,2302.67890")

## Usage Guidelines
- Use specific academic keywords (e.g., "transformer attention mechanism" rather than "AI").
- Search first with arxiv_search, then get details with arxiv_get_paper.
- Pass multiple paper IDs as comma-separated values for efficiency.

## Citation Format
```
<cite source="PAPER_TITLE" url="https://arxiv.org/abs/PAPER_ID">claim text</cite>
```
