# Q4 student journey: frontend assessment

| | |
|---|---|
| **Date** | 16 October 2026 |
| **Code assessed** | `feat/connect-ask-backend` at `6a7b9bf` (the live branch, see `CLAUDE.md` §1) |
| **Work branch** | `feat/q4-student-journey` (not pushed, not merged) |
| **Journey** | Landing → Sign up → Upload → Free preview → $1 unlock → Full analysis |

Labels: **[Fact]** is checked in the code at the commit above. **[Assumption]** is not checked
and needs confirming.

---

## 1. Recommended approach

Most of the Q4 journey is already on the live branch. PR #10 put the free preview before the
$1 unlock, with the server enforcing it. The work is therefore about closing gaps, not
rebuilding:

1. Fix the journey's dead ends and silent states in the frontend, using only existing
   contracts.
2. Map the Q4 funnel event names onto the events that already exist, rather than renaming
   them. Renaming would break the funnel SQL in the migrations and the `billing_metrics()`
   history.
3. Write down the backend contracts that Priority 2 (history and deletion) needs. Don't fake
   them.

Changes that touch RED paths (`src/billing/**`, `src/auth/**`, `src/analytics/**`, any `api/`
or `server/` billing file) wait for the human's go-ahead and a green run of `test:billing`,
as `ops/autonomy.yaml` requires.

## 2. Current behaviour and problems found

### Already working [Fact]

- **The preview is enforced by the server.** For a locked account, `POST /api/analyze` and
  `GET /api/analyze` return `lockedPayload`: three totals and a review count. Figures,
  labels and quotes are never sent to the browser (`api/analyze.js`, `src/beta/preview.ts`).
- **Entitlement is set by the webhook.** Only `api/stripe-webhook.js` grants it. The return
  page polls `GET /api/billing` and never trusts the query string (`CheckoutReturn.tsx`).
- **Checkout can't create duplicates.** `createCheckout` reuses an open session and sends an
  idempotency key per account per 36-minute window (`server/billing.js`).
- **Saved results survive a refresh, a trip to Stripe and logging out.** The browser reloads
  them through `GET /api/analyze` (newest, or `?id=`). The server keeps them 30 days in
  `aid_analyses`, and access is authorized by the account cookie. Nothing is put in browser
  storage (`App.tsx`).
- **Upload has its own messages for:** rejected file types, files too large, privacy blocks,
  no aid lines found, an unreadable document, a reader error, and HTTP 429.

### Problems

| # | Problem | Where | Root cause |
|---|---|---|---|
| P1 | **Logged-out return from Stripe goes wrong.** A cancelled checkout opened while logged out lands, after log-in, on "We're confirming your payment" and polls for up to 10 minutes. | `App.tsx` gate | The gate saves only `path`, so `?result=cancelled` is lost. The router's `navigate()` can't carry a query string either. |
| P2 | **Payment dead end.** When the return page times out, its only button reloads the same page. There's no way back to the preview or analysis, and nothing to do while waiting. | `CheckoutReturn.tsx` | Nothing offers a route out of the `slow` and `timeout` states. |
| P3 | **No time limit on the analysis request.** If the request hangs, the student sees "Fynliq is reading your document" forever. | `httpAnalyzer.ts` | `fetch` has no timeout. The server's limit is 60 s (`api/analyze.js` `maxDuration`). |
| P4 | **A retry after a timeout pays for the AI read again**, even when the first read finished and was saved on the server. | `BetaUpload.tsx` | The upload page never checks `GET /api/analyze` before reading again. |
| P5 | **The upload page is blank while billing status loads** (frontend review, finding 3). | `BetaUpload.tsx` | Renders `null` while `billing.loading`. |
| P6 | **Checkout errors show raw server text** (up to 200 characters). `CLAUDE.md` says internals must never reach the student. | `src/billing/client.ts` `post()` | Passes the response body through. **RED path, deferred.** |
| P7 | **"Analysis format" error shows "The document reader did not return JSON."** | `httpAnalyzer.ts` | Developer wording shown to students. |

**Sign-up routing:** the frontend review on `docs/frontend-ux-audit` doesn't record a
sign-up routing bug, and none was reproduced in code. The routing defect that was confirmed
is P1: the gate loses the query string. **Question for the product owner:** which sign-up
routing bug does the Q4 brief mean?

