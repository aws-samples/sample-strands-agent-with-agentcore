# Spec to Implementation

Turns specification pages into concrete implementation plans with tasks and progress tracking.

## Workflow

### 1. Find the specification

```
notion_search(query="<feature name> spec")
notion_search(query="<feature name> PRD")
```

If multiple results, show options to the user. If not found, ask for the page URL.

### 2. Fetch and analyze the spec

```
notion_fetch(page_id="<spec-page-id>")
```

Parse and extract:
- **Functional requirements** — user stories, feature descriptions, workflows
- **Non-functional requirements** — performance, security, scalability
- **Acceptance criteria** — testable conditions, completion definitions
- **Dependencies** — blockers, related systems

Note ambiguities or conflicts to address in the plan.

### 3. Create an implementation plan page

```
notion_create_page(
  parent_type="page",
  parent_id="<project-page-id>",
  title="Implementation Plan: <Feature Name>",
  content_markdown="""
## Overview

Brief description of what will be built.

**Specification**: [<Spec Title>](<spec-url>)

## Requirements Summary

### Functional
- Requirement 1
- Requirement 2

### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Technical Approach

High-level description of the implementation strategy.

## Phases

### Phase 1: Foundation
- [ ] Task A
- [ ] Task B
- **Estimated effort**: ...

### Phase 2: Core Features
- [ ] Task C
- [ ] Task D
- **Estimated effort**: ...

### Phase 3: Testing & Polish
- [ ] Task E
- [ ] Task F

## Dependencies

- Dependency 1
- Dependency 2

## Risks

| Risk | Mitigation |
|------|-----------|
| Risk 1 | Mitigation 1 |

## Success Criteria

- [ ] Criterion 1
- [ ] Criterion 2
"""
)
```

### 4. Find a location for tasks

```
notion_search(query="tasks")
```

### 5. Create individual tasks

For each task in the plan:

```
notion_create_page(
  parent_type="page",
  parent_id="<tasks-page-id>",
  title="Implement: <Task Name>",
  content_markdown="""
## Description

What needs to be done and why.

**Implementation Plan**: [<Plan Title>](<plan-url>)
**Specification**: [<Spec Title>](<spec-url>)

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Technical Notes

Implementation approach, relevant code pointers, etc.
"""
)
```

### 6. Track progress

When starting a task:
```
notion_update_page(
  page_id="<task-id>",
  properties_json='{"Status": {"select": {"name": "In Progress"}}}'
)
```

Add progress notes:
```
notion_append_blocks(
  page_id="<task-id>",
  content_markdown="""
## Progress — <Date>

### Completed
- Item 1

### In Progress
- Item 2

### Blockers
- None

### Next Steps
- Next item
"""
)
```

When completing a task:
```
notion_update_page(
  page_id="<task-id>",
  properties_json='{"Status": {"select": {"name": "Done"}}}'
)
```

Update the implementation plan's checklist:
```
notion_append_blocks(
  page_id="<plan-id>",
  content_markdown="## Status Update — <Date>\n\nPhase 1 complete. Moving to Phase 2."
)
```

## Task Breakdown Patterns

| Pattern | When to use |
|---------|-------------|
| **By component** | Backend → API → Frontend → Integration → Testing |
| **By feature slice** | Vertical slices end-to-end (e.g., auth flow, checkout) |
| **By priority** | P0 (must-have) → P1 (important) → P2 (nice-to-have) |

## Linking Spec ↔ Implementation

- **Forward link**: After creating the plan, append a link to the spec page
- **Backward link**: Each task references both the spec and the plan
- Maintain both directions for full traceability

## Common Issues

- **Spec is unclear**: Note ambiguities in the plan, create a "Clarification needed" task
- **Requirements conflict**: Document both options, create a decision task
- **No tasks page found**: Ask the user where to create tasks, or create them as a sub-page of the implementation plan
- **Scope too large**: Break into separate phases or sub-specs
