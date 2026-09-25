# Model upgrade — corrected development deployment and validation

Deployed to https://d4ysazlxg9l8c.cloudfront.net on 2026-09-25.

**The requested models work. Endpoint/region routing and Mantle IAM permissions were corrected, development was redeployed, and all three models passed real chat and tool execution checks. GPT-6 Sol is the default; Terra is removed.**

## Correction to the initial diagnosis

The initial report incorrectly concluded that AWS Marketplace registration blocked use of these models. Those failures came from the Bedrock Runtime route in `us-west-2`. Rechecking the local Codex routing configuration and probing the available APIs confirmed working Mantle routes in `us-east-1` with this account's existing credentials.

| Model | Canonical ID | Working transport |
| --- | --- | --- |
| GPT-6 Sol | `openai.gpt-6-sol` | Mantle Responses, `us-east-1` |
| GPT-6 Luna | `openai.gpt-6-luna` | Mantle Responses, `us-east-1` |
| Claude Opus 5.5 | `anthropic.claude-opus-5-5` | Mantle Anthropic Messages, `us-east-1` |

Mantle Responses uses `https://bedrock-mantle.us-east-1.api.aws/openai/v1/responses`; Messages uses `https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/messages`. No Codex configuration was changed.

The deployed Code Agent and web summary roles additionally required `bedrock-mantle:CreateInference`, scoped to the account's `us-east-1` `project/default` resource. Existing `bedrock:InvokeModel` permission alone did not authorize this route. Claude Agent SDK uses its native Bedrock/Mantle mode, with request-specific region and model settings. It recreates the client when switching between Mantle Opus and Runtime Claude models.

## Changes

- Opus 5 → 5.5; GPT-5.6 Sol/Luna → GPT-6 Sol/Luna.
- GPT-6 Sol default across backend, web, mobile source and Telegram; Terra removed from the selectable catalog.
- Old persisted IDs migrate to current canonical IDs; Terra maps to Sol.
- General GPT subagents use Luna for low complexity and Sol for medium/high complexity. Manual conversation summaries use Luna and preserve the plain-text response contract.
- Main Opus inference uses Anthropic Messages. Office document blocks refer to files already stored in the workspace so document tools can read them; PDF/image/text retain native handling.
- Pinned `ag-ui-protocol==0.1.22`: rebuilding with the previously unbounded dependency pulled a version that rejected the frontend's existing `binary` file parts. The tested pin preserves attachment compatibility.

## Final deployment

Only the reviewed development runtime/channel changes and scoped Mantle permissions were applied. Existing Bedrock secret, Nova Act workflow and Telegram configuration were preserved.

| Component | Verified release |
| --- | --- |
| Code Agent | Runtime 15; DEFAULT READY on 15; source image matches |
| General Subagent | Runtime 46; DEFAULT READY on 46; source image matches |
| Orchestrator | Runtime 89; DEFAULT READY on 89; source image matches |
| Research Agent | Runtime 16; DEFAULT READY on 16; source image matches |
| Web | `chatbot-frontend:103`; rollout COMPLETED; running 1, pending 0 |
| Telegram | `strands-agent-chatbot-dev-tg-task:8`; rollout COMPLETED; running 1, pending 0 |

All six latest CodeBuild jobs succeeded. Runtime image references match the final plans, including the Office adapter and AG-UI pin. Mobile source passed type checking; no native mobile binary was published. Telegram rollout/health was verified without sending messages.

## Validation

- 261 targeted Python tests passed across the main runtime, Research Agent and Code Agent. After pinning AG-UI, the 106 chat-router/model-factory tests were rerun and passed.
- 32 targeted frontend tests passed, including legacy ID migration and the summary signing/plain-text contract.
- Web, mobile and Telegram type checking passed; Terraform formatting, shell syntax and diff whitespace checks passed.
- Authenticated browser: GPT-6 Sol default; switching Sol/Luna/Opus; Terra absent; no page errors.
- Authenticated live chat: all three new models returned `MODEL_OK`; a legacy Terra request also succeeded through Sol.
- Live factory integration: all three models invoked a real probe tool and returned `TOOL_OK`.
- Deployed Opus Code Agent: created a file, read it back, and persisted exactly `OPUS_A2A_OK`; storage content independently verified.
- Deployed Luna summary: returned a plain-text summary preserving the Aurora release decision. One initial attempt received a provider capacity 503; a later retry succeeded. This was not an authorization error, and the attempt is retained in the evidence.
- Deployed Opus DOCX upload: read the attached document using tools and returned its codename `HARBOR_SILVER_731`.

Generated test conversations and Code Agent test storage prefixes were individually deleted. Existing conversations were preserved. Temporary refreshed authentication files were removed after validation.

## Evidence

- [Final release state and builds](model-upgrade-evidence-2026-09-25/release-status.json)
- [Live chat and summary](model-upgrade-evidence-2026-09-25/live-results.json)
- [Browser validation](model-upgrade-evidence-2026-09-25/browser-results.json)
- [Three-model tool calls](model-upgrade-evidence-2026-09-25/factory-live.json)
- [Deployed Code Agent file verification](model-upgrade-evidence-2026-09-25/code-a2a-live.json)
- [Deployed DOCX validation](model-upgrade-evidence-2026-09-25/office-results.json)
- [Summary attempts, including transient capacity error](model-upgrade-evidence-2026-09-25/summary-attempts.json)

Earlier `model-availability.json`, `runtime-error-evidence.json`, and `baseline-result.json` are historical records of the initial Runtime-route investigation; they do not describe the final Mantle deployment. Credentials, browser authentication state and Terraform plans are excluded from repository evidence.
