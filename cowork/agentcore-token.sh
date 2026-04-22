#!/bin/bash
# headersHelper for managedMcpServers / org-plugins (future use).
# Reads refresh_token, exchanges for access_token via Cognito, prints JSON headers.
# Also usable standalone: ./agentcore-token.sh
set -euo pipefail

CONFIG="${HOME}/.cowork-sidecar/config.env"
TOKEN_STORE="${HOME}/.cowork-sidecar/tokens.json"

if [ ! -f "$CONFIG" ]; then
  echo "Missing config: $CONFIG  Run: cd cowork && ./setup.sh" >&2
  exit 1
fi
if [ ! -f "$TOKEN_STORE" ]; then
  echo "No tokens. Run: cd cowork && ./setup.sh" >&2
  exit 1
fi

source "$CONFIG"

NEED_REFRESH=$(python3 -c "
import json, time
t = json.load(open('$TOKEN_STORE'))
print('yes' if time.time() >= t['expires_at'] - 60 else 'no')
")

if [ "$NEED_REFRESH" = "yes" ]; then
  BASIC_AUTH=$(printf '%s:%s' "$CLIENT_ID" "$CLIENT_SECRET" | base64)
  REFRESH_TOKEN=$(python3 -c "import json; print(json.load(open('$TOKEN_STORE'))['refresh_token'])")

  RESP=$(curl -s -X POST "${COGNITO_DOMAIN}/oauth2/token" \
    -H "Authorization: Basic ${BASIC_AUTH}" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=refresh_token&refresh_token=${REFRESH_TOKEN}")

  python3 << PYEOF
import json, time, sys
resp = json.loads('''$RESP''')
if 'access_token' not in resp:
    print('Token refresh failed: ' + json.dumps(resp), file=sys.stderr)
    sys.exit(1)
store = json.load(open('$TOKEN_STORE'))
store['access_token'] = resp['access_token']
store['expires_at'] = time.time() + resp['expires_in']
if 'refresh_token' in resp:
    store['refresh_token'] = resp['refresh_token']
json.dump(store, open('$TOKEN_STORE', 'w'))
PYEOF
fi

ACCESS_TOKEN=$(python3 -c "import json; print(json.load(open('$TOKEN_STORE'))['access_token'])")
printf '{"Authorization":"Bearer %s"}\n' "$ACCESS_TOKEN"
