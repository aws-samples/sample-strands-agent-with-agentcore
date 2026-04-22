#!/bin/bash
# One-shot setup for Cowork ↔ AgentCore Gateway.
# Reads Terraform outputs, performs Cognito login, installs headersHelper,
# deploys org-plugin with connector (.mcp.json) and skill definitions.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TF_DIR="$REPO_ROOT/infra/environments/dev"
STORE_DIR="$HOME/.cowork-sidecar"
TOKEN_STORE="$STORE_DIR/tokens.json"
CONFIG_ENV="$STORE_DIR/config.env"
HEADERS_HELPER="/usr/local/bin/agentcore-token.sh"
CONFIG_LIBRARY="$HOME/Library/Application Support/Claude-3p/configLibrary"
CALLBACK_PORT=8976
CALLBACK_URL="http://127.0.0.1:${CALLBACK_PORT}/callback"
SCOPES="openid email profile agentcore/invoke"

echo "=== Cowork Gateway Setup ==="
echo ""
echo "Select setup mode:"
echo "  1) Connector only — managedMcpServers (23 tools, no skills)"
echo "  2) Plugin only    — org-plugin with skills + connector (headersHelper not yet supported)"
echo ""
read -rp "Mode [1/2] (default: 1): " SETUP_MODE
SETUP_MODE="${SETUP_MODE:-1}"

# --- Step 1: Gather values ---

if [ -d "$TF_DIR/.terraform" ]; then
  echo "Reading Terraform outputs from $TF_DIR ..."
  pushd "$TF_DIR" > /dev/null
  COGNITO_DOMAIN=$(terraform output -raw cowork_cognito_domain 2>/dev/null || echo "")
  CLIENT_ID=$(terraform output -raw cowork_client_id 2>/dev/null || echo "")
  CLIENT_SECRET=$(terraform output -raw cowork_client_secret 2>/dev/null || echo "")
  GATEWAY_URL=$(terraform output -raw cowork_gateway_url 2>/dev/null || echo "")
  popd > /dev/null
fi

if [ -z "${COGNITO_DOMAIN:-}" ]; then
  read -rp "Cognito domain URL (https://xxx.auth.region.amazoncognito.com): " COGNITO_DOMAIN
fi
if [ -z "${CLIENT_ID:-}" ]; then
  read -rp "Cognito app client ID: " CLIENT_ID
fi
if [ -z "${CLIENT_SECRET:-}" ]; then
  read -rsp "Cognito app client secret: " CLIENT_SECRET; echo
fi
if [ -z "${GATEWAY_URL:-}" ]; then
  read -rp "AgentCore Gateway MCP URL: " GATEWAY_URL
fi

echo ""
echo "  Cognito domain:  $COGNITO_DOMAIN"
echo "  Client ID:       $CLIENT_ID"
echo "  Gateway URL:     $GATEWAY_URL"
echo ""

# --- Step 2: Write config ---

mkdir -p "$STORE_DIR"
cat > "$CONFIG_ENV" << EOF
COGNITO_DOMAIN="$COGNITO_DOMAIN"
CLIENT_ID="$CLIENT_ID"
CLIENT_SECRET="$CLIENT_SECRET"
GATEWAY_URL="$GATEWAY_URL"
EOF
chmod 600 "$CONFIG_ENV"
echo "Wrote $CONFIG_ENV"

# --- Step 3: Install headersHelper ---

echo "Installing headersHelper to $HEADERS_HELPER (requires sudo)..."
sudo cp "$SCRIPT_DIR/agentcore-token.sh" "$HEADERS_HELPER"
sudo chmod 755 "$HEADERS_HELPER"
echo "Installed $HEADERS_HELPER"

# --- Step 4: Cognito login ---

