# FYNLIQ Intelligence v1

Daily, decision-ready intelligence for the CEO and COO, built on the data FYNQ
already collects. It answers six questions:

1. What happened?
2. What changed?
3. Where is the biggest bottleneck?
4. Why might it be happening? (Hypotheses, labelled as such.)
5. What should FYNLIQ do next?
6. Which metric shows whether that worked?

**v1 is read-only with respect to production business data.** It reads
aggregate counts and writes nothing to any business table. It never touches
Stripe, auth, RLS, deployments or user records.

Verified against `feat/connect-ask-backend` @ `6a7b9bf`, plus read-only
production metadata (catalog queries and aggregate counts only), on
2026-10-06.

---

## 1. Current architecture

```
 Student browser (React 18 SPA, Vite, TS strict)
   │  same-origin fetch, httpOnly __Host- cookies
   ▼
 Vercel Node functions  api/*.js  (thin)  →  server/*.js (logic, DI factories)
   │ service-role RPC            │ HTTPS                 │ HTTPS
   ▼                             ▼                       ▼
 Supabase Postgres 17         OpenAI Responses API     Stripe (LIVE mode)
 (one project = production)   store:false, redacted    Checkout + webhook
```

* **Live branch:** `feat/connect-ask-backend`. `www.fynliq.com` is aliased to
  its latest deployment. `main` is stale. Merging is a production deploy.
* **Functions:** `api/` holds 12 files: `account`, `activity`, `analyze`, `ask`,
  `auth/{login,logout,session,signup}`, `beta-admin`, `beta-auth`, `billing`
  and `stripe-webhook`. 12 is the Vercel Hobby-plan function limit, and the
  plan tier couldn't be read through the API. v1 therefore adds **no new
  function files**: intelligence is served by the existing admin function.
* **Data access:** every table has RLS on with no policies and is granted to
  `service_role` only. All access goes through `SECURITY DEFINER` RPCs with
  `search_path=''`.
* **Auth for the Command Center:** an admin OTP session (`__Host-fynliq_admin`
  cookie, `beta_sessions.kind='admin'`) whose user id is listed in
  `BETA_ADMIN_USER_IDS`. See `server/beta.js` `session(...,admin=true)` and
  `isAdmin`.
* **AI today:** `server/provider.js` calls the OpenAI Responses API with
  `store:false`, strict JSON schema output, and a privacy gate
  (`server/privacy.js assertSafeInput`). It's used by `/api/analyze` and
  `/api/ask`. It doesn't return token usage.
* **Env handling:** server-only variables are listed in `.env.example`.
  `VITE_*` values are public. Secrets are never prefixed with `VITE_`.
* **Tests and CI:** vitest (`src/**/__tests__`, `server/*.test.js`), node:test
  (`test/*.test.mjs`), PGlite integration suites, and the ops validator.
  `.github/workflows/ci.yml` runs them all on every PR.
