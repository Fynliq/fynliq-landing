# FYNQ architecture

Verified against the code on `feat/connect-ask-backend` (55b43cf) and read-only
production metadata on 2026-10-06. Where this file and `docs/DEPLOYMENT.md`
disagree about branches, this file is current.

## System diagram

```
 Student phone / in-app browser
 ┌───────────────────────────────────────────────────────────────┐
 │ React 18 SPA (Vite, TS strict, CSS modules, custom router)     │
 │  • pdf.js + tesseract.js read files ON DEVICE                  │
 │  • server/redact.js (shared) removes PII ON DEVICE             │
 │  • Vercel Analytics: allow-listed paths only                   │
 └──────────────┬────────────────────────────────────────────────┘
                │ same-origin fetch, httpOnly __Host- cookies
 ┌──────────────▼────────────────────────────────────────────────┐
 │ Vercel Node functions  api/*.js  (thin) → server/*.js (logic)  │
 │  beta-auth   guest + admin OTP     auth/*   accounts           │
 │  analyze     reader + paywall gate ask      Ask Fynliq         │
 │  billing     $1 checkout           stripe-webhook  entitlement │
 │  beta-admin  /admin metrics        account, activity → 410     │
 └──────┬──────────────────┬─────────────────────┬───────────────┘
        │ service-role RPC │ HTTPS               │ HTTPS
 ┌──────▼─────────┐  ┌─────▼──────────────┐  ┌───▼──────────────────┐
 │ Supabase (prod)│  │ OpenAI Responses   │  │ Stripe (LIVE)        │
 │ Postgres 17    │  │ store:false,       │  │ Checkout + webhook   │
 │ Auth (email)   │  │ redacted text only │  │ → /api/stripe-webhook│
 └────────────────┘  └────────────────────┘  └──────────────────────┘
```

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | SPA. `core/` holds pure money maths; `beta/`, `ask/`, `search/` and `auth/` hold contracts plus HTTP and stub implementations; `pages/`, `components/`, `router/` |
| `api/` | One file per Vercel function. Each exports `create*Handler(deps)` and a default instance |
| `server/` | Business logic: sessions (`beta.js`, `account-login.js`), reader (`redact.js`, `financial-document.js`, `aid-overview.js`, `summary.js`, `provider.js`), billing (`billing.js`, `stripe.js`), `attribution.js`, `upload-tracking.js` |
| `supabase/migrations/` | Ordered SQL. The source of truth for schema, except for the drift listed below |
| `test/` | PGlite integration suites (`*-integration.mjs`) and `node:test` unit files (`*.test.mjs`) |
| `docs/` | API contracts, setup notes, screenshot harnesses (excluded from deploys by `.vercelignore`) |

## Data model (public schema; 17 tables from this repo's migrations)

All tables have RLS on with no policies and are granted to `service_role`
only. All access goes through `SECURITY DEFINER` RPCs with
`search_path=''`.

| Area | Tables | Key RPCs |
| --- | --- | --- |
| Guest beta | `anonymous_users`, `beta_sessions`, `beta_invites`, `beta_questions`, `beta_rate_windows`, `events` | `beta_guest`, `beta_session`, `beta_rate`, `beta_reserve_question`, `beta_metrics` |
| Accounts | `accounts`, `account_sessions`, `account_guests`, `account_events` | `account_start_session`, `account_session`, `account_metrics` |
| Reader | `upload_events`, `aid_analyses` (30-day verified figures) | `record_upload`, `aid_analysis_save`, `aid_analysis_get`, `upload_metrics` |
| Billing | `billing_checkouts`, `billing_entitlements`, `billing_stripe_events`, `monetization_events` | `billing_access`, `billing_checkout_created`, `billing_stripe_event`, `billing_track`, `billing_metrics` |
| Attribution | `acquisition_attribution` | (see `202610060001`) |

Production also has objects that don't come from these migrations (see "Drift"
in `ops/runbooks/database.md`).

## Environments

| | Code | Data |
| --- | --- | --- |
| **Live** (`www.fynliq.com`) | Latest `feat/connect-ask-backend` deployment, via the branch alias | Prod Supabase, **live Stripe** |
| Vercel "production" target | `main` (behind the live branch). In practice only the `fynliq.com` redirect | Prod Supabase |
| Other branch previews | Any branch. Server APIs fail closed without the live config | Not intended to serve users |
| Local / CI | Any | PGlite, fake Stripe, fake OpenAI |

Env var scoping per environment is managed by the human in Vercel. Agents never
change or decrypt it.

## Security model (summary)
Cookies are `__Host-`, httpOnly and Secure, and stored hashed. Identity is never
taken from request bodies. Same-origin checks and DB-backed rate limits apply.
PII is redacted twice and blocked before the model. Entitlements come only from
the verified webhook. Locked accounts never receive figures. Secrets are
server-only, and `VITE_*` values are public. Details are in
`.claude/agents/security-agent.md`.

## Engineering gaps (2026-10-06)

| Area | Gap | Proposed phase |
| --- | --- | --- |
| Branching | Live code on a `feat/` branch; `main` behind | Human decision, before phase 2 |
| CI | None before this PR. Added `.github/workflows/ci.yml` (build, unit, PGlite integration, ops validation) | 1 (this PR) |
| Lint | No ESLint or Prettier configured | 2 |
| E2E | No automated journey test; screenshot harnesses are manual | 2 |
| Observability | Error tracking, alerting, log retention, uptime, and OpenAI latency and cost metrics | 2 |
| "Qualified session" | Undefined | 2 |
| Test wiring | `npm test` (vitest) also collects the `node:test` files in `test/`; `attribution-integration.mjs` has no npm script. CI runs them correctly. | 2 |
| Schema drift | Production has migration records not in git | Human decision |
| Staging | None | Later |
| Security hardening | Tracked privately by the operator, not in this public repo | Human |
