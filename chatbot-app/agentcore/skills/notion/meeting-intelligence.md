# Meeting Intelligence

Prepares meeting materials by gathering context from Notion, enriching with research, and creating structured meeting documents.

## Workflow

### 1. Gather context from Notion

```
notion_search(query="<meeting topic>")
```

Look for:
- Project pages related to the meeting topic
- Previous meeting notes (for recurring meetings)
- Specifications or design docs
- Recent updates or reports
- Task/issue databases

For each relevant page:
```
notion_fetch(page_id="<page-id>") → extract key info
```

Extract:
- Project status and timeline
- Recent decisions and updates
- Open questions or blockers
- Action items from previous meetings

### 2. Create an internal pre-read (for the team)

```
notion_create_page(
  parent_type="page",
  parent_id="<project-page-id>",
  title="[Topic] - Pre-Read (Internal)",
  content_markdown="""
## Meeting Overview

- **Date**: ...
- **Attendees**: ...
- **Purpose**: ...

## Background Context

What this meeting is about and why it matters.

## Current Status

Where we are now (from Notion content).

## Key Discussion Points

- Open question 1
- Decision needed: ...

## What We Need from This Meeting

- Expected outcome 1
- Decision to make: ...
"""
)
```

Audience: **Internal attendees only** — include full context and honest assessment.

### 3. Create an external agenda (for all participants)

```
notion_create_page(
  parent_type="page",
  parent_id="<project-page-id>",
  title="[Topic] - Agenda",
  content_markdown="""
## Meeting Details

- **Date**: ...
- **Attendees**: ...

## Objective

Clear meeting goal in 1-2 sentences.

## Agenda

1. Topic 1 (10 min)
2. Topic 2 (20 min)
3. Topic 3 (15 min)

## Decisions Needed

- [ ] Decision point 1
- [ ] Decision point 2

## Action Items

*(to be filled during meeting)*

## Resources

- [Pre-Read](<pre-read-url>)
- [Project Page](<project-url>)
"""
)
```

Audience: **All participants** — professional, focused, no internal-only details.

### 4. Link documents to the project

```
notion_fetch(page_id="<project-page-id>") → find the Meetings section
notion_append_blocks(
  page_id="<project-page-id>",
  content_markdown="## Recent Meetings\n\n- [Meeting Topic - Agenda](<agenda-url>)"
)
```

## Meeting Types

| Purpose | Key sections |
|---------|-------------|
| **Decision** | Options (pros/cons) → Recommendation → Decision |
| **Status Update** | Progress → Upcoming Work → Blockers |
| **Customer/External** | Objective → Agenda (timed) → Next Steps |
| **Brainstorming** | Constraints → Ideas → Priorities |
| **1:1** | Wins → Challenges → Goals → Feedback |
| **Sprint Planning** | Capacity → Backlog review → Sprint goal → Task assignments |
| **Retrospective** | What went well → What didn't → Actions |

## Post-Meeting Updates

After the meeting, update the agenda with:

```
notion_append_blocks(
  page_id="<agenda-page-id>",
  content_markdown="""
## Decisions Made

- Decision 1: ...rationale...
- Decision 2: ...rationale...

## Action Items

- [x] Owner: Task description (due: date)
- [ ] Owner: Task description (due: date)

## Key Outcomes

- Outcome 1
- Outcome 2
"""
)
```

## Tips

- **Create both documents** — internal pre-read + external agenda for important meetings
- **Distinguish sources** — label what's from Notion vs. general knowledge
- **Start with a broad search** — cast a wide net, then narrow to most relevant pages
- **Keep the pre-read concise** — 2-3 pages maximum, even with full context
- **Share early** — give internal team at least 24hr to review for important meetings
- **Separate internal/external** — never include internal-only details in the external agenda
