---
name: research-agent
description: Multi-source web research with structured markdown reports and chart generation. Delegate when the user asks for a written research report, literature scan, or data-backed summary that needs citations.
---

# Research Agent

Autonomous research agent that plans, searches across the web, synthesizes findings, and returns a structured markdown report with citations and (optionally) charts. Use it when the user's question requires consulting multiple sources and producing a readable artifact — not for quick factual lookups.

## When to use

- Market scans, literature reviews, competitive analyses, technology surveys
- Multi-section reports that need headings, bullet lists, and citations
- Questions where the user explicitly wants a report, briefing, or write-up
- Tasks that benefit from a chart or two derived from the researched numbers

## When NOT to use

- A single factual answer that one `wikipedia_search` or `google_web_search` call would resolve — use those tools directly
- Code-related tasks → use the `code-agent` skill
- Browser automation on a specific site → use the `browser-automation` skill

## How to invoke

Call the `research_agent` tool with a single `plan` argument. The plan is free-form prose; include:

- **Objectives** — what the user is trying to learn or decide
- **Topics** — the specific angles / subtopics to cover
- **Structure** — the section layout you want in the final report

Example:

```
research_agent(plan="""
Research Plan: AI Code Assistant Market 2026

Objectives:
- Current market size and growth trends
- Leading products and differentiators
- Enterprise adoption barriers

Topics:
1. Global market statistics and forecasts
2. Top products (Copilot, Cursor, Claude Code, etc.) and positioning
3. Pricing models and enterprise SKUs
4. Security/compliance concerns raised by buyers

Structure:
- Executive Summary (3-5 bullets)
- Market Overview
- Product Landscape
- Enterprise Adoption
- Outlook
""")
```

The agent streams `research_step` progress events as it works. The final result is a markdown report saved as a research artifact in the canvas.

## Output

- Markdown report with `#`/`##` headings, bullet lists, and inline citations
- Any charts the agent generated are embedded in the markdown
- The full report is also persisted as an `artifacts` entry so the user can open it from the canvas

## Guidelines for the orchestrator

- Don't fabricate the plan — use the user's own words and just structure them into objectives/topics/structure. If the user only gave a one-line request, expand it into 2-3 objectives but stay true to intent.
- One research_agent call per user request. Don't fan out multiple parallel calls.
- If the user asks a follow-up ("add a section on X", "dig deeper into Y"), call `research_agent` again with an updated plan — the agent itself does not have persistent memory across calls.
- After the tool returns, do NOT restate the whole report in chat. The report is already rendered as an artifact; a 1-2 sentence summary pointing the user to the canvas is enough.
