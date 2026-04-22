# Cowork ↔ AgentCore Gateway

Connect Cowork (Claude Desktop 3P) to the AgentCore Gateway's MCP tools.

## Architecture

```
Cowork (3P mode, Bedrock inference)
  ↓ Streamable HTTP + Bearer JWT (via managedMcpServers)
AgentCore Gateway (CUSTOM_JWT authorizer)
  ↓ Lambda invoke
web-search, wikipedia, arxiv, finance, weather, google-maps, google-search, tavily
```

Authentication is handled by `agentcore-token.sh` (headersHelper), which reads
Cognito tokens from `~/.cowork-sidecar/tokens.json` and auto-refreshes on expiry.

## Setup Modes

| Mode | What it does | Status |
|------|-------------|--------|
| 1 — Connector only | `managedMcpServers` in configLibrary. 23 tools under Connectors. | Working |
| 2 — Plugin only | org-plugin with `.mcp.json` + skills. No `managedMcpServers`. | Not yet working (headersHelper not executed from plugin context) |

## Prerequisites

- Infrastructure deployed with `enable_cowork = true`
- A Cognito user account (same pool as the chat app)
- Cowork (Claude Desktop in 3P mode with Bedrock inference configured)

## Setup

```bash
# 1. Deploy with Cowork enabled
cd infra/environments/dev
terraform apply -var enable_cowork=true

# 2. Run setup (reads Terraform outputs, opens browser for login, writes config)
cd cowork
./setup.sh          # Select mode 1 (connector) or 2 (plugin)

# 3. Restart Cowork (Cmd+Q, reopen)
```

## Token Lifecycle

| Token | Lifetime | Renewal |
|-------|----------|---------|
| access_token | 8 hours | Auto-refreshed by `agentcore-token.sh` (headersHelper) on each connection |
| refresh_token | 30 days | Re-run `./setup.sh --force-login` |

## Files

| File | Purpose |
|------|---------|
| `setup.sh` | One-shot setup: Terraform output, Cognito login, config + plugin install |
| `agentcore-token.sh` | headersHelper script: token refresh + JSON header output |
| `config.env.example` | Template for `~/.cowork-sidecar/config.env` |
| `skills/*.md` | Skill definitions for org-plugin (8 skills) |

## Runtime Files (not in repo)

```
~/.cowork-sidecar/
├── config.env              # Cognito credentials (chmod 600)
└── tokens.json             # access_token + refresh_token (chmod 600)

/usr/local/bin/
└── agentcore-token.sh      # headersHelper (installed by setup.sh)

~/Library/Application Support/Claude-3p/
├── configLibrary/*.json    # managedMcpServers (mode 1)
└── claude_desktop_config.json

/Library/Application Support/Claude/org-plugins/
└── agentcore-gateway/      # Plugin (mode 2)
```

## Logs

```
~/Library/Logs/Claude-3p/main.log     # App startup, plugin loading, MCP connection
```

View via Cowork Developer Settings > View Logs, or `tail -f ~/Library/Logs/Claude-3p/main.log`.

## Known Limitations (Cowork 3P v1.3883.0)

- **org-plugin `.mcp.json` does not execute headersHelper.**
  The script is never invoked; the app falls back to OAuth which fails.
  Absolute paths and `${CLAUDE_PLUGIN_ROOT}` both confirmed non-functional.
  This blocks plugin-only mode (mode 2).
- **`Mcp-Protocol-Version` header must not be included in headersHelper output.**
  Cowork sends it automatically; duplicating causes `"Unsupported MCP protocol version: 2025-11-25, 2025-11-25"`.
- **`managedMcpServers` requires `inferenceProvider`** in configLibrary.
  Without a configured inference provider, `managedMcpServers` is silently ignored.
- **`toolPolicy` only works in `managedMcpServers`**, not in `mcpServers` or `.mcp.json`.
  All tools show "Needs approval (set by admin)" in `mcpServers` entries.
- **`mcpServers` `streamable-http` type is rejected** by config validation.
  Only `command` (stdio) type works in `mcpServers`.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No connector after restart | configLibrary missing `managedMcpServers` | Run `./setup.sh` (mode 1) |
| "Connection to server failed" | `Mcp-Protocol-Version` header duplicated | Ensure `agentcore-token.sh` outputs only `Authorization` header |
| "Missing Bearer token" | headersHelper not executed (plugin mode) | Use mode 1 (connector) instead |
| Tools appear but calls fail | JWT expired mid-session | Restart Cowork (headersHelper re-fetches on startup) |
| Plugin not visible | Plugin cache stale | Run `./setup.sh` (clears caches automatically) |
| "Server disconnected" | Token file missing or bridge script not found | Run `./setup.sh` again |
| OAuth poisoning | Failed headersHelper cached OAuth state in keychain | Run `./setup.sh` (clears OAuth caches) |
