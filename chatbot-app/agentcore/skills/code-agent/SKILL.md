---
name: code-agent
description: Autonomous coding agent. Delegate any task that involves understanding, writing, or running code — from a GitHub issue, a bug report, or a user request. It explores, implements, and verifies on its own.
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
| **File persistence** | All files auto-synced to S3, accessible via workspace tools | Only when `output_filename` is set |
| **Session state** | Files + conversation persist across sessions | Variables persist within session only |
| **Autonomy** | Plans, writes, runs, and iterates independently | You write the code it executes |
| **Use when** | You need an engineer to solve a problem end-to-end | You need to run a specific piece of code |

## Execution Environment

The code agent runs in an **isolated container** dedicated solely to this session. Its filesystem, running processes, and local ports are completely separate from your own environment — do not attempt to access its paths or local servers via browser or other tools.

Trust the code agent's reasoning and autonomy — delegate not just implementation but also testing, verification, and iteration. Only step in when there's a genuine constraint the agent cannot resolve on its own; in that case, surface it to the user and decide together.

## Your Role as Orchestrator

You give direction and verify results. The agent explores, implements, and checks in when it hits a genuine decision point.

**Don't front-load everything. Don't over-specify. Trust the agent to work.**

### What you uniquely contribute

The code agent can read the entire workspace. What it can't do is reach outside it. That's where you add value.

Your job is to bring in what the agent can't get on its own:
- **User intent** — clarify ambiguous requirements, relay tradeoff decisions, confirm priorities
- **External context** — API docs, library changelogs, web search results, findings from other skills
- **Cross-session continuity** — context from earlier conversations that isn't in the workspace

What you should NOT be doing:
- Fully tracing a bug through the codebase to hand the agent a ready-made solution
- Pre-mapping which files need to change before delegating
- Doing the investigation that the agent should do

Reading a file to spot-check the agent's output is fine. Spending time reading 10 files to diagnose a problem yourself — then handing the agent a pre-solved task — is not. That's the agent's job.

### Division of responsibility

| You (orchestrator) provide | Code agent discovers on its own |
|---|---|
| **What** the user wants — goals, constraints, preferences | **How** to implement — codebase structure, existing patterns, design decisions |
| External context the agent can't reach — API docs, user requirements, npm/registry info | Internal context from the workspace — file layout, dependencies, coding conventions |
| Resolved decisions — framework choice, scope boundaries | Implementation decisions — variable naming, module structure, error strategies |

When the code agent encounters a **requirements-level question** it can't resolve from the codebase alone (e.g., "should this be public or internal?", "which auth provider?"), it will surface it. That's the right behavior — resolve it and pass the answer back. Don't try to pre-answer every possible question; let the agent ask when it genuinely needs direction.

---

## Orchestration Process

→ [DESIGN.md](DESIGN.md) — requirements capture, scope decisions, trade-off escalation
→ [IMPLEMENT.md](IMPLEMENT.md) — stepwise delegation, steering, correctness verification
→ [REVIEW.md](REVIEW.md) — iterative review, complexity-based depth, known issue checklist

---

## Session Management

- **`compact_session=True`** — before a new task in a long session. Summarizes history, saves tokens, preserves context.
- **`reset_session=True`** — only when switching to a completely unrelated project. Clears history, keeps workspace files.
- Omit both for continuation of the same task.

### Context isolation between tasks

A long conversation that handles multiple unrelated tasks is a liability — earlier context bleeds into later tasks and causes subtle wrong assumptions. When switching to a significantly different task (e.g., bug fix → new feature, frontend → backend), use `compact_session=True` to summarize and reset context. This is especially important when the nature of the work changes, not just the file being edited.

---

## When to Delegate vs Handle Directly

| Delegate to code_agent | Handle directly |
|---|---|
| Implement from a GitHub issue or feature request | Explain how an algorithm works |
| Investigate code to figure out an implementation approach | Write a short standalone snippet |
| Fix a failing test or bug | Answer a syntax or API question |
| Refactor a module | Simple code review without changes |
| Analyze uploaded source files | Generate a one-off script with no files |
| Run tests and fix failures | Summarize what code does |
| Scaffold following project conventions | |

---

## Uploaded Files

Files uploaded by the user are automatically available in the workspace:

```
task = "Unzip the uploaded my-project.zip and summarize the architecture."
```

---

## Advanced: Structured Task Template

Only use this when requirements are already fully resolved and you need explicit acceptance criteria. For most tasks, a plain description works better.

```xml
<task>
  <objective>Verifiable "done" state.</objective>
  <scope>What area of the system to work within. What to leave alone.</scope>
  <context>API signatures, versions, prior research findings.</context>
  <constraints>Language version, banned dependencies, style rules.</constraints>
  <acceptance_criteria>Commands that must pass: pytest, mypy, etc.</acceptance_criteria>
</task>
```
