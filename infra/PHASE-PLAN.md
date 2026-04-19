# Terraform Migration Plan

CDK → Terraform migration for `agent-blueprint/`. Reference: `~/Downloads/aws-samples/agent-platform-on-agentcore/infra/`.

## Goals

- Full Terraform replacement of all 5 CDK stacks, CDK code removed on completion.
- **Precise change tracking** via `source_hash = sha1(fileset(...))` → ECR image tag + Runtime env. Replaces CDK's `Date.now()` forced-redeploy hacks.
- Partial deploys via `terraform apply -target=module.X`. Also full apply is cheap once change tracking is correct.
- S3 + DynamoDB remote state. Bucket/table auto-bootstrapped on first run.
- `network_mode = PUBLIC` only for phase 1.

## Auth design (locked)

- Single Cognito user pool, single resource server `agentcore` with scope `invoke`.
- 3 clients: `app` (auth code + PKCE), `web` (SRP only, no OAuth flows), `m2m` (client_credentials).
- Audience boundary enforced by **`allowed_clients` per Runtime/Gateway authorizer**, not per-scope.
- Runtime → Gateway: **user JWT passthrough** via `request_header_allowlist = ["Authorization"]`. No IAM SigV4 for Gateway invocation.
- MCP 3LO Runtime: uses same Cognito JWT inbound (user identity needed for per-user OAuth token vending via `GetWorkloadAccessTokenForUserId`).
- Phase 2 may split resource server into `runtime`/`gateway` + add interceptor Lambda for scope enforcement.

## Directory layout

```
infra/
├── bootstrap/                S3 tfstate bucket + DynamoDB lock table (one-time)
├── environments/dev/         Single env; all modules wired here
├── modules/
│   ├── auth                  ✅ Cognito (pool, domain, 3 clients, resource server)
│   ├── memory                ✅ AgentCore Memory + semantic/user_preference strategies
│   ├── data                  ✅ DynamoDB users-v2 + sessions (GSI UserSessionsIndex)
│   ├── runtime               ✅ Generic AgentCore Runtime (types: component, orchestrator, a2a_agent, http_agent, mcp_3lo)
│   ├── gateway               ⏭ AgentCore Gateway (CUSTOM_JWT) + interceptor Lambda
│   ├── gateway-lambda-tool   ⏭ Lambda tool (for_each × 7: arxiv, weather, finance, wikipedia, google-search, google-maps, tavily)
│   ├── chat                  ⏭ ECS + ALB + CloudFront
│   └── observability         ⏭ Log delivery (optional)
└── scripts/deploy.sh         Auto-bootstrap + terraform init/plan/apply/destroy
```

## Phase 1 progress

| Step | Module | Status | Notes |
|------|--------|--------|-------|
| 1    | bootstrap + env skeleton | ✅ | S3/DDB auto-created on first deploy.sh apply |
| 2    | modules/auth | ✅ | Cognito pool, 3 clients, SSM params |
| 3    | modules/runtime | ✅ | source_hash gating works (verified: no-op replays produce 0 changes) |
| 4    | mcp_3lo runtime wired | ✅ | Runtime ID: `strands_agent_chatbot_dev_mcp_3lo-5gp3tWGzuO` |
| 5    | modules/memory | ✅ | Memory ID: `strands_agent_chatbot_dev_memory-wnhC9nAtdo` |
| 6    | modules/data | ✅ | `strands-agent-chatbot-users-v2`, `strands-agent-chatbot-sessions` |
| 7    | modules/gateway + gateway-lambda-tool | ⏭ | CUSTOM_JWT (allowed_clients = [app, web, m2m]); for_each 7 Lambdas from `agent-blueprint/agentcore-gateway-stack/lambda-functions/*`. Phase 1 scope: no interceptor Lambda (deferred to Phase 2). |
| 8    | orchestrator runtime | ✅ | Runtime ARN: `strands_agent_chatbot_dev_orchestrator-Y0GpKH3Upe` |
| 9    | a2a runtimes (×2) | ✅ | code-agent: `strands_agent_chatbot_dev_code_agent-t9g1Ny9JUe`, research-agent: `strands_agent_chatbot_dev_research_agent-rFySuI9V6A`. browser-use-agent excluded. |
| 10   | modules/chat | 🚧 | ECS Fargate + ALB + CloudFront. Default VPC + public subnets. CloudFront prefix list auth for ALB. Existing `chatbot-frontend` ECR imported. |
| 11   | API end-to-end test | ⏭ | `infra/scripts/test-api.sh`: Cognito login → Gateway tools/list + Orchestrator invoke |
| 12   | Remove `agent-blueprint/` CDK | ⏭ | After end-to-end parity verified |

## Phase 2 (later)

- `modules/identity` — AgentCore OAuth2 Credential Provider (for outbound 3LO workload identity mapping).
- Split Cognito resource server: `runtime/invoke`, `gateway/invoke`. App client holds both scopes.
- Gateway interceptor Lambda: extract `sub`/`client_id` from JWT, inject as header to downstream tools; enforce scope.
- `modules/registry` — AgentCore Registry (currently not supported by AWS provider; will use custom resource Lambda pattern like reference). Also register local skills for orchestrator discovery.
- `modules/vpc` + VPC_CREATE/VPC_EXISTING modes with `network_lockdown`.

## Change-tracking invariant (critical)

`modules/runtime` uses:
```
source_hash = sha1(join("", [for f in fileset(...): filesha1(...)]))
```
with excludes for `node_modules`, `cdk.out`, `__pycache__`, `.git`, `.venv`, `.next`, `.terraform`, `.DS_Store`, `.pyc`, `.log`.

Flow:
1. Source file changes → `source_hash` changes
2. `null_resource.upload_source` re-zips and uploads to S3
3. `null_resource.codebuild_trigger` checks ECR: if `ECR:<hash>` exists, skip build; else CodeBuild → push `:latest` + `:<hash>`
4. Runtime `container_uri = ECR:<hash>` → forces new deployment
5. Runtime env `SOURCE_HASH = <hash>` → ensures no cached container layer reuse

Verification: `terraform plan` on unchanged source must produce **"No changes"**. Never introduce `timestamp()` or `uuid()` into any trigger.

## Partial deploy examples

```bash
# Full apply
./infra/scripts/deploy.sh apply

# Only rebuild one runtime after editing its source
./infra/scripts/deploy.sh apply -target=module.runtime_mcp_3lo

# Gateway + one specific Lambda tool
./infra/scripts/deploy.sh apply -target=module.gateway -target='module.gateway_lambda_tools["tavily"]'

# Destroy one module (partial tear-down)
./infra/scripts/deploy.sh destroy -target=module.runtime_mcp_3lo
```

## Open questions / deferred decisions

- ECR repo naming: current Terraform uses `${project}/${component}` (e.g., `strands-agent-chatbot/mcp-3lo`). CDK used `${project}-${component}` (e.g., `strands-agent-chatbot-mcp-3lo-server`). Existing CDK-created ECR repos will be orphaned unless imported or manually removed. Decide before Phase 1 completion.
- Frontend CloudFront + Cognito Lambda@Edge auth from current CDK: preserve or redesign in the chat module?
- M2M client currently has no consumer in Phase 1. Wire to gateway's allowed_clients for future background/batch work.
- DynamoDB `hash_key` deprecation warning (provider 6.41 prefers `key_schema`). Low priority; functionally equivalent.
