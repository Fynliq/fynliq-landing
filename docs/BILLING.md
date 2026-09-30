# FYNQ Beta Unlock ($1, one-time)

A new student creates a free account and logs in. My Aid opens at **Step 1 ·
Unlock**: the one-time $1 FYNQ Beta Unlock. Stripe Checkout opens in the same
tab; once Stripe's signed webhook confirms payment, the student lands on
**Step 2 · Upload** and carries on exactly as before (Analyse, Your answer).
One payment unlocks the account for the rest of the beta.

Because the unlock comes before any document is chosen, no aid content ever
waits on, or travels with, a payment.

Accounts created at or before the cutoff are grandfathered and see the
original three-step flow with no unlock. With `PAYWALL_ENABLED` unset or
anything but exactly `true`, nothing changes for anybody.

## Flow

```
signup (free) → log in → My Aid
  locked (post-cutoff, unpaid):
    Step 1 Unlock → "Unlock My Aid — $1" → POST /api/billing {action:'checkout'}
      → Stripe Checkout (same tab)
      → POST /api/stripe-webhook (signature verified) → entitlement
      → /beta/checkout?result=success polls GET /api/billing (never trusts the URL)
      → "Payment confirmed" → Step 2 Upload → Step 3 Analyse → Step 4 Your answer
  grandfathered / test / paywall off: Upload → Analyse → Your answer (unchanged)
  /api/analyze answers 402 beta_unlock_required to any locked account, whatever the page did
```

The step bar numbers 1–4 (Unlock, Upload, Analyse, Your answer) for
post-cutoff accounts, locked or paid, and 1–3 for everyone else.

## Who pays (server-side, in `server/billing.js`)

| Condition | Result |
| --- | --- |
| `PAYWALL_ENABLED` is not exactly `true` | open, as before; billing code touches nothing |
| id in `FYNQ_BILLING_TEST_ACCOUNT_IDS` or `BETA_ADMIN_USER_IDS` | allowed; excluded from revenue/conversion |
| `accounts.created_at <= FYNQ_BETA_GRANDFATHER_CUTOFF` | grandfathered, never pays |
| active row in `billing_entitlements` | unlocked |
| otherwise | `402 {"code":"beta_unlock_required","message":"Unlock My Aid to continue."}` |

The comparison runs in Postgres (`billing_access`) so the cutoff keeps its
microseconds: `2026-09-30T18:53:52.654622Z` is grandfathered,
`…654623Z` is not. After applying the migration, confirm the count:

```sql
select count(*) from public.accounts where created_at <= '2026-09-30T18:53:52.654622Z';  -- expect 20
```

## Environment (server-only; never `VITE_`)

| Variable | Notes |
| --- | --- |
| `PAYWALL_ENABLED` | `false` until reviewed. Only the exact string `true` turns it on. |
| `PAYWALL_PILOT_EMAILS` | optional comma-separated emails. When set, only these accounts see the paywall; everyone else is unaffected. Use it to test on www.fynliq.com, then remove it. |
| `STRIPE_SECRET_KEY` | `sk_test_…` first. Live keys are refused unless `STRIPE_ALLOW_LIVE_MODE=true`. |
| `STRIPE_PRICE_ID` | the one-time $1.00 USD price of product "FYNQ Beta Unlock". |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` for the endpoint below. |
| `STRIPE_ALLOW_LIVE_MODE` | leave `false` until you deliberately go live. |
| `FYNQ_BETA_GRANDFATHER_CUTOFF` | defaults to `2026-09-30T18:53:52.654622Z`; a malformed value fails closed (503). |
| `FYNQ_BILLING_TEST_ACCOUNT_IDS` | comma-separated account ids that bypass payment. |

Existing `BETA_ENABLED`, `BETA_ORIGIN`, `BETA_RATE_SECRET` and the Supabase
variables are reused. `BETA_ORIGIN` builds Stripe's success/cancel URLs.

## Stripe Dashboard (test mode first)

1. Product **FYNQ Beta Unlock**, one-time price **$1.00 USD** → `STRIPE_PRICE_ID`.
2. Webhook endpoint `https://www.fynliq.com/api/stripe-webhook`, events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`
   → signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Leave automatic tax, promotion codes and adjustable quantity **off**: the
   webhook only activates an entitlement for exactly 100 USD cents (anything
   else is recorded as `amount_mismatch` and unlocks nothing).
4. Test with card `4242 4242 4242 4242` (success) and `4000 0000 0000 0002`
   (declined), and cancel once from the Checkout page.

## What Stripe receives

`mode=payment`, the price id, quantity 1, `client_reference_id` and
`metadata[fynq_account_id]` (the FYNQ account id), `metadata[purpose]`, the
account email as `customer_email` (for the receipt), success/cancel URLs and an
expiry. Never document text, figures, file names or files.

## Database

`supabase/migrations/202609300001_beta_unlock_billing.sql` (apply after review):
`billing_checkouts`, `billing_entitlements`, `billing_stripe_events`
(idempotency) and `monetization_events` (content-free funnel). Nothing about
any student's documents. RLS on, revoked from `anon` and
`authenticated`; all functions are `SECURITY DEFINER`, service role only. No
card data.

## Metrics (/admin → "FYNQ Beta Unlock ($1)")

Live and Stripe test mode are reported separately; admin/test accounts are
excluded. Funnel, in the order a student meets it: entered My Aid → unlock
viewed → unlock clicked → checkout created → checkout completed → payment
confirmed → entitlement activated → documents selected → analysis started →
analysis completed. Also gross
revenue, paid accounts, grandfathered accounts, duplicate payments to refund,
and paid-user uploads (batches, files, uploaders) and answered questions, each
as its own number.

## Tests

- `npm test` — includes `server/billing.test.js` and `src/billing/__tests__`.
- `npm run test:billing` — end-to-end billing against Postgres with every
  migration (PGlite by default, or `BILLING_TEST_PSQL_DB=<db>` for a local
  Postgres via `psql`), fake Stripe and fake OpenAI.

## Testing on the live site (pilot)

1. Set `PAYWALL_ENABLED=true` and `PAYWALL_PILOT_EMAILS=<your new test account email>` with **test-mode** Stripe keys.
2. Create that account on www.fynliq.com (it must be created after the cutoff), then pay with `4242 4242 4242 4242`.
3. Everyone else, including other new accounts, sees no change.

## Going live (not part of this change)

1. Apply the migration; run the count check above.
2. Test mode end to end with `PAYWALL_ENABLED=true` on a preview with test keys.
3. Swap to live price, key and webhook secret; set `STRIPE_ALLOW_LIVE_MODE=true`.
4. Set `PAYWALL_ENABLED=true` in production.
