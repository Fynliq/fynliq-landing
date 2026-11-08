# Runbook: payments (FYNQ Beta Unlock, $1)

Contract: `docs/BILLING.md`. Owner: payments-agent. Every write in this runbook
is 👤 human-only.

## How it works
1. A locked account clicks unlock. `POST /api/billing {action:'checkout'}`
   creates (or reuses) a Stripe Checkout Session with
   `metadata.fynq_account_id` and `purpose=fynq_beta_unlock`.
2. Stripe sends `checkout.session.completed` (or `async_payment_*` or
   `expired`) to `/api/stripe-webhook`.
3. The webhook verifies the signature over the raw body, then calls
   `billing_stripe_event`. That RPC is idempotent on the event id, checks
   session ownership, `payment_status=paid` and exactly 100 USD cents, and
   writes `billing_entitlements` in **one transaction**.
4. The success page (`/beta/checkout?result=success`) only polls. It grants
   nothing.

The Stripe account connected to agent sessions is in **live** mode only, so
agents may only run GET requests. They request only the fields they need and
never copy customer names or emails into reports.

## Kill switch 👤
Set `PAYWALL_ENABLED=false` on the live environment (the env scope that
`www.fynliq.com` builds with; see `deployment.md`), then redeploy the live
branch.
Everyone becomes `access: 'open'` and nothing touches Stripe. Entitlements
already granted are kept.

## Symptoms → checks (agents: read-only)
| Symptom | Check |
| --- | --- |
| Paid but still locked | Stripe event for the session delivered? (GET events / webhook endpoint attempts) → `billing_stripe_events` row and its outcome → entitlement row. Common causes: webhook secret mismatch (400 "Invalid signature" in Vercel logs), webhook pointing at the wrong host, the DB RPC failing (500, Stripe retries). |
| Webhook 400s | `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint, or the body was parsed before verification. |
| Webhook 500s | The DB was unavailable. Stripe retries for up to 3 days, and the transaction rolled back, so the retry is clean. |
| Checkout 503 | Config missing: key, price, `BETA_ORIGIN`, or a live key without `STRIPE_ALLOW_LIVE_MODE=true`. |
| Revenue looks wrong | `billing_metrics()` excludes test/admin accounts and splits live and test. Compare with the Stripe dashboard (live). |

## Never automatic
Refunds, disputes, price, product or webhook changes, manual entitlement grants
or revocations, and changes to `PAYWALL_PILOT_EMAILS` or
`FYNQ_BETA_GRANDFATHER_CUTOFF`. A manual entitlement is a DB write (RED). The
human runs it with a written reason.

## Reconciliation (read-only, payments-agent)
Every active live entitlement must have a `billing_stripe_events` row with a
paid outcome for the same session and account, and the matching Stripe
Checkout Session must be `paid` with `amount_total=100`. Report discrepancies to
the human. Never fix them automatically.
