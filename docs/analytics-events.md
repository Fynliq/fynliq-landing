# FYNQ analytics events

The one canonical event model. Every product event FYNQ records lives in
`public.analytics_events` (migration `202610070001_observability.sql`). Code:
`server/analytics.js` (server, the only writer) and `src/analytics/events.ts`
(browser, sends through `POST /api/activity`).

**Names are stable.** Never rename an event. Add a new one and keep the old
one. Dashboards, milestones and reports depend on these names.

## Schema

| Field | Meaning | Source |
| --- | --- | --- |
| `event_id` | UUID, primary key. Browser events carry the browser-generated id, so a retried send is stored once. | browser or server |
| `event_name` | One of the names below (enforced by a CHECK constraint). | caller |
| `occurred_at` | Server time when stored (UTC). | database |
| `side` | `client` or `server`: who observed it. | server |
| `anonymous_session_id` | The guest browser id (`anonymous_users.id`) from the httpOnly `__Host-fynliq_beta` cookie. | server, from cookie |
| `user_id` | The account id from the httpOnly `__Host-fynliq_account` cookie. | server, from cookie |
| `dedupe_key` | Makes once-only events unique (see "De-duplication"). | server |
| `channel`, `source`, `medium`, `campaign`, `content`, `referrer`, `landing_page` | First-touch attribution snapshot, copied by the database from `acquisition_attribution`. Callers can't set or forge these. | database |
| `device_type` | `mobile`, `tablet`, `desktop` or `unknown`, bucketed from the User-Agent. The raw UA is never stored. | server |
| `browser` | `safari`, `chrome`, `firefox`, `edge`, `samsung`, `tiktok`, `instagram`, `facebook` or `other`. | server |
| `school` | Reserved. Not collected yet; FYNQ doesn't ask for it. | — |
| `experiment_id` | Optional `[a-z0-9_-]{1,40}`. No experiments run yet. | browser or server |
| `livemode` | Money events only: Stripe live (`true`) or test (`false`). Funnel and revenue count live only. | server |
| `is_test` | True for admin and test accounts (`BETA_ADMIN_USER_IDS`, `FYNQ_BILLING_TEST_ACCOUNT_IDS`). Excluded from every metric. | server |
| `metadata` | Small allow-listed object (below). At most 1 KB. | server-sanitized |

`source` in the brief maps to `channel` (tiktok, instagram, facebook, google,
referral, direct, other) plus the raw `utm_source` in `source`.

### Allowed metadata keys
`reason` (code), `view` (`preview` or `full`), `kind`, `outcome`, `error_name`,
`source_file` (our own `/assets` bundle name), `path` (an allow-listed route),
`stripe_outcome`, `files` (0–3), `figures` (0–40), `ai_ms`, `duration_ms`,
`second_pass`, `duplicate`, `reused`. Any other key is dropped silently by
`sanitizeMetadata()`.

### Never stored
SSNs, student IDs, names, emails, passwords, document text, file names, aid
figures, quotes, free text, error messages, full URLs or query strings, IP
addresses and raw user agents. The tests assert this: they push names, SSNs,
emails and dollar amounts through every path and check none of them arrive.

## Events

