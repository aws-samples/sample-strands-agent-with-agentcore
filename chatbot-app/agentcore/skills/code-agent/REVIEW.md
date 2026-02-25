# REVIEW — Iterative Review & Known Issue Checklist

Completion is not done when the agent says it's done. It's done when you've verified it.

---

## Review depth by complexity

Scale the review effort to the task complexity:

| Complexity | Description | Review approach |
|---|---|---|
| **Low** | Single file, single concern, no external dependencies | Spot-check key output; confirm tests pass |
| **Medium** | Multiple files, touches shared utilities or APIs | Read all modified files; check integration points; run tests |
| **High** | Cross-system, new dependencies, protocol/interface changes | Full review each phase; check both code paths; verify externally |

For medium+ complexity: if the review finds issues, **fix them and review again**. Don't stop at the first pass that looks clean. Iterate until the review finds nothing.

---

## Review checklist

After `code_agent` returns, go through these:

### Correctness
- [ ] Does the implementation match the user's original intent? (Not just the task description you wrote — the user's underlying goal)
- [ ] Is the approach consistent with how the rest of the codebase handles similar problems?
- [ ] Were any assumptions made that weren't verified? (API signatures, field names, event formats)
- [ ] Does it handle both the happy path and error/edge cases?
- [ ] Are side effects on other parts of the codebase accounted for?

### Scope
- [ ] Did the agent stay within the stated scope?
- [ ] Are there any changes to files that weren't supposed to be touched?
- [ ] If the agent went outside scope, was it reported and approved before proceeding?

### Integration
- [ ] Do all call sites match the actual signatures being called?
- [ ] Are types/schemas aligned across system boundaries?
- [ ] If a protocol or format is involved (REST, events, SSE, AG-UI…), was the actual spec read or just assumed?
- [ ] Are there multiple code paths (e.g., two API routes, A/B config) — were both updated?

### Quality
- [ ] Would this pass a code review? (Not just "does it run")
- [ ] Is the complexity appropriate, or is it over-engineered?
- [ ] Is there a simpler version that correctly solves the problem?
- [ ] Are there any workarounds or hacks that should be addressed before shipping?

### Verification
- [ ] Were tests actually run, not just written?
- [ ] Is the test output included in the report?
- [ ] If there were no tests, was a minimal verification done?

### User intent
- [ ] Does the final result match what the user actually asked for?
- [ ] Did any design decision diverge from what the user expected? If so, was it surfaced?
- [ ] Is there anything the user should be made aware of before using this?

---

## Reporting to the user

When the task is complete and the review is clean, summarize concisely:

```
Files changed:
  - src/middleware/rateLimiter.ts — added rate limiting logic (new file)
  - src/routes/search.ts — applied middleware to /search route
  - tests/rateLimiter.test.ts — added 4 tests; all pass

Verified: ran full test suite (42 tests, 0 failures)

Note: rate limit is currently per-IP. If per-user-ID limiting is needed later,
the key function in rateLimiter.ts can be swapped without touching the routes.
```

This gives the user:
- **What changed and where** — at the file level, not line-by-line
- **What was verified and how** — test output, not just "tests pass"
- **Design decisions made** — anything that affects future work or that diverges from what they might expect
- **Known limitations or deferred items** — explicit, not buried

Don't just summarize. Surface the decisions.

---

## Known issue patterns

These are recurring patterns where code agents produce technically-running-but-wrong implementations. Check for them explicitly on medium/high complexity tasks.

### 1. Protocol spec misread

**Pattern**: Agent implements based on a plausible interpretation of a protocol, not the actual spec.

**Signs**: Field names slightly off, event types wrong, payload structure nested incorrectly, custom event data in wrong location.

**Check**: When working with a specific protocol (AG-UI, MCP, SSE, OpenAPI…), ask the agent to cite the specific spec field or event type it's using, not just say "I followed the protocol."

```
code_agent(task="""
  For each protocol-level field you read or write (event types, payload fields, header names),
  show me the spec reference or source file that defines it.
  If you assumed a field name without verifying, flag it.
""")
```

---

### 2. Incomplete path coverage

**Pattern**: Feature works on one code path; the parallel path is not updated.

**Signs**: Works when triggered from UI but not from API; works for one user type but not another; works in one environment but not another.

**Trigger**: Any time there are two routes to the same feature (e.g., different request formats, different entry points, different auth flows).

**Check**: Before closing, explicitly ask:

```
code_agent(task="""
  This system has [path A] and [path B] for [feature].
  Confirm both are updated and tested.
  If only one was updated, update the other now.
""")
```

---

### 3. Dead code that appears functional

**Pattern**: Old code is left in place alongside the new code. The old code path still runs; the new code is unreachable or redundant.

**Signs**: Condition is always false; event handler registered but never fired; variable overwritten immediately after assignment; function defined but never imported.

**Check**: After implementation, scan for:
- Variables assigned but never used
- Conditions that can never be true given the data flow
- Event handlers or callbacks registered but never triggered in practice

```
code_agent(task="""
  Review the changes you made for dead code — logic that exists but can never run
  given the actual data flow. Remove it or explain why it's reachable.
""")
```

---

### 4. Untracked side effects on shared code

**Pattern**: A change to a shared utility, type, or interface breaks callers that weren't updated.

**Signs**: TypeScript errors elsewhere; runtime crashes in unrelated features; tests passing but manual test fails.

**Check**: For any shared utility or interface change:

```
code_agent(task="""
  You modified [shared component/type/function].
  Search the entire codebase for all callers/importers.
  Verify each one still works correctly with the change, or update them.
""")
```

---

### 5. External API method assumed, not verified

**Pattern**: Agent calls a method on an external SDK/library that doesn't exist, or uses the wrong signature.

**Signs**: `AttributeError`, `TypeError`, `method not found` at runtime even though it compiled.

**Cause**: Agent infers method names from conventions (`.close()`, `.stop()`, `.disconnect()`) without confirming from source or docs.

**Check**: For any external SDK call in new code:

```
code_agent(task="""
  For each external SDK/library method you're calling in [file],
  confirm the method name and signature by checking the installed package source
  (not documentation — the actual installed version).
  Flag any discrepancy.
""")
```

---

### 6. Serialization/deserialization not handled at boundaries

**Pattern**: Data arrives as a JSON string; agent treats it as a parsed object. Or vice versa.

**Signs**: `undefined` fields even though the data is "there"; silent failure when accessing nested fields; JSON printed as `[object Object]`.

**Check**: At any system boundary (network response, event payload, database read):

```
code_agent(task="""
  At [boundary], what is the actual type of [field] as it arrives?
  Is it a raw string that needs JSON.parse()? A Buffer? A nested object?
  Confirm with a log or type check, don't assume.
""")
```

---

### 7. Silent assumption instead of a question

**Pattern**: Agent encounters an ambiguity and picks one interpretation without flagging it.

**Signs**: Implementation is internally consistent but doesn't match user intent; a small mismatch in understanding caused a large mismatch in output.

**Prevention**: If you notice the task description had room for interpretation, ask the agent directly:

```
code_agent(task="""
  Before you continue — in [part of the task], you could have interpreted it as [A] or [B].
  Which did you choose and why? If [B] was the wrong choice, correct it now.
""")
```

---

## Iterating until clean

If a review finds issues:

1. Fix the issues
2. Re-run the relevant review checklist items
3. If new issues are found, fix and check again
4. Stop when a full pass finds nothing

For high-complexity tasks, plan for **at least two review rounds** before reporting done to the user. The first round almost always finds something.
