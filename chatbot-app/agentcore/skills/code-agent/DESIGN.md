# DESIGN — Requirements & Design Phase

Before writing a single line of code, you must understand what's being built and make the key decisions. Skipping this phase is the most common cause of rework.

---

## What you bring vs. what the agent handles

The code agent can read and navigate the entire workspace. What it can't do is reach outside it — talk to the user, search the web, consult other skills, or access external API docs. That's your contribution.

**Don't spend your effort doing the agent's investigation for it.** The agent should be the one tracing through the codebase, finding the root cause, and proposing a fix. Your job is to frame the problem clearly, supply external context it can't get itself, and verify the result.

```
# Wrong — you traced the bug yourself, handed a pre-solved task
1. User: "The stop button hangs after the refactor"
2. You: read useChat.ts, useChatAPI.ts, useStreamEvents.ts... found root cause yourself
3. You: code_agent(task="In useChat.ts line 865, add resetStreamingState() call here")

# Right — you framed the problem, agent did the investigation
1. User: "The stop button hangs after the refactor"
2. You: code_agent(task="The stop button hangs after the AG-UI integration.
     Investigate the stop flow — from button click through to how the stream
     is terminated. Find the root cause and propose a fix before changing anything.")
3. Review the agent's diagnosis → if unclear, ask user or search for external context
4. You: code_agent(task="Implement the fix you proposed.")
```

Reading a file to spot-check the agent's output is fine. Spending time reading files to fully diagnose a problem yourself before delegating — is not.

---

## Step 1. Restate the goal

Translate the user's request into a concrete, verifiable outcome:

- "Make it faster" → "Reduce /search API response time by caching the results."
- "Add auth" → "Add JWT-based authentication to all API routes."
- "Fix the bug" → "Fix the NullPointerException thrown when user profile is empty."

If you can't state the goal in concrete terms, you don't understand it yet. Ask the user before proceeding.

---

## Step 2. Explore first — always separate understanding from implementation

**The most common failure pattern is writing code immediately after receiving a request.**

For any non-trivial task, the first `code_agent` call must be an exploration call only. The agent reads and understands; it does not write. Even when the task seems clear, there are patterns, constraints, and existing code in the workspace that change how the implementation should look.

```
# Phase 0 — explore and plan, no implementation yet
code_agent(task="""
  Before writing any code, do the following:
  1. Read all files relevant to [goal] and summarize how the system currently works.
  2. Identify the key design decisions needed to implement [goal].
  3. Propose your implementation plan — what you'll change, in what order, and why.
  4. If anything is unclear or could go multiple ways, list those questions now.

  Do NOT modify any files yet. Wait for plan approval.
""")
```

Review the agent's plan before proceeding. Correct the direction here — it's much cheaper than correcting it after files are changed.

### If the task is genuinely simple

Skip the exploration step for: a single bug fix in a known file, a small config change, a clearly scoped one-liner. Don't create overhead where none is needed. When in doubt, explore first.

---

## Step 3. Resolve open decisions

Sort open decisions by who can make them:

| Who decides | How to handle |
|---|---|
| **User** — affects behavior, architecture, or priorities | Relay the tradeoff and wait for the user's answer |
| **You (orchestrator)** — external facts the agent can't reach: API docs, user requirements, version compatibility info from package registries | Look it up externally (web search, npm, docs), then pass the findings in the task |
| **Code agent** — internal structure, naming, error handling strategy | Leave it to the agent; it reads the codebase |

**Don't dump unresolved decisions onto the agent.** If you pass ambiguous requirements, the agent will make silent assumptions that may not align with what the user wants. It's better to spend one round clarifying than three rounds correcting.

### Ask one question at a time

If you need to ask the user something, ask the **single most important question** first. Presenting five questions at once creates friction and often goes unanswered. Prioritize the question that blocks everything else.

The same applies to the code agent: if it surfaces multiple unclear points, have it identify the single highest-priority ambiguity and ask that one first.

### Decisions that must go to the user

Escalate to the user when the decision involves:
- **Behavior tradeoffs** — e.g., "fail fast vs. degrade gracefully"
- **Technology or framework choice** — e.g., "REST vs. GraphQL", "Redis vs. DynamoDB"
- **Scope boundaries** — e.g., "should this affect existing data or only new records?"
- **Compatibility constraints** — e.g., "can we break the existing API contract?"
- **Priority tradeoffs** — e.g., "ship fast vs. do it properly"

Present the decision clearly:

```
"Two approaches here:
  A) [approach] — pros: [X], cons: [Y]
  B) [approach] — pros: [X], cons: [Y]
Which fits better with your goals?"
```

Don't resolve these silently. Don't guess. The agent will implement whatever direction you give it.

---

## Step 4. Define scope explicitly — and enforce it

Before delegating, define:

- **What the goal is** — at the feature or behavior level, not the file level. Don't pre-map which files will be touched; let the agent discover that.
- **What's out of scope** — any areas you know should not be touched (e.g., "don't change the public API surface")
- **What "done" looks like** — tests passing, specific behavior observable, specific output produced

Include scope boundaries in every non-trivial task delegation:

```
code_agent(task="""
  Fix the rate limiting bug in src/middleware/rateLimiter.ts.

  Scope: only rateLimiter.ts and its direct tests. Do not touch any route files.
  If you discover something broken outside this scope, report it before changing anything.
""")
```

Scope creep in the task description leads to scope creep in the implementation. When the agent encounters something outside scope that seems worth fixing, it should report it and ask — not fix it silently.

---

## Step 5. Prefer simplicity

When reviewing the agent's proposed plan, push back on unnecessary complexity:

- The simplest solution that correctly solves the problem is the right one
- If the agent proposes abstraction layers, new dependencies, or a design pattern, ask: is this actually needed, or is there a simpler path?
- Complexity that isn't justified by the current requirement should be deferred

```
"Before we go with this approach — is there a simpler version that handles the current
requirement? We can add abstraction later if we need it."
```

This applies to plans, not just code. A plan with five phases when two would do is a signal the scope has expanded beyond what was asked.