| Event | Fires where | Side | Data | De-duplication | Tested in |
| --- | --- | --- | --- | --- | --- |
| `landing_view` | `POST /api/beta-auth {action:'guest'}`: the app's first call on every page load (`api/beta-auth.js`) | server | guest, attribution, device, browser | once per person per UTC day | `test/observability-integration.mjs` (first visit, repeat visit) |
| `return_session` | Same call, plus `GET /api/auth/session` for logged-in visits | server | guest and/or account | once per person per day, **only** if the same person was seen on an earlier day (checked in SQL) | integration: same day = none, later day = one |
| `signup_started` | Sign-up form shown (`src/pages/Auth.tsx`) | client | — | once per page load | `src/analytics/__tests__/events.test.ts` |
| `signup_completed` | Account created (`server/account-login.js`, after `account_signed_up`) | server | account + guest (joins them) | once per account, ever | integration: guest → account join, second attempt ignored |
| `login_completed` | Successful log-in (`server/account-login.js`) | server | account + guest | none (each log-in counts) | integration |
| `login_failed` | Wrong credentials | server | guest only, `reason: credentials`. No email, no account id. | none | integration: no email stored |
| `my_aid_viewed` | My Aid upload screen shown (`src/billing/client.ts` ← `BetaUpload`). **This is a "qualified session".** | client | — | once per person per day | unit + integration |
| `upload_started` | Student picked files and pressed analyse (`BetaUpload`) | client | — | event id | unit |
| `upload_completed` | Redacted text reached the server (`api/analyze.js`) | server | `files` | none | CI integration (billing suite exercises the path) |
| `upload_failed` | Server: unreadable, no aid lines or privacy block (`server/upload-tracking.js`). Browser: network or format failures the server never saw (`BetaUpload`). | both | `reason` code, `files` | event id | unit + integration |
| `analysis_started` | Reader begins (`api/analyze.js`) | server | — | none | — |
| `analysis_completed` | Reader read figures (`server/upload-tracking.js`, outcome `read`) | server | `files`, `figures`, `ai_ms`, `second_pass` | none | billing suite |
| `analysis_failed` | Model or provider error (outcome `reader_error`) | server | `ai_ms` | none | — |
| `results_viewed` | Preview or full result shown | client | `view` | event id | unit + integration (metadata scrubbing) |
| `checkout_viewed` | $1 unlock card shown | client | — | once per person per day | — |
| `checkout_started` | Stripe Checkout Session created (`api/billing.js`) | server | `livemode`, `reused` | once per Checkout Session; a reused session doesn't count again | integration |
| `payment_completed` | **Verified Stripe webhook only** (`api/stripe-webhook.js`), outcome `entitlement_activated` or `already_entitled` (the latter with `duplicate: true`) | server | `livemode`, `stripe_outcome` | once per Checkout Session; duplicate deliveries record nothing | integration: duplicate delivery, forged signature |
| `payment_failed` | Webhook `async_payment_failed` | server | `livemode` | once per Checkout Session | integration: account stays locked |
| `checkout_expired` | Webhook `checkout.session.expired` | server | `livemode` | once per Checkout Session | — |
| `unlock_verified` | Webhook activated the entitlement | server | `livemode` | once per Checkout Session | integration |
| `client_error` | Uncaught browser error or rejection (`src/main.tsx`) | client | `error_name`, `source_file`, `path` | max 5 per page load | unit: message never sent |

The browser can never send a sign-up, log-in, analysis, checkout or payment
event: `/api/activity` accepts only the client names above and drops the
rest.

**Payment truth.** Revenue and paid counts in reports come from
`billing_checkouts` and `billing_entitlements`, which only the verified
webhook writes, not from these events (`ops_revenue()`). The events exist for
funnel analysis. The success page grants nothing and records nothing.

## Identity: anonymous → logged in
Every browser gets a guest id on its first visit. When it signs up or logs in,
`account_guests` links the guest to the account. The funnel query
(`ops_funnel`) counts a person as the account when known, and otherwise
follows the guest's link to an account. So a visitor who later signs up is
**one** person, and pre-signup steps join their account. Body-supplied ids
are ignored everywhere.

## Reliability
- **Failure-safe.** `recordEvents()` never throws and gives up after 1.2 s.
  On Vercel, the write happens after the response (`waitUntil`). The browser
  queue never throws, batches for 400 ms, and sends with `keepalive`.
  Integration tests run with analytics failing and hanging, and the student's
  request still succeeds in time.
- **Previews and local dev send nothing.** Only `www.fynliq.com` and
  `fynliq.com` production builds send browser events.
- **Order vs deploy.** The code is safe before the migration is applied:
  events are dropped and nothing breaks. Apply the migration first so no data
  is lost.

## API request log (product health)
`public.api_requests`: route, method, status, duration, failed database calls
and the thrown error's class name, for every `/api` call (`observe()` in
`server/observability.js`). No URLs, query strings, bodies, IPs or messages.
Uptime probes are flagged `synthetic` and excluded from metrics. Rows older
than 30 days are trimmed.

## Reading the numbers
Only through the read-only aggregate functions, never raw rows:

| Function | Returns |
| --- | --- |
| `ops_funnel(since, until, segment, test_ids)` | Unique people per step, by `none`, `source`, `campaign`, `content`, `device`, `browser`, `school`, `date` or `experiment` |
| `ops_revenue(since, until, test_ids)` | Live-mode checkout starts, payments, revenue (cents), failures, webhook outcomes |
| `ops_health(since, until)` | Requests, 4xx/5xx, error rate, p50/p95 latency per route, AI success rate and latency, auth failures, webhook failures, frontend errors |
| `ops_milestone_metrics(test_ids)` | The inputs to `ops/milestones.yaml` |
| `ops_applied_migrations()` | Migration names applied in production (drift check) |

They are `STABLE` and are called over HTTP GET (`rpcRead`), which PostgREST
runs in a read-only transaction. Agents reach them through the bearer-token
view `GET /api/beta-admin?view=ops` (`server/ops-metrics.js`) or, read-only,
through the Supabase connector. The production guard hook allows only these
functions in agent SQL.
