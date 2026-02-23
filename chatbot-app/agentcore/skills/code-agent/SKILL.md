---
name: code-agent
description: Use when the user needs code written, debugged, refactored, or tested. Give it a goal, not a plan — the agent explores the codebase, decides the approach, and executes. Files and conversation history persist across sessions.
---

# Code Agent

An autonomous coding agent. It doesn't just write code on demand — it thinks through problems, forms its own plan, reads the existing codebase to understand context, implements solutions iteratively, and verifies they work before finishing.

Given a goal, it will:
- Explore the workspace to understand what's already there
- Break the task into steps and track them with a todo list
- Implement, run, and iterate until the outcome is correct
- Ask only when it hits a real decision point, not for every micro-step

Brief it like you'd brief a capable engineer: describe what you want to achieve, not how to do it.

## Code Agent vs Code Interpreter

| | Code Agent | Code Interpreter |
|---|---|---|
| **Nature** | Autonomous agent (Claude Code) | Sandboxed execution environment |
| **Best for** | Multi-file projects, refactoring, test suites | Quick scripts, data analysis, prototyping |
| **File persistence** | All files auto-synced to S3, accessible via `workspace_read("code-agent/<file>")` | Only when `output_filename` is set |
| **Session state** | Files + conversation persist across sessions | Variables persist within session only |
| **Autonomy** | Plans, writes, runs, and iterates independently | You write the code it executes |
| **Use when** | You need an engineer to solve a problem end-to-end | You need to run a specific piece of code |

## Execution Environment

The code agent runs in an **isolated container** dedicated solely to this session. Its filesystem, running processes, and local ports are completely separate from your own environment — do not attempt to access its paths or local servers via browser or other tools.

Trust the code agent's reasoning and autonomy — delegate not just implementation but also testing, verification, and iteration. Only step in when there's a genuine constraint the agent cannot resolve on its own; in that case, surface it to the user and decide together.

## Your Role as Orchestrator

You give direction. The agent explores, implements, and checks in when it hits a genuine decision point.

**Don't front-load everything. Don't over-specify. Trust the agent to work.**

---

## Delegating Tasks

Pass what you know. Let the agent discover the rest.

Leaving room for the agent to make its own decisions — on design, structure, and approach — often produces richer results than pre-answering every question. Ambiguity is not a problem to solve before delegating; it's space for the agent to fill creatively.

```
# Right amount — direction and known constraints
code_agent(task="Build a Strands Agents demo app in Python. The user wants to run it locally.")

# Too much — you're doing the agent's job for it
code_agent(task="""
  Create strands_app/agent.py with:
    model = AnthropicModel(model_id="claude-sonnet-4-5")
    ...
""")
```

If you have context the agent can't discover — a library version, an API signature, a constraint the user mentioned — include it. Otherwise, let the agent read the workspace and ask.

---

## Common Mistakes

- **Over-specifying** — pre-answering questions the agent should discover or ask itself
- **Calling `code_agent` again before answering its question** — wait, get the answer, then call
- **Splitting a multi-step task into separate calls** — the agent handles multi-step work in one call
- **Delegating "explain" or "summarize"** — handle those directly without calling `code_agent`

---

## When the Agent Asks a Question

The agent surfaces questions only at real decision points — where a silent assumption would commit to a direction the user might not want.

- **Answer from what you know** — include it in the next call
- **Look it up first** — use `web-search`, `arxiv-search`, or other skills, then pass it back
- **Ask the user** — if only the user can decide, relay and wait

Don't re-describe work the agent has already done.

---

## When to Delegate vs Handle Directly

| Delegate to code_agent | Handle directly |
|---|---|
| Implement a feature in existing code | Explain how an algorithm works |
| Fix a failing test or bug | Write a short standalone snippet |
| Refactor a module | Answer a syntax or API question |
| Add validation or error handling | Simple code review without changes |
| Analyze uploaded source files | Generate a one-off script with no files |
| Run tests and fix failures | Summarize what code does |
| Scaffold following project conventions | |

---

## Session Continuity

Files and conversation history are persisted to S3 and restored automatically after container restarts.

- Do **not** re-describe context the agent already has
- Reference previous turns naturally: *"Continue from where you left off — use pytest"*

### Resetting the session

Pass `reset_session=True` when switching to a completely unrelated task. Clears conversation history; workspace files are preserved.

### Compacting the session

Pass `compact_session=True` before a new task in the same codebase when the session has grown long. Preserves context and workspace.

---

## Uploaded Files

Files uploaded by the user are automatically available in the workspace:

```
task = "Unzip the uploaded my-project.zip and summarize the architecture."
```

---

## Interpreting Results

- Summarize key outcomes: files changed, tests passed, errors resolved
- If the agent raised a question mid-task, relay it to the user before continuing
- Don't repeat the agent's output verbatim

---

## Advanced: Structured Task Template

Only use this when requirements are already fully resolved and you need explicit acceptance criteria. For most tasks, a plain description works better.

```xml
<task>
  <objective>Verifiable "done" state.</objective>
  <scope>Exact files to touch. What to leave alone.</scope>
  <context>API signatures, versions, prior research findings.</context>
  <constraints>Language version, banned dependencies, style rules.</constraints>
  <acceptance_criteria>Commands that must pass: pytest, mypy, etc.</acceptance_criteria>
</task>
```
