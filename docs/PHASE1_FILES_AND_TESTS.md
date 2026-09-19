# Phase 1 exact changed files and tests

Target: existing fynliq.com app. Branch: feat/closed-beta-launch. Changes are local and have not been deployed.

## Results

- Application regressions: 212 passed across 19 files.
- Synthetic PostgreSQL/PGlite boundary tests: 22 passed, including migration, direct-role access denial, content-free tables, rolling MAU/WAU/DAU, returning guests, caps, invite revocation, admin access, and database close/reopen persistence.
- TypeScript: passed.
- Production Vite build: passed.
- npm audit: zero reported vulnerabilities after patched development dependencies.
- No real student data, external OTP delivery or paid OpenAI requests used. Low-memory database runs reused a synthetic temporary database directory, cleared its schema, and applied the full new migration.
- Real Supabase deployment, real admin email delivery, production limits and telemetry retention remain unverified.

## Exact files changed relative to local account draft 1cbedd0

- Modified: [.env.example](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/.env.example>)
- Modified: [api/account.js](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/api/account.js>)
- Modified: [api/activity.js](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/api/activity.js>)
- Modified: [api/analyze.js](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/api/analyze.js>)
- Modified: [api/ask.js](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/api/ask.js>)
- Modified: [package-lock.json](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/package-lock.json>)
- Modified: [package.json](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/package.json>)
- Modified: [server/account-auth.test.js](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/server/account-auth.test.js>)
- Modified: [server/account-service.js](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/server/account-service.js>)
- Modified: [server/ask-service.js](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/server/ask-service.js>)
- Modified: [server/document-flow.test.js](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/server/document-flow.test.js>)
- Modified: [server/provider.js](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/server/provider.js>)
- Modified: [src/App.tsx](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/src/App.tsx>)
- Modified: [src/accounts/AccountProvider.tsx](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/src/accounts/AccountProvider.tsx>)
- Modified: [src/accounts/activity.ts](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/src/accounts/activity.ts>)
- Modified: [src/accounts/client.ts](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/src/accounts/client.ts>)
- Modified: [src/pages/Answer.tsx](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/src/pages/Answer.tsx>)
- Modified: [src/pages/AskFynliq.tsx](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/src/pages/AskFynliq.tsx>)
- Modified: [src/pages/BetaUpload.tsx](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/src/pages/BetaUpload.tsx>)
- Modified: [src/search/httpAnalytics.ts](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/src/search/httpAnalytics.ts>)
- Removed: `supabase/migrations/202609170001_accounts.sql`
- Added: [api/beta-admin.js](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/api/beta-admin.js>)
- Added: [api/beta-auth.js](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/api/beta-auth.js>)
- Added: [docs/CLOSED_BETA_LAUNCH.md](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/docs/CLOSED_BETA_LAUNCH.md>)
- Added: [docs/PHASE1_FILES_AND_TESTS.md](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/docs/PHASE1_FILES_AND_TESTS.md>)
- Added: [server/beta.js](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/server/beta.js>)
- Added: [server/privacy.js](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/server/privacy.js>)
- Added: [src/pages/BetaAdmin.tsx](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/src/pages/BetaAdmin.tsx>)
- Added: [src/search/__tests__/privacy.test.ts](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/src/search/__tests__/privacy.test.ts>)
- Added: [supabase/migrations/202609170002_closed_beta.sql](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/supabase/migrations/202609170002_closed_beta.sql>)
- Added: [test/beta-integration.mjs](<C:/Users/grape/Documents/Codex/2026-09-11/referenced-chatgpt-conversation-this-is-an/outputs/fynliq-review-integration/test/beta-integration.mjs>)

The removed account-storage migration was an unapplied draft. No production records or schemas were deleted. The original three-page layout was preserved; guest sessions now start automatically without invite codes and the upload endpoint is temporarily blocked.

See [launch blockers and configuration](CLOSED_BETA_LAUNCH.md).