* **Logging and monitoring:** `console.*` in functions (Vercel runtime logs).
  There's no error tracker, no alerting, and no OpenAI latency or cost metrics.
  `docs/architecture.md` lists these as gaps. Uptime checks are an open PR
  (#17).

## 2. Command Center: where its data comes from

The Command Center is **`/admin`**: `src/pages/BetaAdmin.tsx` →
`GET /api/beta-admin` → four aggregate RPCs.

| Command Center block | RPC | Source tables | Time shape |
| --- | --- | --- | --- |
| FYNQ Beta Unlock ($1) funnel and revenue | `billing_metrics(p_cutoff, p_test)` → `billing_mode_metrics` | `monetization_events`, `billing_checkouts`, `billing_entitlements`, `upload_events`, `beta_questions` | **All-time only**; live and test mode split; admin/test accounts excluded |
| Document uploads | `upload_metrics()` | `upload_events` | totals, today, 7 days, and **by UTC day** |
| Accounts | `account_metrics()` | `accounts`, `account_events`, `account_guests`, `beta_questions`, `upload_events` | totals, today, 7 and 30 days, and **by UTC day**. Also returns every account's **email** (PII) |
| Guest usage (DAU/WAU/MAU, questions) | `beta_metrics()` | `anonymous_users`, `beta_questions` | totals, today, 7 and 30 days; guest sign-ups **by day, week and month**. Also returns every guest id |

Not shown in the Command Center today: attribution (`acquisition_attribution`,
collected since 2026-10-06), and the production-only `usage_metrics()` and
`product_metrics()` (see Drift).

## 3. Existing analytics, by metric

✅ reliable · ◐ partial or caveated · ✗ not collected

| Metric | Status | Source of truth | Caveat |
| --- | --- | --- | --- |
| Visitors | ◐ | `anonymous_users.created_at` (a guest browser is created on the first page load with JS, `api/beta-auth.js` `guest`) | Counts **new browsers**, not people. Cleared cookies or a new device create a new one. Bots without JS aren't counted. Admin browsers can't be excluded. Vercel Analytics also counts pageviews, but that data lives in Vercel, not Supabase. |
| Sessions | ✗ | — | No session or visit log exists. |
| Returning users | ◐ | Activity by accounts created before the window: `account_events` log-ins, `upload_events`, `monetization_events`, Ask questions via `account_guests` | Account-level only. Guest return visits only update `acquisition_attribution.last_seen_at` (it overwrites, so there's no history). |
| Account registrations | ✅ | `accounts.created_at` (`account_events.signed_up`) | Test and admin accounts are excluded by id where configured. |
| Aid uploads | ✅ | `upload_events` (outcome, files, figures, reason code) | One row per upload **batch** (1–3 files). |
| Failed uploads | ✅ | `upload_events.outcome <> 'read'` (`no_aid_lines`, `unreadable`, `privacy_blocked`, `reader_error`) | |
| Ask FYNLIQ questions | ✅ | `beta_questions` (state: pending, success or failed) | Per guest browser. Linked to accounts through `account_guests`. |
| Pricing / paywall views | ◐ | `monetization_events` `paywall_viewed`, `aid_preview_viewed` | Recorded **only for paywall-eligible accounts** (post-cutoff, and in the pilot when `PAYWALL_PILOT_EMAILS` is set). Grandfathered users never appear. |
| Checkout starts | ✅ | `monetization_events.checkout_created` (server-side), `billing_checkouts` | Eligible accounts only, by design. |
| Successful payments and revenue | ✅ | `billing_checkouts.status='paid'`, `paid_at`, `amount_total` (written only by the signature-verified webhook) | Live mode only, test accounts excluded. |
| Failed payments | ✅ | `billing_stripe_events.outcome in ('payment_failed','expired')` | Low volume. Card declines inside Checkout never reach FYNQ. |
| Traffic source / TikTok | ◐ | `acquisition_attribution` first touch (`channel`, `source`, `campaign`, `content`) | Only since 2026-10-06. Everything earlier is `legacy`. UTM text is user-controlled, so **only the channel enum is sent to the AI**. |
| Errors | ◐ | Failed Ask answers (`beta_questions`), `reader_error` uploads, Stripe failures | No client JS errors and no API 5xx counts in the database. Those are only in Vercel logs. |

Production volume on 2026-10-06 (aggregate counts only): 259 guest browsers,
37 accounts, 30 upload batches, 5 Ask questions, 9 live checkout sessions,
3 live payments. **Nearly every rate is a small sample.** Intelligence v1 is
built to say so, not to hide it.

## 4. Missing data (needed for better intelligence)

1. **Sessions or visits.** Without them, "visitors" means new browsers and
   returning-guest analysis has no history. Proposal: a content-free
   `visit_started` event (guest id, time, channel enum), deduplicated per 30
   minutes. The production-only `record_event()` already does this kind of
   deduplication (see Drift), so reconcile with it first.
2. **Daily billing series.** `billing_metrics` is all-time only. v1 fixes this
   for intelligence with a new read-only RPC (§6). The existing admin table is
   unchanged.
3. **Paywall funnel for everyone.** Grandfathered users emit no
   `monetization_events`. That's fine for revenue analysis, but the My Aid
   engagement funnel is then only visible for post-cutoff accounts.
4. **API error and latency metrics** (5xx counts, OpenAI latency and cost).
   These are Vercel logs only. Phase 2 of `docs/architecture.md`.
5. **Admin and internal traffic exclusion** for guest browsers.
6. **Return visits** (critical journey step 14 is ✗).

See `docs/fynliq-event-taxonomy-audit.md` for the step-by-step funnel audit.

## 5. Drift that affects analytics (production vs. git)

Read-only catalog inspection on 2026-10-06 found:

* Migration records not in git: `milestones`, `page_analytics`.
* Functions not in git: `product_metrics()`, `usage_metrics(p_days)`,
  `record_event(p_account, p_guest, p_event, p_window)`, and `milestone_*`.
* `public.events` in production has an extra `account_id` column and extra
  event types (`my_aid_viewed`, `search_viewed`, `ask_fynliq_viewed`,
  `upload_started`, `upload_completed`, `upload_failed`, `search_submitted`).
* `events` holds `upload_completed` and `upload_failed` rows up to 2026-10-05,
  but **no code in this repository calls `record_event`**. Either a deployment
  was built from code that isn't in git, or something else writes to the
  database. 👤 The human should reconcile this. Intelligence v1 does **not**
  read these drift objects. It reads only objects defined in
  `supabase/migrations/`.

## 6. Proposed (and implemented) AI architecture

```
FYNLIQ PRODUCT            (SPA + api/*)
      ↓
EVENT / BUSINESS DATA     (upload_events, accounts, monetization_events, billing_*, …)
      ↓
SUPABASE                  intelligence_metrics(p_windows, p_test, p_livemode)
      ↓                   read-only, aggregate, content-free, service_role only
FYNLIQ INTELLIGENCE SERVICE   server/intelligence/snapshot.js
      ↓                   time windows · fallback to existing RPCs · sanitizer
DETERMINISTIC METRIC ENGINE   server/intelligence/metrics.js
      ↓                   rates · % changes · zero-division guards · sample-size
      ↓                   warnings · bottleneck and biggest-change candidates
AI REASONING LAYER        server/intelligence/analyst.js  (FynliqAnalyst)
      ↓                   provider abstraction · strict JSON schema · validator ·
      ↓                   number grounding · causal-language guard · 1 retry
STRUCTURED CEO BRIEF      validated JSON (never raw model text)
      ↓
COMMAND CENTER            /admin → "FYNLIQ Intelligence" section
```

**The LLM computes nothing.** Every count, rate, percentage change, sample
size and candidate ranking is computed in code. The model chooses among
computed candidates (enums), writes the narrative, and proposes hypotheses.
Any number in its prose must already appear in the snapshot, or the output is
rejected.

### Time windows (all UTC)

| Window | Definition |
| --- | --- |
| Current period | The last complete UTC day (`period=day`, default) or the last 7 complete days (`period=week`) |
| Previous equivalent period | The same length, immediately before |
| Trailing 7-day average | The 7 days before the current period, normalised to the period length |
| Trailing 30-day average | The 30 days before the current period. `null` when the data history is shorter than 30 days |
| Today so far vs yesterday at the same time | A partial day compared like-for-like (yesterday from 00:00 to the same clock time) |

Counts compare per-day averages. Rates use pooled rates (Σ numerator ÷
Σ denominator), never averages of daily rates.

**Conversion rates are compared only against windows of the same length.**
They are cohort-in-window: a longer window gives its cohort more time to reach
the next step, so a 7-day or 30-day rate is structurally higher than a 1-day
rate even when nothing changed. For `period=day`, the trailing 7-day and 30-day
rates are still reported (as context, `reason: "different_window_length"`, no
`changePercent`), but only the previous day is a baseline. For `period=week`,
the previous 7 days are the baseline and the 30-day rate is context only.
Counts are unaffected (per-day averages are fair at any window length).

### Conversion definitions (cohort-in-window, always 0–1)

| Rate | Numerator ÷ denominator |
| --- | --- |
| `visitorToSignup` | New browsers in the window that are linked to an account created in the window ÷ new browsers |
| `signupToUpload` | Accounts created in the window with an upload batch in the window ÷ accounts created |
| `uploadToCheckout` | Paywall-eligible accounts that completed an aid upload in the window and started checkout in the window ÷ eligible uploaders (accounts already entitled before the window are excluded: they can't start checkout) |
| `checkoutToPayment` | Accounts that started checkout in the window and paid (live, verified) in the window ÷ checkout starters |
| `visitorToPayment` | New browsers in the window whose account paid in the window ÷ new browsers |
| `uploadReadRate` | Upload batches read successfully ÷ upload batches |
| `answerSuccessRate` | Ask questions answered ÷ Ask questions |

Sample-size rules: a rate whose denominator is under 10 is `very_small`, and
under 30 is `small`. Percentage changes on counts under 10 are flagged as
unreliable. A zero base gives `changePercent: null` with a reason, never
`Infinity` or `NaN`. A step nobody entered has a `null` rate with the note
`no_one_entered_this_step`; it is still *available* data (only metrics the data
source doesn't provide are listed in `unavailable`).

Admin and test accounts (`BETA_ADMIN_USER_IDS`, `FYNQ_BILLING_TEST_ACCOUNT_IDS`,
`is_test_account`) are excluded from sign-ups, uploads, Ask questions (through
the guest browsers linked to them), the paywall funnel and revenue. Guest
browsers that never signed in can't be excluded (see Missing data).

### Where intelligence is served (no new Vercel functions)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/beta-admin?view=intelligence-snapshot&period=day\|week` | The deterministic snapshot. Admin session required. No AI call. |
| `POST /api/beta-admin` `{"action":"intelligence-brief","period":"day"}` | Builds the snapshot and runs FynliqAnalyst. Admin session, same-origin check, DB rate limit (5/min). Returns the validated brief or a controlled error. |

The spec suggested `/api/internal/intelligence/snapshot`. That path would need
a new function file (over the Hobby limit) or a `vercel.json` route (a RED
file). It's easy to add later; see §9.

## 7. Security and privacy decisions

* **Aggregates only.** The new RPC returns counts and sums. It returns no ids,
  emails, UTM text, referrers, question text or aid figures.
* **The existing RPCs' PII never leaves the server.** In fallback mode the
  snapshot reads only the `*_by_day` series from `account_metrics`,
  `upload_metrics` and `beta_metrics`. Emails and id lists are discarded
  immediately.
* **Sanitizer before every model call** (`server/intelligence/sanitize.js`). It
  keeps an allow-list of keys and value shapes, drops any string with `@`, a
  UUID or a long digit run, and then runs `assertSafeInput` from
  `server/privacy.js` on the serialised payload. It fails closed.
* **Untrusted text:** attribution `source`, `campaign` and `content` are
  user-controlled (UTM tags), so they are never sent to the model. Only the
  fixed `channel` enum is sent.
* **Provider call:** `store:false`, strict JSON schema, bounded output tokens,
  timeout.
* **Access:** admin session plus the `BETA_ADMIN_USER_IDS` allow-list. POST
  needs a same-origin check and a DB-backed rate limit (5/min), which bounds
  model-cost abuse. The snapshot GET is rate limited too (30/min), because
  each call scans several tables for six windows.
* **Time budget:** one brief has 50 s for all model attempts (the function's
  `maxDuration` is 60 s). Each attempt's provider timeout is the time left,
  capped at 45 s, and the retry is skipped when under 12 s remain, so a slow
  model ends in a logged `502 brief_unavailable`, never a platform 504.
* **Validator:** besides digits, it rejects numbers written as words, multipliers
  ("double", "3x") and numeric forecasts ("would add 20 …"), so an invented
  projection can't reach the CEO in another form.
* **SQL:** only `intelligence_metrics` (which validates its windows) is
  executable by `service_role`. The inner `intelligence_window` has no bounds
  and is callable only from inside it.
* **Logging:** one structured line per request. It holds metadata only
  (§8), never the snapshot or the brief.
* **Read-only:** the new RPC only runs `SELECT`s. Nothing in v1 writes
  business data.

## 8. Observability

Each brief request logs one JSON line (`type: "fynliq_intelligence"`) to the
Vercel runtime logs with: `requestId`, `timestamp`, `agent`, `provider`,
`model`, `latencyMs`, `success`, `attempts`, `inputTokens`, `outputTokens`,
`estimatedCostUsd`, `schemaValid`, `groundingValid`, `errorCode` and
`dataSource` (`rpc` or `fallback`). Cost is estimated only when
`INTELLIGENCE_COST_INPUT_PER_MTOK` and `INTELLIGENCE_COST_OUTPUT_PER_MTOK` are
set. Prices are never hard-coded. The `requestId` is returned to the Command
Center so a brief can be matched to its log line.

A snapshot that falls back to the existing RPCs (because `intelligence_metrics`
couldn't be read: not applied yet, or a database error) also writes a line, with
`agent: "snapshot"`, `errorCode: "intelligence_metrics_unavailable"` and
`dataSource: "fallback"`, so a broken RPC is visible rather than silently
degraded.

## 9. Extension points (not implemented)

`server/intelligence/agents.js` registers agents by id. Only
`fynliq-business-analyst` is active. These are registered as `planned` with no
code: `customer-voice`, `growth`, `revenue`, `product`, `knowledge`, `qa`,
`engineering`. A new agent adds a prompt, an output schema and a validator,
and reuses the snapshot, sanitizer, provider and observability layers.

The future student-facing Ask architecture (intent → trusted retrieval →
deterministic tools → reasoning → validation → sources and confidence) reuses
the same provider abstraction and validation pattern. It's **not** built in
v1.

## 10. Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `INTELLIGENCE_ENABLED` | unset (off) | Must be exactly `true` for the brief. The snapshot works whenever admin works. |
| `INTELLIGENCE_PROVIDER` | `openai` | The only implemented provider. |
| `INTELLIGENCE_MODEL` | falls back to `OPENAI_MODEL` | |
| `INTELLIGENCE_MAX_OUTPUT_TOKENS` | `1500` | 1–4000 |
| `INTELLIGENCE_COST_INPUT_PER_MTOK` / `_OUTPUT_PER_MTOK` | unset | USD per million tokens, for cost estimates only |

`OPENAI_API_KEY` is reused. All of these are server-only.

## 11. Production changes that need human approval

1. **Apply `supabase/migrations/202610060003_intelligence_metrics.sql`** to
   production. It's additive: two new read-only functions, `service_role` only.
   Rollback: `drop function public.intelligence_metrics(jsonb, uuid[], boolean);
   drop function public.intelligence_window(timestamptz, timestamptz, uuid[], boolean);`.
   Until it's applied, the Command Center uses the fallback (visitors,
   sign-ups and uploads only) and says so.
2. **Set `INTELLIGENCE_ENABLED=true`** (and optionally `INTELLIGENCE_MODEL`) in
   Vercel for the live branch. Until then, the brief endpoint returns
   `503 intelligence_disabled`.
3. **Merge** the PR into `feat/connect-ask-backend`. That's a production
   deploy.

Order: the migration and the code are independent. Either can go first.

## 12. Known limitations (v1)

* **No daily spending cap on briefs.** The brief POST is limited to 5 a minute
  per IP address (each brief makes at most 2 model calls), not per admin per day.
  A per-day cap needs a small counter table, so it's a follow-up.
* **Week view:** the previous period and the trailing 7 days are the same
  window, so that comparison appears twice.
* **Guest-only admin traffic** (an admin browser that never signed in) still
  counts as visitors.
* **The live model has not been evaluated.** `npm run eval:intelligence` runs
  the 10 scenarios against the real provider and needs an API key and human
  approval. CI covers the deterministic engine and the validator.