if [ -f "$TOKEN_STORE" ]; then
  EXPIRED=$(python3 -c "
import json, time
t = json.load(open('$TOKEN_STORE'))
print('yes' if 'refresh_token' not in t or time.time() >= t.get('expires_at',0) + 86400*29 else 'no')
" 2>/dev/null || echo "yes")
  if [ "$EXPIRED" = "no" ]; then
    echo "Existing tokens found and refresh_token is valid. Skipping login."
    echo "(Run with --force-login to re-authenticate)"
    SKIP_LOGIN=true
  fi
fi

if [ "${SKIP_LOGIN:-false}" != "true" ] || [ "${1:-}" = "--force-login" ]; then
  echo ""
  echo "Opening browser for Cognito login..."

  STATE=$(python3 -c "import secrets; print(secrets.token_urlsafe(16))")
  VERIFIER=$(python3 -c "import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b'=').decode())")
  CHALLENGE=$(python3 -c "import hashlib, base64; print(base64.urlsafe_b64encode(hashlib.sha256('$VERIFIER'.encode()).digest()).rstrip(b'=').decode())")

  AUTH_URL="${COGNITO_DOMAIN}/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&scope=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$SCOPES'))")&redirect_uri=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$CALLBACK_URL'))")&state=${STATE}&code_challenge=${CHALLENGE}&code_challenge_method=S256"

  python3 << PYEOF &
import http.server, urllib.parse, json, sys

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        code = params.get("code", [None])[0]
        state = params.get("state", [None])[0]
        if state != "$STATE" or not code:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Login failed")
            return
        with open("/tmp/cowork_auth_code", "w") as f:
            f.write(code)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"<h1>Login complete</h1><p>You can close this tab.</p>")
        import threading
        threading.Timer(0.5, lambda: sys.exit(0)).start()
    def log_message(self, *args):
        pass

