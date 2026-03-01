# AgentCore Chat — React Native (Expo) iOS App

A React Native prototype that connects to the [sample-strands-agent-with-agentcore](https://github.com/aws-samples/sample-strands-agent-with-agentcore) BFF over AG-UI Server-Sent Events.

## Tech stack

| Layer | Library |
|-------|---------|
| Framework | Expo SDK 55 / React Native 0.83 |
| Navigation | Expo Router v5 (file-based, `app/` dir) |
| Auth | AWS Amplify v6 + Amazon Cognito |
| Streaming | Custom POST-SSE parser + `connectSSEStream` (exponential backoff) |
| UI state | React Context (`AuthContext`, `SessionContext`) + custom hooks |
| Markdown | `react-native-markdown-display` |
| Modals | `@gorhom/bottom-sheet` v5 |

## Prerequisites

- Node 18+
- Expo CLI: `npm install -g expo-cli` (or use `npx expo`)
- iOS Simulator via Xcode, **or** the [Expo Go](https://expo.dev/go) app on a physical device

## Setup

### 1. Install dependencies

```bash
cd mobile-app
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Open `.env` and set:

```env
# URL of the Next.js BFF (no trailing slash)
# For local development with the BFF running on your machine:
EXPO_PUBLIC_API_URL=http://localhost:3000

# AWS Region where your Cognito User Pool lives
EXPO_PUBLIC_AWS_REGION=us-east-1
EXPO_PUBLIC_COGNITO_REGION=us-east-1   # kept for compatibility

# From the CDK stack outputs (CognitoAuthStack):
EXPO_PUBLIC_USER_POOL_ID=us-east-1_XXXXXXXXX
EXPO_PUBLIC_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
```

> **Where to find Cognito values:** run `cdk deploy` in the repo root and look for the `CognitoUserPoolId` and `CognitoUserPoolClientId` outputs, or open the AWS Console → Cognito → User Pools.

### 3. Start the BFF

Follow the instructions in the parent repo to start the Next.js BFF:

```bash
# From the repo root
cd nextjs-app
npm install
npm run dev          # starts on http://localhost:3000
```

### 4. Run on iOS Simulator

```bash
npx expo start
# Press `i` to open the iOS Simulator
```

Or scan the QR code with the Expo Go app on a physical device.

### 5. Run on a physical iOS device (without Expo Go)

Create a development build:

```bash
npx expo run:ios
```

This requires Xcode and an Apple Developer account.

## Project structure

```
mobile-app/
├── app/                        # Expo Router file-based routes
│   ├── _layout.tsx             # Root layout — Amplify bootstrap, AuthGate
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   └── login.tsx           # Sign in / Sign up / Verify email
│   └── (main)/
│       ├── _layout.tsx         # Tab navigator + SessionProvider
│       ├── index.tsx           # Chat tab
│       └── sessions.tsx        # Conversations list tab
└── src/
    ├── components/
    │   ├── auth/               # AuthGate (redirect helper)
    │   ├── chat/               # ChatScreen, MessageList, ChatInputBar, …
    │   ├── events/             # Individual AG-UI event renderers
    │   └── sessions/           # SessionListItem
    ├── config/
    │   └── amplify.ts          # Amplify.configure() wrapper
    ├── constants/
    │   └── theme.ts            # Dark-theme design tokens (background, surface, primary, …)
    ├── context/
    │   ├── AuthContext.tsx     # Auth state (status, user, Hub listener)
    │   └── SessionContext.tsx  # Active session ID shared across tabs
    ├── hooks/
    │   ├── useChat.ts          # Top-level chat orchestrator
    │   ├── useChatStream.ts    # SSE connection lifecycle
    │   ├── useSessions.ts      # Session CRUD
    │   ├── useStreamEvents.ts  # AG-UI event → React state dispatcher
    │   └── useTextBuffer.ts    # 50 ms flush buffer for streaming text
    ├── lib/
    │   ├── api-client.ts       # Typed fetch helpers (GET / POST / DELETE)
    │   ├── auth.ts             # Amplify auth helpers + generateSessionId
    │   ├── constants.ts        # API_BASE_URL, ENDPOINTS, defaults
    │   ├── sse-client.ts       # POST-SSE with exponential-backoff retry
    │   └── sse-parser.ts       # ReadableStream → AGUIEvent line parser
    └── types/
        ├── chat.ts             # Message, SessionMeta, RunAgentInput, …
        └── events.ts           # All AG-UI event type definitions
```

## Authentication flow

1. App opens → `AuthGate` checks auth status from `AuthContext`
2. **Unauthenticated** → redirected to `/(auth)/login`
3. User signs in (or creates an account + verifies email)
4. Amplify Hub fires `signedIn` → `AuthContext` updates → `AuthGate` redirects to `/(main)`
5. All BFF requests include `Authorization: Bearer <Cognito ID token>`; the token is refreshed automatically by Amplify before expiry

## Streaming architecture

The BFF's `/api/stream/chat` endpoint is POST-only, so the native `EventSource` API is not used. Instead:

1. `useChatStream` calls `apiStreamPost` (in `src/lib/api-client.ts`), which opens an authenticated `fetch` POST and returns the raw `Response`
2. The response body `ReadableStream` is handed to `parseSSEStream` (in `src/lib/sse-parser.ts`), which decodes `data: <JSON>` lines into `AGUIEvent` objects
3. Each event is dispatched to `useStreamEvents`, which maps it to React state updates
4. Text tokens are buffered for 50 ms before flushing to the UI to reduce re-render pressure

`src/lib/sse-client.ts` provides an alternative `connectSSEStream` helper with exponential-backoff reconnection (3 retries, 1 s / 2 s / 4 s delays) for use cases that need resilience — it is available but not used in the default chat flow.

## Session IDs

AgentCore Runtime requires session IDs of at least 33 characters. The `generateSessionId(userId)` helper in `src/lib/auth.ts` produces IDs in the format `{prefix8}_{timestampBase36}_{randomHex}` (capped at 52 chars), which always satisfies this constraint.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 401 from BFF | Check `EXPO_PUBLIC_USER_POOL_ID` / `CLIENT_ID` match the deployed stack |
| Stream never starts | Confirm BFF is running and `EXPO_PUBLIC_API_URL` is reachable from the device/simulator |
| "No such file or directory: libglib-2.0.so.0" on start | DevTools inspector dependency missing from CI/Linux; harmless — Metro still starts |
| TypeScript errors | Run `npx tsc --noEmit` — all errors must be zero before opening a PR |
| `react-native-worklets/plugin` error during bundling | `react-native-worklets` is a required peer dep of `react-native-reanimated` v4 — run `npm install` (it's already in `package.json`) |
