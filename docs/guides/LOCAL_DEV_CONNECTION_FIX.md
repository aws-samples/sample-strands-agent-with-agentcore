# Local Development Connection Fix

## Issue
Frontend (Next.js) couldn't connect to backend (Python/FastAPI) with error:
```
ECONNREFUSED ::1:8080
```

## Root Cause
- Backend was listening on IPv4: `0.0.0.0:8080`
- Frontend was trying to connect via IPv6: `::1:8080` (localhost resolves to IPv6 on macOS)
- This caused connection refused errors

## Solution

### 1. Fixed Backend Connection URL
Changed `AGENTCORE_URL` from `localhost` to explicit IPv4 address:

**File**: `chatbot-app/frontend/src/lib/agentcore-runtime-client.ts`
```typescript
// Before
const AGENTCORE_URL = process.env.NEXT_PUBLIC_AGENTCORE_URL || 'http://localhost:8080'

// After
const AGENTCORE_URL = process.env.NEXT_PUBLIC_AGENTCORE_URL || 'http://127.0.0.1:8080'
```

### 2. Fixed Model ID Format
Corrected model IDs to use proper Bedrock format without regional prefix:

**File**: `chatbot-app/frontend/.local-store/user-model-config.json`
```json
// Before
"model_id": "eu.anthropic.claude-sonnet-4-5-20250929-v1:0"

// After
"model_id": "anthropic.claude-sonnet-4-5-20250929-v1:0"
```

**File**: `chatbot-app/frontend/src/app/api/model/available-models/route.ts`
- Changed all `eu.anthropic.*` to `anthropic.*`
- Changed all `eu.amazon.*` to `amazon.*`

## Verification

### Check Backend is Running
```bash
lsof -i :8080 | grep LISTEN
# Should show Python process listening on port 8080
```

### Check Backend Logs
```bash
tail -f chatbot-app/agentcore.log
# Should show "Uvicorn running on http://0.0.0.0:8080"
```

### Test Frontend Connection
1. Open http://localhost:3000
2. Send a test message
3. Should now successfully connect to backend

## Why This Happens
On macOS, `localhost` can resolve to either:
- IPv4: `127.0.0.1`
- IPv6: `::1`

Node.js/Next.js prefers IPv6 when available, but Python's Uvicorn binds to `0.0.0.0` (IPv4 only by default). Using explicit `127.0.0.1` forces IPv4 connection.

## Date
2026-01-28
