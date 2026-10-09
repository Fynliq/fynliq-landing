# Critical user journey

The fourteen steps that must work for FYNQ to be a product. Every YELLOW or RED
PR states which steps it touches. qa-agent verifies those steps, and
release-agent reports the "E2E critical journey" row against this list.

**Status (2026-10-06):** no automated end-to-end test exists. Coverage is
unit, contract and PGlite-integration tests (listed per step). Puppeteer
screenshot harnesses in `docs/*-screenshots.js` are manual. Automating this
journey against a preview deployment with fake or test Stripe is a phase-2
goal.

Legend for **Telemetry**: ✅ instrumented · ◐ partial · ✗ missing.

| # | Step | Route / API | Expected behaviour | Error / loading / mobile | Existing tests | Telemetry |
|---|---|---|---|---|---|---|
| 1 | Landing | `/` | Page renders. A guest session is created (`beta-auth` `guest`) and the first-touch attribution is recorded. | Works without JS-heavy fx on low-end phones and in-app browsers (TikTok, IG, FB) | `src/core/__tests__/*`, `test/attribution*.mjs` | ✅ `landing_view` + attribution + device/browser |
| 2 | Signup | `/signup` → `POST /api/auth/signup` | Email and password account. httpOnly account cookie set. Guest linked to the account. | Validation copy (`src/auth/validate.ts`), 429 under rate limit, 503 when disabled | `src/auth/__tests__/*`, `server/account-login.test.js` | ✅ `signup_started` (client) + `signup_completed` (server) |
| 3 | Login | `/login` → `POST /api/auth/login` | Valid credentials → session cookie. Invalid → generic error. | Generic error message, rate limit | `server/account-login.test.js` | ✅ `login_completed`, `login_failed` (no email) |
| 4 | Session persistence | `GET /api/auth/session` | Revisit stays logged in. Session renewed (about 400 days). Logout revokes it. | Expired → logged-out state without errors | `src/auth/__tests__/contract.test.ts`, `server/account-login.test.js` | ✅ `return_session` (later-day visits only) |
| 5 | Upload | `/beta` (My Aid) | Choose 1–3 PDFs or images. Text is read **on device** (pdf.js / tesseract). | Analyzing state, cancel, file too large or wrong type copy, mobile camera-roll picker | `src/beta/__tests__/files.test.ts` | ✅ `my_aid_viewed`, `upload_started` |
| 6 | Upload validation | client + `POST /api/analyze` | Unsupported or oversize files refused with clear copy. No aid lines → `no_aid_lines`. | Each refusal has its own message | `files.test.ts`, `server/analyze.test.js` | ✅ `upload_failed` (server reason codes + browser network failures) |
| 7 | PII protection | `server/redact.js` (device **and** server), `server/privacy.js` | Names, SSNs, account numbers etc. removed or blocked **before** any model call. High-risk PII fails closed: `/api/analyze` returns 400 and `/api/ask` returns 422, each with the privacy message. | Privacy message tells the student what to remove | `server/redact.test.js`, `src/analytics/privacy.test.ts`, `src/search/__tests__/privacy.test.ts` | ✅ `upload_failed` reason `privacy_blocked` (count only) |
| 8 | AI analysis | `POST /api/analyze` → OpenAI (`store:false`) | Only allow-listed figures are extracted, verified against the redacted text, with no invented amounts. Saved to `aid_analyses` (30 days). | 60s max. `reader_error` / `unreadable` handled. | `server/analyze.test.js`, `test/financial-document.test.mjs`, `test/aid-overview.test.mjs`, `server/document-flow.test.js` | ✅ `analysis_started/completed/failed` + `ai_ms` latency; API p50/p95 |
| 9 | Results | `/beta/results` | Locked → **preview only** (no figures reach the browser). Unlocked or grandfathered → full figures. | Empty and "Not enough information" states, print styles, mobile layout | `src/core/__tests__/documentAnalysis.test.ts`, `documentDashboard.test.ts`, `aid-overview.test.mjs` | ✅ `results_viewed` (view: preview or full) |
| 10 | Checkout | `POST /api/billing {checkout}` → Stripe Checkout | Creates or reuses one $1.00 USD session for the cookie's account. No document data in metadata. | Double-click safe (idempotency key), 503 copy when misconfigured | `server/billing.test.js`, `test/billing-integration.mjs` | ✅ `checkout_viewed`, `checkout_started` (once per session) |
| 11 | Payment success | Stripe → `/api/stripe-webhook` → `billing_entitlements` | **Only** a verified webhook unlocks. Exact amount and currency. Idempotent. | Success page polls. Never grants on its own. | `test/billing-integration.mjs` | ✅ `payment_completed`, `unlock_verified` (verified webhook only) |
| 12 | Payment failure | Stripe cancel / `async_payment_failed` / `expired` | Account stays locked. Saved analysis is still there. Unlock buttons recover after Back from Stripe. | Cancelled copy on `/beta/checkout?result=cancelled` | `test/billing-integration.mjs` | ✅ `payment_failed`, `checkout_expired` (webhook) |
| 13 | Feature unlock | `GET /api/billing`, `GET /api/analyze` | Premium → full analysis plus Search, Ask and Earn tabs unlocked. Grandfathered and test accounts open. | Locked tabs show the unlock card | `server/billing.test.js`, `test/billing-integration.mjs` | ◐ `unlock_verified`; access per view not logged |
| 14 | Return visit | `/` → `/beta/results` | Logged-in user sees their latest saved analysis (≤30 days) at the right access level. | Expired analysis → re-upload prompt | `test/billing-integration.mjs` (cancel/refresh/logout paths) | ✅ `return_session` |

## Cross-cutting invariants (every step)
- Document text, file names, aid figures and search text **never** reach
  analytics, logs, Stripe or attribution.
- Every API failure shows the student a human sentence. Internals never leak.
- Mobile first: about 390px wide and in-app browsers are the primary
  environment.
