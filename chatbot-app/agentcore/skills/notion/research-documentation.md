# Research & Documentation

Search across Notion, synthesize findings from multiple pages, and create structured research reports.

## Workflow

### 1. Search for relevant content

Cast a wide net first, then narrow:

```
notion_search(query="<broad topic>")
notion_search(query="<specific aspect>", filter_type="page")
notion_search(filter_type="database")  → find relevant databases
```

Review results for:
- Most recently edited pages (often most current)
- Pages whose titles closely match the research topic
- Databases that may contain structured data

### 2. Fetch and analyze pages

For each relevant page:

```
notion_fetch(page_id="<page-id>")
```

Note:
- Key findings and data points
- Timestamps (to assess recency)
- Gaps or conflicting information

### 3. Synthesize findings

Analyze collected information:
- Identify key themes and patterns
- Connect related concepts across sources
- Note gaps or conflicting data
- Organize findings logically

### 4. Create structured documentation

Choose the format based on scope:

**Quick Brief** (1-2 pages, fast turnaround):
```
notion_create_page(
  parent_type="page",
  parent_id="<research-folder-id>",
  title="Brief: <Topic>",
  content_markdown="""
## Summary

2-3 sentence overview.

## Key Findings

- Finding 1
- Finding 2
- Finding 3

## Sources

- [Page 1 Title](<url>)
- [Page 2 Title](<url>)

## Next Steps

- Action item 1
"""
)
```

**Research Summary** (3-5 pages, full analysis):
```
notion_create_page(
  title="Research: <Topic>",
  content_markdown="""
## Executive Summary

Key findings in 3-5 bullets.

## Background

Context and scope of research.

## Findings

### Theme 1
...

### Theme 2
...

## Analysis

Synthesis, patterns, gaps identified.

## Recommendations

1. Recommendation 1
2. Recommendation 2

## Sources

- [Source 1](<url>) — what was found
- [Source 2](<url>) — what was found

## Appendix

Raw data, additional notes.
"""
)
```

**Comparison Report** (for evaluating options):
```
## Options Compared

| Criterion | Option A | Option B | Option C |
|-----------|----------|----------|----------|
| Cost | ... | ... | ... |
| Complexity | ... | ... | ... |

## Analysis

### Option A: Pros and Cons
...

## Recommendation

**Recommended: Option B** because...
```

## Search Strategies

| Goal | Strategy |
|------|----------|
| Find recent work | Broad search, check `last_edited_time` |
| Find all related pages | Multiple keyword variations |
| Find structured data | `notion_search(filter_type="database")` + `notion_query_database` |
| Verify a fact | Fetch 2+ sources and cross-reference |

## Citation Format

When referencing Notion pages in documentation:
```
> Source: [Page Title](<notion-url>) — last edited: <date>
```

## Tips

- **Verify recency** — always check `last_edited_time` before citing
- **Cross-reference** — validate key findings across 2+ sources
- **Note gaps** — if information is missing or outdated, say so explicitly
- **Cite sources** — always link back to source pages in the report
- **Separate facts from synthesis** — label what came from Notion vs. your analysis

## Common Issues

- **No results found**: Try broader search terms or different keyword combinations
- **Too many results**: Add `filter_type="page"`, search for more specific terms, or query specific databases
- **Conflicting information**: Note the conflict explicitly and include both sources with dates
