# IMPLEMENT — Stepwise Delegation & Correctness Verification

"It works" is not enough. The implementation must be correct — right approach, right place, aligned with existing patterns.

---

## Delegation principles

### Scope the call to match user expectations

Before each `code_agent` call:
- If the user asked for a small fix, don't delegate a full refactor.
- If the user asked for a feature end-to-end, say so — don't delegate just the first step silently.
- For large tasks, break into phases and tell the user what you're doing.

### Don't over-specify

You're briefing an engineer, not writing pseudocode.

```
# Right — direction and constraints, let the agent discover the how
code_agent(task="Add rate limiting to the /api/search endpoint. Max 100 req/min per user.
  Use whatever pattern is already in the codebase for middleware.
  Scope: only the middleware file and its tests.")

# Wrong — you're doing the agent's job
code_agent(task="""
  In src/middleware/rateLimiter.ts:
    export function rateLimiter(maxReq: number, windowMs: number) { ... }
  In src/routes/search.ts:
    router.use(rateLimiter(100, 60000))
""")
```

### Don't assume — ask when uncertain

If the agent is about to make an assumption that could go multiple ways, it should surface it first. The right pattern is: **one focused question, then proceed** — not five questions at once, not silent assumptions.

As orchestrator, when you're unsure about a constraint, ask the user before delegating. A wrong direction caught here costs one message. Caught after implementation, it costs a full redo.

### Pass what the agent can't discover

The agent reads the workspace. Don't re-describe files it can see. Do include:
- API contracts from external services
- User constraints mentioned in conversation
- Findings from your own research
- Decisions resolved in the design phase

### Simplicity first

When the agent proposes an approach, ask: is this the simplest solution that correctly solves the problem? If the agent reaches for abstraction, a design pattern, or a new dependency — ask whether a simpler version would do. Complexity that isn't justified by the current requirement should be deferred.

---

## Phased delegation with checkpoints

For non-trivial tasks, don't hand over everything at once. Break work into phases and check in between:

```
# Phase 1 — explore and plan (no code changes)
code_agent(task="Explore how auth currently works and propose a plan for adding JWT.
  Do not modify any files yet.")
# → Review the plan; correct direction before any code is written

# Phase 2 — implement phase 1 scope
code_agent(task="Implement the JWT middleware as discussed. Only touch the middleware
  file and its tests for now.")
# → Read key output files; confirm correctness before continuing

# Phase 3 — integrate
code_agent(task="Apply the JWT middleware to the routes we discussed. You've already
  done the middleware itself.")
# → Verify integration points and run tests

# Phase 4 — verify
code_agent(task="Run the full test suite and fix any failures.")
```

**After each phase, review before continuing.** An incorrect foundation in Phase 1 compounds into a wrong implementation in Phase 2.

For long tasks, it's effective to pause and summarize progress to the user between phases: "Phases 1–2 done (middleware + core logic). Ready to continue with integration?"

### When to use a single call

Straightforward, well-scoped tasks can be done in one call. Use phased delegation when:
- The implementation will touch more than 2–3 files
- The right approach isn't known yet
- There's a real risk of breaking something else
- The task has been split across multiple sessions

---

## Correctness, not just functionality

**"The agent said it passed" is not verification.** After each `code_agent` call:

### 1. Verify the output — don't pre-solve

After the agent finishes, spot-check the output:
- Read the files the agent says it modified — to confirm the change looks right, not to reverse-engineer the entire system
- Check that the approach is consistent with how the rest of the codebase handles similar problems
- Look for things that are technically correct but architecturally wrong

Ask yourself: *Would I accept this in a code review?*

If something looks wrong, delegate the investigation back to the agent — don't trace through the codebase yourself to figure out why:
```
code_agent(task="The change in [file] looks inconsistent with how the rest of the codebase
  handles this. Specifically, [observation]. Explain why you chose this approach,
  or correct it to match the existing pattern.")
```

### 2. Verification is part of the task — not optional

Verification is not a separate step after the "real work." Build it into every task delegation:

```
code_agent(task="""
  Implement [feature].

  After implementing:
  1. Run the test suite and confirm all tests pass.
  2. If there are no tests for this feature, write a minimal one that verifies the behavior.
  3. Report: what tests ran, what passed, what the output was.
""")
```

"I implemented it" without "I ran it and saw X" is an incomplete result.

### 3. Challenge the approach when something seems off

If the implementation looks overly complex, uses a different pattern than the rest of the codebase, or solves the problem in an indirect way — push back:

```
code_agent(task="""
  Looking at what you wrote in [file], I'm questioning the approach.
  The rest of the codebase does [X pattern]. You've done [Y].
  Either explain why Y is better here, or rewrite using the X pattern.
""")
```

"It works" is not a sufficient answer. The approach must be right for the codebase.

### 4. Check side effects

Any non-trivial change can break something it shouldn't. Ask the agent explicitly:

```
code_agent(task="""
  You changed [X]. What other parts of the codebase depend on [X]?
  Verify those are unaffected or update them if needed.
""")
```

This is especially important for:
- Interface/type changes
- Shared utility functions
- Database schema or API contract changes
- Configuration or environment variable changes

### 5. Verify integration points

When changes span multiple systems or use external APIs, verify integration at boundaries:

- Does the call site match the actual API signature? (Not what the agent assumes it is — verify from source)
- Are types aligned across the boundary?
- Are error cases from the external API handled correctly?

---

## Steering mid-task

If the agent returns with a question, or if its output seems to be going in the wrong direction:

- **Agent asked a question** — resolve it (research or ask user) and call again with the answer. Don't re-describe work already done.
- **Wrong direction** — correct early. A few extra words in the next call is cheaper than undoing a full implementation.
- **Partial completion** — reference what's already done explicitly. "You've done [A] and [B]. Now do [C]."
- **Approach seems hacky or overly complex** — don't accept it. Ask the agent to justify or simplify.
- **Agent went outside scope** — don't accept the out-of-scope changes unless you've explicitly approved them.

---

## Common delegation mistakes

| Mistake | Effect | Fix |
|---|---|---|
| Writing code immediately without exploring first | Wrong approach baked in early | Always explore and plan before implementing |
| Assuming external API method names without verifying | Silent runtime error (method not found) | Ask agent to confirm method signatures from source |
| Delegating without scope boundaries | Agent modifies files it shouldn't | Explicitly state what to leave alone |
| Accepting "tests pass" without seeing the test output | Bug hidden in untested path | Require test output as part of the result |
| Not checking both code paths after branching logic | One path works, the other is broken | State both paths explicitly in verification task |
| Letting the agent ask five questions at once | Friction, incomplete answers | Have it ask the single highest-priority question first |
| Accepting complexity without questioning it | Overengineered solution | Ask: is there a simpler version that works? |
