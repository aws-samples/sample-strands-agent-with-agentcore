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

You give direction. The agent explores, implements, and checks in when it hits a genuine decision point.

**Don't front-load everything. Don't over-specify. Trust the agent to work.**

### Division of responsibility

| You (orchestrator) provide | Code agent discovers on its own |
|---|---|
| **What** the user wants — goals, constraints, preferences | **How** to implement — codebase structure, existing patterns, design decisions |
| External context the agent can't access — API docs, user requirements, research findings | Internal context from the workspace — file layout, dependencies, coding conventions |
| Resolved decisions — framework choice, scope boundaries | Implementation decisions — variable naming, module structure, error strategies |

When the code agent encounters a **requirements-level question** it can't resolve from the codebase alone (e.g., "should this be public or internal?", "which auth provider?"), it will surface it. That's the right behavior — resolve it and pass the answer back. Don't try to pre-answer every possible question; let the agent ask when it genuinely needs direction.

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
- **Delegating "explain" or "summarize"** — handle those directly without calling `code_agent`

---

## Orchestration Process

Think like an engineer using a coding assistant, not a relay that forwards messages. Follow this process for every coding request.

### Step 1. Analyze — understand what's being asked

Before calling `code_agent`, assess the request against these points:

- **What is the user actually trying to achieve?** Restate the goal in concrete terms. "Make it faster" → "Reduce API response time for the /search endpoint."
- **What context do I already have?** Prior conversation, uploaded files, known constraints. Include what the agent can't discover on its own.
- **What context am I missing?** Do a quick lookup if needed — but only for requirements-level context (API docs, issue descriptions). Don't browse source files or analyze code structure yourself. That's the code agent's job.
- **Is this a code_agent task at all?** Explanations, short snippets, and code reviews don't need delegation.

### Step 2. Decide — resolve ambiguity before delegating

If there are open questions that affect the direction of work, resolve them **before** calling `code_agent`:

- **Choices only the user can make** (which framework, which approach) → ask the user and wait.
- **Choices you can research** (latest API syntax, library compatibility) → look it up, then include findings in the task.
- **Choices the agent can make** (internal code structure, variable naming) → leave them to the agent.

Don't dump ambiguity onto the agent. Don't dump it onto the user either if you can resolve it yourself.

### Step 3. Implement — scope the delegation to match user expectations

Before each `code_agent` call, check: **does the scope of what I'm about to delegate match what the user expects to happen?**

- If the user asked for a small fix, don't delegate a full refactor.
- If the user asked for an end-to-end feature, don't delegate just the first step without telling them the plan.
- For large tasks, break into phases and tell the user what you're doing:

```
# Phase 1 — understand
code_agent(task="Explore the project structure and summarize how auth currently works.")
# → Review result, confirm approach with user if needed

# Phase 2 — implement
code_agent(task="Add JWT auth middleware using the existing Express route structure.")
# → Read key output files to verify

# Phase 3 — verify
code_agent(task="Run the test suite and fix any failures.")
```

For straightforward, well-scoped tasks, a single call is fine. Not everything needs multiple phases.

### Step 4. Verify — double-check before reporting done

After `code_agent` returns, don't just summarize and move on. Check the work:

- **Read key output files** — don't rely solely on the agent's summary when quality matters.
- **Tests failed?** Analyze the error yourself. If the cause is clear, call again with specific fix guidance. If not, investigate before retrying.
- **Agent asked a question mid-task?** Resolve it (research, ask user) and call again with the answer.
- **Result looks off or incomplete?** Call again with follow-up instructions. Reference what's already done — don't re-describe the whole task.
- **Change seems risky or non-obvious?** Ask the agent to justify: `"Explain why you chose X over Y in <file>."` Don't accept changes you don't understand.
- **Approach seems hacky or over-engineered?** Push back. "It works" is not enough — the approach should be architecturally sound for the codebase. If the agent solved a local problem in a way that breaks a broader pattern, call again with that context.
- **Agent presented design choices?** Don't resolve them silently — relay meaningful tradeoffs to the user when the decision affects behavior or architecture.
- **Result looks good?** Summarize key outcomes concisely: what changed, what was verified, what the user should know.

### Session management

- **`compact_session=True`** — before a new task in a long session. Summarizes history, saves tokens, preserves context.
- **`reset_session=True`** — only when switching to a completely unrelated project. Clears history, keeps workspace files.
- Omit both for continuation of the same task.

---

## When the Agent Asks a Question

The agent surfaces questions only at real decision points — where a silent assumption would commit to a direction the user might not want.

- **Answer from what you know** — include it in the next call
- **Look it up first** — research using your available tools, then pass the answer back
- **Ask the user** — if only the user can decide, relay and wait

Don't re-describe work the agent has already done.

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
  <scope>Exact files to touch. What to leave alone.</scope>
  <context>API signatures, versions, prior research findings.</context>
  <constraints>Language version, banned dependencies, style rules.</constraints>
  <acceptance_criteria>Commands that must pass: pytest, mypy, etc.</acceptance_criteria>
</task>
```
