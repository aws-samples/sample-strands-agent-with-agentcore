# Keenable Search

Optional web search through the Keenable Search API. This skill is off until the Keenable gateway tool is deployed (`enable_keenable = true`). It does not replace Google Search or Tavily.

## When to use

Use `keenable_search` when the user wants current web sources and this tool is available.

## Tool: keenable_search

Input:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | yes | Search query |
| num_results | integer | no | Number of results (1-10, default 5) |

Output: a JSON list of `title`, `url`, and `snippet`.

No API key is required. An optional `KEENABLE_API_KEY` (environment or Secrets Manager) uses the keyed endpoint and raises the public hourly cap.

## Citation Format

When presenting information from search results, wrap every specific claim in `<cite>` tags:

```
<cite source="SOURCE_TITLE" url="URL">claim text</cite>
```
