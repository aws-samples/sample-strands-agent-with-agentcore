# Sidebar search — development deployment and UI verification

Deployed to https://d4ysazlxg9l8c.cloudfront.net in `us-west-2` on 2026-09-14.

## Deployment

- Frontend task definition: `chatbot-frontend:101` (previously `:100`).
- Source/image tag: `9857de1b7412fe70442016d3073f16e5b81a178d`.
- Image digest: `sha256:6c2df56c45fe5f67d378d51fc4adfdad019a3c0f59160a1b87452fa82b348cbe`.
- CodeBuild: `strands-agent-chatbot-dev-chat-build:fd543982-8e44-479c-b439-f46508f3e4cf`, SUCCEEDED, including the production Next.js build.
- Saved Terraform plan targeted `module.chat`: 3 added, 2 changed, 3 replaced resources removed. Changes cover frontend build triggers, build environment source hash, task definition and service only. Existing Mantle and Nova Act settings were preserved; no agent runtimes or data stores were changed.
- Final rollout: COMPLETED; desired/running 1, pending 0. Live container image matches the expected tag and digest. `/api/health`: HTTP 200, healthy.

## Verification

Prior to deployment, type checking and 30 relevant frontend tests passed. After deployment, authenticated Chromium browsing exercised the real application and APIs, without mocked responses. Three temporary conversations were created through the UI: two English titles and one Korean title.

Passed:

- Trimmed, case-insensitive English title matching and Korean partial title matching.
- Result counts; no extra list/search request when entering a search query.
- No-results state, Show all chats, Escape and clear-search button; focus restored to the input.
- Tools & apps return preserves the search query.
- Keyboard Tab/Enter, visible deletion control on focus, loading saved conversation content and current-row highlighting.
- Whole-list deletion is behind the options menu and confirmation; Cancel sends no DELETE request.
- Individual deletion from filtered results removes the intended temporary conversation without opening it.
- Theme switch on an existing conversation; desktop 1440 × 1000 and touch viewport 390 × 844.
- Mobile search and delete controls fit; selecting a saved conversation closes the drawer, restores its content and prevents hidden-input focus through native `inert` behavior.
- Mobile New chat clears the query and closes the drawer.
- All three temporary conversations were deleted individually afterward. Existing conversations were not deleted.

No browser page errors were observed. The mobile focus check initially used a Playwright role count that included an inert off-screen input; it was corrected to verify actual off-screen geometry and native focus prevention. No application change or redeployment was necessary for that test adjustment.

Search covers titles in the currently loaded list, up to 100 active chats. Body search and older chats beyond that limit are outside this release. Mobile verification used Chromium viewport/touch emulation; physical iOS/Android devices were not tested.

## Evidence

- [Desktop search](sidebar-search-evidence-2026-09-14/desktop-search.png)
- [No results](sidebar-search-evidence-2026-09-14/empty-results.png)
- [Dark theme and selected conversation](sidebar-search-evidence-2026-09-14/desktop-dark-selected.png)
- [Mobile search](sidebar-search-evidence-2026-09-14/mobile-search.png)
- [Mobile opened conversation](sidebar-search-evidence-2026-09-14/mobile-opened-chat.png)
- [UI checks](sidebar-search-evidence-2026-09-14/ui-result.json)
- [Live release status](sidebar-search-evidence-2026-09-14/release-result.json)

Credentials, browser authentication state and Terraform state/plan files are excluded from these records.