http.server.HTTPServer(("127.0.0.1", $CALLBACK_PORT), Handler).serve_forever()
PYEOF
  CALLBACK_PID=$!
  sleep 0.5

  open "$AUTH_URL" 2>/dev/null || echo "Open this URL: $AUTH_URL"

  echo "Waiting for login callback (timeout 5 min)..."
  for i in $(seq 1 300); do
    if [ -f /tmp/cowork_auth_code ]; then break; fi
    sleep 1
  done

  kill $CALLBACK_PID 2>/dev/null || true
  wait $CALLBACK_PID 2>/dev/null || true

  if [ ! -f /tmp/cowork_auth_code ]; then
    echo "ERROR: Login timed out. Run setup.sh again." >&2
    exit 1
  fi

  CODE=$(cat /tmp/cowork_auth_code)
  rm -f /tmp/cowork_auth_code

  BASIC_AUTH=$(printf '%s:%s' "$CLIENT_ID" "$CLIENT_SECRET" | base64)
  RESP=$(curl -s -X POST "${COGNITO_DOMAIN}/oauth2/token" \
    -H "Authorization: Basic ${BASIC_AUTH}" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code&code=${CODE}&redirect_uri=${CALLBACK_URL}&code_verifier=${VERIFIER}")

  python3 << PYEOF
import json, time, sys
resp = json.loads('''$RESP''')
if "access_token" not in resp:
    print("Token exchange failed: " + json.dumps(resp), file=sys.stderr)
    sys.exit(1)
tokens = {
    "access_token": resp["access_token"],
    "refresh_token": resp["refresh_token"],
    "expires_at": time.time() + resp["expires_in"],
}
with open("$TOKEN_STORE", "w") as f:
    json.dump(tokens, f)
import os; os.chmod("$TOKEN_STORE", 0o600)
print("Tokens saved to $TOKEN_STORE")
PYEOF
fi

# --- Step 5: Write managedMcpServers to configLibrary (mode 1 only) ---

if [ "$SETUP_MODE" = "1" ]; then
  python3 << PYEOF
import json, os, uuid

config_lib = "$CONFIG_LIBRARY"
os.makedirs(config_lib, exist_ok=True)
meta_path = os.path.join(config_lib, "_meta.json")

try:
    with open(meta_path) as f:
        meta = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    meta = {"entries": []}

profile_id = meta.get("appliedId")
if not profile_id:
    profile_id = str(uuid.uuid4())
    meta["appliedId"] = profile_id
    meta["entries"] = [{"id": profile_id, "name": "Default"}]

profile_path = os.path.join(config_lib, f"{profile_id}.json")
try:
    with open(profile_path) as f:
        profile = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    profile = {}

profile["managedMcpServers"] = [
    {
        "url": "$GATEWAY_URL",
        "transport": "http",
        "name": "AgentCore Gateway",
        "headersHelper": "$HEADERS_HELPER",
        "headersHelperTtlSec": 900,
    }
]

with open(profile_path, "w") as f:
    json.dump(profile, f, indent=2)
with open(meta_path, "w") as f:
    json.dump(meta, f, indent=2)

print(f"Wrote managedMcpServers to {profile_path}")
PYEOF
else
  # Mode 2: remove managedMcpServers if present
  python3 << PYEOF
import json, os, glob

config_lib = "$CONFIG_LIBRARY"
if os.path.isdir(config_lib):
    for f in glob.glob(os.path.join(config_lib, "*.json")):
        if os.path.basename(f) == "_meta.json":
            continue
        try:
            with open(f) as fh:
                profile = json.load(fh)
            if "managedMcpServers" in profile:
                del profile["managedMcpServers"]
                with open(f, "w") as fh:
                    json.dump(profile, fh, indent=2)
                print(f"Removed managedMcpServers from {f}")
        except (json.JSONDecodeError, KeyError):
            pass
PYEOF
fi

# --- Step 6: Clear caches ---

rm -f "$HOME/Library/Application Support/Claude-3p/plugin-settings.json"
rm -rf "$HOME/Library/Application Support/Claude-3p/local-agent-mode-sessions"/*/*/cowork_plugins/
security delete-generic-password -s "Claude Code-credentials" 2>/dev/null || true
security delete-generic-password -s "Claude-credentials" 2>/dev/null || true
rm -f ~/.claude/mcp-needs-auth-cache.json 2>/dev/null || true
find "$HOME/Library/Application Support/Claude-3p/" -name ".credentials.json" -delete 2>/dev/null || true
find "$HOME/Library/Application Support/Claude-3p/" -name "*mcp*auth*" -delete 2>/dev/null || true
echo "Cleared caches"

# --- Step 7: Install org-plugin or clean up ---

ORG_PLUGINS="/Library/Application Support/Claude/org-plugins"
PLUGIN_DIR="$ORG_PLUGINS/agentcore-gateway"

if [ "$SETUP_MODE" = "1" ]; then
  # Connector only — remove org-plugin if present
  if [ -d "$PLUGIN_DIR" ]; then
    echo "Removing org-plugin (connector-only mode)..."
    sudo rm -rf "$PLUGIN_DIR"
  fi
  echo ""
  echo "=== Setup complete (connector only) ==="
  echo "Restart Cowork (Cmd+Q, reopen) to connect."
  echo "23 tools will appear under Customize > Connectors > AgentCore Gateway."
else
  # Plugin only — org-plugin with .mcp.json + skills, no managedMcpServers.
  # NOTE: headersHelper in .mcp.json does not execute in Cowork 3P v1.3883.0.
  # This mode is for future versions where plugin headersHelper is supported.
  echo "Installing org-plugin to $PLUGIN_DIR (requires sudo)..."

  sudo rm -rf "$PLUGIN_DIR"

  sudo mkdir -p "$PLUGIN_DIR/.claude-plugin"
  for skill_file in "$SCRIPT_DIR"/skills/*.md; do
    skill_name=$(basename "$skill_file" .md)
    sudo mkdir -p "$PLUGIN_DIR/skills/$skill_name"
  done

  sudo tee "$PLUGIN_DIR/.claude-plugin/plugin.json" > /dev/null << 'PLUGEOF'
{
  "name": "agentcore-gateway",
  "version": "1.0.0",
  "description": "AWS Bedrock AgentCore Gateway - web search, arXiv, finance, weather, maps, Wikipedia tools",
  "author": {
    "name": "AWS"
  }
}
PLUGEOF

  sudo tee "$PLUGIN_DIR/version.json" > /dev/null << 'PLUGEOF'
{"version": "1.0.0"}
PLUGEOF

  sudo tee "$PLUGIN_DIR/.mcp.json" > /dev/null << PLUGEOF
[
  {
    "name": "agentcore-gateway",
    "url": "$GATEWAY_URL",
    "headersHelper": "$HEADERS_HELPER",
    "headersHelperTtlSec": 900
  }
]
PLUGEOF

  for skill_file in "$SCRIPT_DIR"/skills/*.md; do
    skill_name=$(basename "$skill_file" .md)
    sudo cp "$skill_file" "$PLUGIN_DIR/skills/$skill_name/SKILL.md"
  done

  echo "Installed org-plugin"

  echo ""
  echo "=== Setup complete (plugin only) ==="
  echo "WARNING: headersHelper does not execute from org-plugin in Cowork 3P v1.3883.0."
  echo "Use mode 1 (connector) until this is resolved in a future Cowork version."
  echo "Restart Cowork (Cmd+Q, reopen) to connect."
fi
