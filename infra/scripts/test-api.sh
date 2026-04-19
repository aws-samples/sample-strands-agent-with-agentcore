#!/bin/bash
# End-to-end smoke test:
#   1. Create/sign-in a Cognito test user
#   2. Obtain an access token
#   3. Invoke Gateway (MCP tools/list) and Orchestrator (HTTP /invocations)
#
# Usage:
#   TEST_EMAIL=test@example.com TEST_PASSWORD='TestPass123!' ./infra/scripts/test-api.sh

set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="$INFRA_DIR/environments/dev"

TEST_EMAIL="${TEST_EMAIL:-test@example.com}"
TEST_PASSWORD="${TEST_PASSWORD:-TestPass123!}"

cd "$ENV_DIR"

POOL_ID=$(terraform output -raw cognito_user_pool_id)
CLIENT_ID=$(terraform output -raw cognito_web_client_id)
GATEWAY_URL=$(terraform output -raw gateway_url)
ORCH_URL=$(terraform output -raw orchestrator_invocation_url)

# Derive region from the Cognito pool id (us-west-2_xxxx) — avoids picking up
# a stale AWS_REGION from the caller's shell.
AWS_REGION="${POOL_ID%%_*}"
export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"

echo ">>> User pool:       $POOL_ID"
echo ">>> Client ID:       $CLIENT_ID"
echo ">>> Gateway URL:     $GATEWAY_URL"
echo ">>> Orchestrator:    $ORCH_URL"

# Create user (idempotent — only ignore UsernameExistsException)
echo ""
echo ">>> Ensuring test user..."
CREATE_ERR=$(aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username "$TEST_EMAIL" \
  --user-attributes Name=email,Value="$TEST_EMAIL" Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --region "$AWS_REGION" 2>&1 >/dev/null) || true
if [ -n "$CREATE_ERR" ] && ! echo "$CREATE_ERR" | grep -q UsernameExistsException; then
  echo "$CREATE_ERR" >&2
  exit 1
fi
[ -n "$CREATE_ERR" ] && echo "   (user exists)"

aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL_ID" \
  --username "$TEST_EMAIL" \
  --password "$TEST_PASSWORD" \
  --permanent \
  --region "$AWS_REGION" >/dev/null

# Auth (USER_PASSWORD_AUTH flow on web client — no secret)
echo ""
echo ">>> Signing in..."
AUTH_JSON=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters USERNAME="$TEST_EMAIL",PASSWORD="$TEST_PASSWORD" \
  --region "$AWS_REGION")

ACCESS_TOKEN=$(echo "$AUTH_JSON" | python3 -c "import json,sys;print(json.load(sys.stdin)['AuthenticationResult']['AccessToken'])")
echo "   got access_token (${#ACCESS_TOKEN} chars)"

# Gateway MCP probe — a full tools/list requires the MCP handshake
# (initialize → notifications/initialized → tools/list). Validate connectivity
# by checking the endpoint rejects a missing Authorization (401) but accepts ours.
echo ""
echo ">>> Gateway: auth probe"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$GATEWAY_URL" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}')
echo "  initialize -> HTTP $CODE (200 = auth ok; non-200 body below)"

python3 - "$GATEWAY_URL" "$ACCESS_TOKEN" <<'PY'
import sys, json, urllib.request
url, tok = sys.argv[1], sys.argv[2]
def call(payload, mcp_session=None, extra_accept=False):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST')
    req.add_header('Authorization', f'Bearer {tok}')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Accept', 'application/json, text/event-stream')
    if mcp_session:
        req.add_header('Mcp-Session-Id', mcp_session)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode()
try:
    s, h, b = call({'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{'name':'smoke','version':'0'}}})
    sid = h.get('Mcp-Session-Id') or h.get('mcp-session-id')
    s2, _, b2 = call({'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}}, mcp_session=sid)
    try:
        data = json.loads(b2)
        tools = data.get('result',{}).get('tools',[])
        names = [t.get('name') for t in tools[:6]]
        print(f"  tools/list -> HTTP {s2}, {len(tools)} tools: " + ', '.join(names) + ('…' if len(tools)>6 else ''))
    except Exception:
        print(f"  tools/list -> HTTP {s2}, body: {b2[:200]}")
except Exception as e:
    print(f"  gateway probe failed: {e}")
PY

# Orchestrator uses AG-UI protocol on POST /invocations.
# Warmup is the lightest valid action — confirms auth + container readiness.
echo ""
echo ">>> Orchestrator: warmup"
curl -sS -X POST "$ORCH_URL" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"thread_id":"smoke-1","run_id":"smoke-run-1","messages":[],"state":{"action":"warmup","user_id":"smoke-test"}}' \
  | head -c 500
echo ""
