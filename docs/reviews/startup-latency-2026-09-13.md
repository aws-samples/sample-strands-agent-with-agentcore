# Starting-assistant latency measurements

This is the pre-change baseline. The subsequent implementation and deployed
comparison are in [Deferred tool connection validation](lazy-tool-startup-2026-09-13.md).

Measured the deployed application on September 13, 2026, approximately
03:58–04:00 UTC. No production code, deployment, or global user preferences were
changed. Browser fetch/SSE timestamps, visible status transitions, CloudWatch
application logs, and X-Ray traces were correlated for each request.

Deployment: frontend task definition 100, orchestrator 84, federated MCP runtime
9. Both runtimes reported a 900-second idle timeout and 28,800-second maximum
lifetime. Requests used GPT-5.6 Terra and the identical English prompt:
`Reply with exactly: Ready.` All eight returned the expected answer without
executing tools. The three test pages recorded no JavaScript errors.

## User-visible latency

Times are seconds. Means are descriptive samples, not percentiles or an SLA.

| Condition | Samples | Starting assistant, mean (range) | Request to first text, mean |
| --- | ---: | ---: | ---: |
| New conversation, normal automatic warmup | 2 | 10.417 (10.387–10.446) | 11.513 |
| Follow-up in the same conversation, normal tools | 3 | 7.377 (7.240–7.479) | 8.055 |
| Same conversation, federated MCP omitted for that request | 2 | 1.328 (1.162–1.494) | 2.029 |
| New conversation, automatic warmup suppressed for measurement | 1 | 13.150 | 14.286 |

The request-scoped diagnostic used the existing `allow_user_federation=false`
option. Gateway tools and local skills remained enabled; it did not change the
user's saved connector settings. Requests in the shared conversation ran in the
order normal, normal, normal, diagnostic, normal, diagnostic. This control
isolates the federated MCP preparation cost; removing those tools is not the
proposed product fix.

## Breakdown of Starting assistant

Mean seconds for the two normally warmed new conversations and three normal
follow-ups. These rows partition the measured Starting interval.

| Phase | New conversation | Same-conversation follow-up |
| --- | ---: | ---: |
| Runtime dispatch to application invocation log | 0.254 | 0.254 |
| Service registry discovery | 1.684 | 0.000 |
| Gateway MCP connection and tool-list extraction | 0.258 | 0.227 |
| Federated MCP connection and tool-list extraction | **6.208** | **6.177** |
| Prompt/session-manager setup, local skill catalog, model client, agent/history initialization | 1.368 | 0.406 |
| Other preparation and delivery of RUN_STARTED | 0.645 | 0.313 |
| **Total** | **10.417** | **7.377** |

The model-execution indicator then remained visible for another 1.036 seconds
on the new conversations and 0.637 seconds on follow-ups before the first text.
That is a client-side run-start-to-first-text interval, not a measurement of
model inference alone. Request processing before `starting_runtime` was
38–72 milliseconds in these trials.

Within the combined setup row, normal new/follow-up means respectively were:
prompt and session-manager construction 543/227 ms; local skill catalog 3/2 ms;
model-client and hook construction 651/<1 ms; agent/history initialization
172/177 ms. The service registry is already cached successfully for follow-ups.

## Findings

1. **Federated MCP preparation is the dominant recurring cost.** It took
   6.095–6.300 seconds across all six normal-tool requests, including three
   follow-ups in the same conversation. The request-scoped controls reduced
   mean Starting time by 6.049 seconds, about 82%, compared with the normal
   follow-ups. This is diagnostic evidence, not a promised optimization result.
2. **A fresh MCP server startup log appeared in each normal request window.**
   All six windows had a distinct runtime log stream with the server-starting
   message; neither diagnostic window did. This is time-window correlation,
   not an independently propagated cross-service trace identifier.
3. **The existing warmup helps the orchestrator, but does not prepare its
   tools.** The handler returns after container/module startup. In the
   no-warmup control, runtime dispatch to the invocation log was 2.642 seconds,
   versus approximately 0.254 seconds with normal warmup. This boundary includes
   routing/network and startup; it cannot be attributed wholly to AWS boot.
4. **Service registry caching is not the recurring bottleneck.** Initial
   discovery cost about 1.7 seconds; follow-ups did not repeat it. The local
   skill catalog scan took only a few milliseconds.

The next optimization should investigate reusing an authenticated MCP session
within the correct user/conversation scope, and connecting federated services
only when needed. `SkillChatAgent._extract_mcp_skill_tools` currently starts a
new client and lists its tools during agent construction, before RUN_STARTED;
`BaseAgent.close` closes the clients after each run. The current transport does
not explicitly carry a stable AgentCore runtime-session ID. Session-affinity
behavior and identity isolation must be verified when implementing reuse.

## Measurement method and limits

- Starting time: receipt of the BFF `request_progress/starting_runtime` event
  through receipt of the runtime `RUN_STARTED` event. Visible browser status
  transitions tracked the same interval within a few milliseconds.
- Initialization boundaries use existing application log markers: invocation,
  registry load, tool assembly, each MCP extraction completion, agent
  construction, and execution registration. Named intervals include small
  amounts of intervening local work; they are not new per-function timers.
- X-Ray corroborated registry, memory, and configuration API activity. MCP
  session spans last until client teardown, so their entire duration was **not**
  counted as startup time.
- Cross-host boundaries include clock/network uncertainty. The MCP interval
  and other application-internal intervals use timestamps from the same
  runtime. The consistent multi-second difference also appears in browser-only
  measurements.
- This small sample isolates startup using one model, short histories, and no
  attachments or actual tool execution. It does not characterize p95 latency,
  long histories, OAuth refresh failures, or every model.

Sanitized per-request values are in
[`startup-latency-measurements-2026-09-13.json`](startup-latency-measurements-2026-09-13.json).
Raw browser records, trace IDs, logs, and X-Ray documents remain local under
`.codex-tmp/startup-measurement/`.