## 3. Frontend changes (this branch)

| Change | Fixes | Files | Risk class |
|---|---|---|---|
| Gate keeps the query string, using a validated same-origin return path | P1 | `src/router/returnPath.ts` (new), `src/router/router.tsx`, `src/App.tsx` | YELLOW |
| Return page: "Back to my analysis" in the slow and timeout states. "Check again" restarts the wait without a reload. | P2 | `src/pages/CheckoutReturn.tsx` | YELLOW |
| 70 s time limit on the analysis request, with its own `timeout` error | P3, P7 | `src/beta/analyzer.ts`, `src/beta/httpAnalyzer.ts`, `src/beta/deadline.ts` (new) | YELLOW |
| After a timeout, ask the server for a read saved since the upload started before offering a retry | P4 | `src/pages/BetaUpload.tsx` | YELLOW |
| Status line while billing loads | P5 | `src/pages/BetaUpload.tsx` | YELLOW |
| Checkout error copy chosen by status, never the response body | P6 | `src/billing/client.ts` | **RED.** Approved by the human in session; needs `security-agent` review before merge. |

## 4. Backend dependencies

| Need | Exists? | Contract | Backend action | Blocks production? |
|---|---|---|---|---|
| Server-enforced preview scope | **Yes** | `lockedPayload` in `api/analyze.js` | None | No |
| AI limits and idempotency | **Partly.** 3 per minute per IP (`allowRequest`), 25 s model timeout. No request idempotency key. | Proposed: `POST /api/analyze` takes an `Idempotency-Key` header. Same key within 10 minutes → the stored result, with no new model call. | Implement, or confirm the rate limit is enough | No. It's a cost risk, partly covered by P4. |
| List saved analyses (Priority 2) | **No.** `aid_analysis_get` returns one row (newest, or by id). | Proposed: `GET /api/analyses` → `{ items: [{ id, kind, fileCount, readAt, expiresAt, access: 'preview' \| 'full' }] }`, newest first, account from the cookie, no figures | New RPC `aid_analysis_list(p_user)` plus a handler | **Yes**, for the history screen |
| Delete an analysis | **No.** Rows expire after 30 days only. | Proposed: `DELETE /api/analyze?id=<uuid>` → 204 (also 204 if already gone), same-origin check, only the owner can delete | New RPC plus a handler. Confirm the retention policy. | **Yes**, for the delete action |
| Analysis status (processing / failed) | **No.** Reads are synchronous, and only successful reads are saved. | Not needed while reads stay synchronous | Confirm | No |
| Payment verification | **Yes.** Webhook plus `GET /api/billing` | — | None | No |
| A delayed (async) payment that is still pending | **Unclear.** `billing_open_checkout` reuses only `status='open'` sessions. If a completed-but-unpaid session (`payment_status='unpaid'`) leaves the `open` state before `async_payment_succeeded`, a new click could open a second checkout. | `GET /api/billing` could return `access: 'pending'` while such a session exists | Confirm which payment methods the live Checkout allows. If only cards, close as not applicable. | **Confirm before widening the paywall** |
| Server-side funnel events | **Mostly.** See §5. | — | Confirm the mapping | No |

## 5. Funnel events: Q4 name → existing event

| Q4 event | Existing event | Emitted by | Gap |
|---|---|---|---|
| `landing_page_viewed` | Vercel pageview on `/` and the `acquisition_attribution` first touch | Client (allow-listed) / server | None |
| `sign_up_completed` | `account_events` sign-up row | Server (`server/account-login.js`) | None |
| `document_upload_completed` | `aid_upload_completed` and `upload_events.outcome='read'` | Client and server | None |
| `free_preview_viewed` | `aid_preview_viewed` | Client | Fires once per mount, so again after Back from Stripe. Acceptable as a "view". |
| `unlock_clicked` | `unlock_button_clicked` (client), `unlock_clicked` (server, when a checkout is created) | Both | None. The server one counts real checkout starts. |
| `payment_succeeded` | `billing_stripe_events` / entitlement activation | **Server only (webhook)** | None. It is never emitted from a redirect. |
| `analysis_completed` | `full_analysis_viewed` (deduplicated per analysis id) | Client | None |

