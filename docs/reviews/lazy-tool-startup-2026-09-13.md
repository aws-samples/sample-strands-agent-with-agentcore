# Deferred tool connection validation

External MCP services previously connected and listed tools before every
assistant run, even for a message that needed no tools. The startup measurements
in [the baseline report](startup-latency-2026-09-13.md) found about 6.2 seconds of
recurring federated-service preparation.

## Behavior

- The local skill catalog remains available at startup. A selected remote
  skill connects its provider when loading schemas or executing a tool.
- Gateway and federated MCP providers are independent. Selecting one does not
  connect the other. Skills sharing a provider reuse discovery within the run.
- Connections remain scoped to the calling agent and its credentials. This
  change does not pool authenticated connections across users or conversations.
- Discovery follows pagination, publishes no partial results on failure,
  closes failed connections, and allows a subsequent activation to retry.
- Disabled or unavailable tools are excluded. A stop received during discovery
  is checked again before executing the external action.

## Automated validation

Runtime unit/integration suite: **870 passed, 15 deselected**. The suite's 15
excluded e2e cases are unchanged. Ruff and Git whitespace checks passed.

The 15 new cases cover local startup, provider selection and reuse, composite
skills, disabled tools and unavailable authentication, pagination and retry,
concurrent activation, agent-specific schemas and execution, cancellation,
closed-agent cleanup, and hiding the injected context from the model schema.

## Deployed measurements

Orchestrator 85 and general subagent 42 were deployed with source hash
`08ef90e83cb74be5cb4bf072fbc342052d40c723`; both reported READY and their DEFAULT
endpoints served those versions. Frontend 100 and federated MCP runtime 9 were
unchanged. Terraform applied four build-trigger/source-upload replacements and
four in-place updates, with no service or data deletion.

Browser validation ran September 13, 2026, approximately 04:50–04:53 UTC.
The comparison used the same prompt, `Reply with exactly: Ready.`, the same
GPT-5.6 Terra model, and the normal enabled tools. Automatic warmup and the
1.5-second pause after the initial page greeting matched the baseline procedure.

| Successful request condition | Samples before / after | Starting before | Starting after | Request to first text before / after |
| --- | ---: | ---: | ---: | ---: |
| New conversation, automatic warmup | 2 / 2 | 10.417 s | **4.081 s** | 11.513 / **5.181 s** |
| Follow-up in the same conversation | 3 / 3 | 7.377 s | **1.117 s** | 8.055 / **1.790 s** |

Mean Starting time fell 60.8% for successful new conversations and 84.9% for
follow-ups. The after ranges were 4.054–4.107 seconds and 1.004–1.274 seconds,
respectively. No normal-chat trace connected an external MCP provider or called
a tool. Registry discovery still took about 1.756 seconds for a new conversation
and was cached for follow-ups. Remaining initialization averaged 1.744 seconds
for new conversations after registry discovery, and 0.640 seconds for follow-ups;
dispatch and delivery accounted for another 0.581 and 0.477 seconds respectively.

An additional browser-only control suppressed automatic warmup: Starting was
4.742 seconds and first text arrived at 5.920 seconds. A successful retry in a
previously failed conversation measured 4.037 seconds Starting; it is recorded
separately and excluded from the new-conversation mean.

Three early requests at 04:50:10–04:50:47 failed with a recoverable
`RUNTIME_UNAVAILABLE` message. The frontend logged AgentCore 424 with an upstream
502; these requests did not reach the AG-UI invocation log. Their automatic
warmups were still pending and eventually succeeded after about 28 seconds.
The precise underlying cause is not established. These failures are retained in
the data and excluded from the successful-response averages above. Subsequent
new conversations, including the control without warmup, succeeded. This
release-transition observation is a separate reliability limit: READY alone
did not establish immediate request readiness in this deployment.

## Deployed functional checks

- **Local workspace:** listed the empty conversation workspace successfully;
  neither MCP provider connected.
- **Gateway weather:** returned current Seattle weather. Only Gateway connected,
  taking 0.260 seconds after the skill was selected. Both dispatcher and actual
  tool rows completed successfully.
- **Federated Gmail:** connected in 6.489 seconds after skill selection, then
  displayed the expected Connect Gmail dialog. Cancelling authorization stopped
  the request; the next message returned Ready. No external account was linked,
  and a successful authorized Gmail read is outside this validation.
- **Stop during connection:** stopped Gmail skill activation while discovery
  was in progress. Logs show the stop before discovery completed (6.196 seconds),
  no Gmail execution, and normal cleanup. The next message returned Ready.
  Reload restored the cancelled tool row and the stop marker without a running
  indicator. The browser stream was aborted deliberately, so its observed span
  is not reported as completed end-to-end latency.
- Five browser pages reported no JavaScript errors. Screenshots and raw logs
  remain local; the weather result and restored cancellation UI were checked.

Sanitized observations are in
[`lazy-tool-startup-measurements-2026-09-13.json`](lazy-tool-startup-measurements-2026-09-13.json).
Raw browser traces and correlated CloudWatch logs remain under
`.codex-tmp/lazy-mcp/`. Cancellation checks include server logs after the browser
disconnect, rather than treating a hidden Stop button as proof of server cleanup.

## Limits

The first activation of a remote provider still pays its connection cost; it
now happens after the assistant starts. A later run requiring that provider
connects again. Model latency, cold runtime startup, and history loading remain.
The measurements are a small descriptive sample using GPT-5.6 Terra and short
histories, not p95 estimates or a latency guarantee.