Every event is content-free: event name, account and time. **Recommendation:** keep the
existing names, and if the product team wants the Q4 names, add a reporting view that maps
them.

## 6. Security, privacy, payment and cost

- No figures reach a locked browser. The UI doesn't hide anything with CSS; the server holds
  it back.
- No change here stores results in browser storage, logs or analytics.
- Return paths are checked to be same-origin. Only paths starting with a single `/` are
  accepted, and they stay in React state, never in the URL.
- After an uncertain payment, the student is sent back to the analysis, never to a new
  charge. The server reuses the open checkout and returns `unlocked` once the webhook has
  run.
- Cost: P4 avoids a second model call after a client-side timeout. A server-side idempotency
  key would close the gap fully (§4).

## 7. Estimates, acceptance criteria and tests

| Task | Estimate | Acceptance criteria | Tests |
|---|---|---|---|
| P1 gate query string | 0.5 d | A logged-out cancelled return shows the preview with the "not charged" notice after log-in. `//evil.com`, `https:`, `javascript:` and backslash forms are refused. | `returnPath.test.ts` |
| P2 return page | 0.5 d | Every non-confirmed state offers a way back to the analysis. No state offers a new charge. | Manual (no DOM test runner in this repo) |
| P3/P4/P7 timeout | 0.5 d | After 70 s: a timeout message and a working retry. A read saved on the server is shown without a new model call. | `deadline.test.ts` |
| P5 loading line | 0.1 d | Announced status text while billing loads | Manual |
| P6 checkout copy (RED) | 0.25 d | No server text reaches the student | `client.test.ts` and `test:billing` |
| History list and delete (frontend) | 1.5 d after backend | Per §4 contract | Contract tests |
| History backend (RPC, handler, migration) | 1.5–2 d | Owner-only, PGlite-tested | `test:billing`-style integration |
| E2E journey (Puppeteer, fake Stripe) | 2 d | Covers `critical-user-flows.md` steps 1–14 | — |

The repo has no DOM test environment (no jsdom), and adding one would be a new dependency.
UI logic is therefore moved into pure functions that the existing vitest setup can test.

## 8. Verification (16 October 2026)

| Check | Before (`6a7b9bf`) | After |
|---|---|---|
| `npx vitest run --exclude 'test/**'` | 337 passed | **354 passed** (17 new) |
| `node --test test/*.test.mjs` | 40 passed | 40 passed |
| `npm run build` (includes `tsc -b`) | passes | passes |
| `npm run test:billing` | 26 passed | 26 passed |
| `npm run test:beta` | 23 passed | 23 passed |
| `node test/attribution-integration.mjs` | 14 passed | 14 passed |

**P1, browser check** (headless Edge, 390px wide, `vite` dev server with the local account
store). Logged out, open `/beta/checkout?result=cancelled`, sign up:

| | Lands on | Shows |
|---|---|---|
| Before | `/beta/checkout` | "confirming your payment" |
| After | `/beta/checkout?result=cancelled` | "you have not been charged". No page errors. |

**Found on the way:** the existing test "only follows Stripe-hosted checkout URLs" never
reached `fetch`. In tests no billing endpoint is set, so `startCheckout()` threw before the
URL check. `startCheckout` now takes an optional endpoint, like `getBillingStatus` already
does, and the test proves that `fetch` was called.

**P2–P5, browser checks** (headless Edge, 390px, every `/api/*` call answered by request
interception, so nothing reached a real server):

| Check | Fake backend | Result |
|---|---|---|
| P5 | `GET /api/billing` answers after 5 s | "Getting My Aid ready…" in a `role=status` line, then the upload page |
| P4 | `POST /api/analyze` never answers; `GET` has a newer saved read | Preview shown after 72 s; **1** analysis request, no second AI call |
| P3 | `POST /api/analyze` never answers; nothing saved | Timeout message after 73 s; the Analyze button is usable again |
| P2 | Stripe never confirms | "Back to my analysis" is hidden for the first 15 s, then appears, and opens the preview at `/beta/results` |

No page errors in any run.

**Not verified:** the 10-minute return-page timeout itself (P2 was checked at the 15-second
"slow" state, which shows the same button). Not tested with a screen reader. Not tested
against production auth or Stripe.
