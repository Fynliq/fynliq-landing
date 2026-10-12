# Purchase funnel audit — 2026-10-12

Scope: the $1 Beta Unlock funnel (preview → Stripe Checkout → webhook →
full analysis) on `feat/connect-ask-backend` @ `6a7b9bf`.

How the evidence was gathered:
- Read-only, aggregate `SELECT`s on the production Supabase project. Only
  counts and timestamps were returned. No aid figures, quotes or documents
  were read.
- Read-only Stripe reads for expired Checkout Sessions and the outcome code
  of the few charge attempts on them.
- All tests use synthetic data, on a throwaway local Postgres.

Nothing was written to production, and nothing was deployed.

Window: live mode, non-test accounts, 2026-09-30 → 2026-10-12.
The numbers are small. Every rate below is a direction to measure, not a
conclusion.

## 1. What the data says today

| Step | Accounts |
|---|---|
| Started a Stripe Checkout | 17 (25 sessions) |
| Paid | 5 (29%) |
| Abandoned (every session expired) | 12 |

**Of the 12 who abandoned:**
- **1 is card testing, not a customer.** One account (first touch from
  TikTok) made 3 Checkout attempts with 3 different card numbers,
  cardholder names and billing countries. All were rejected by Stripe as
  `incorrect_number` before reaching the card network. Stripe holds the
  details; they are not repeated here.
- **1 started a Link payment and did not finish it.**
- **10 never entered payment details.** Their sessions have no
  PaymentIntent. So the drop-off is a decision made before paying, not a
  card failure.
- **8 of the 12 were back on Fynliq within 60 minutes** of their first
  checkout (preview or paywall shown again). They were not lost to a
  broken page.

**Where checkouts come from:**
- **Median account age at the first checkout: about 1 minute.** Many
  students are asked for $1 almost straight after signing up.
- **In-app browsers** (TikTok, Instagram or Facebook's built-in browser):
  3 accounts started checkout and 0 paid. One of the 3 is the
  card-testing account.
- **Everything else:** 4 paid out of about 14.

**Paid accounts with no tracked `full_analysis_viewed` (3 of 5):**

| Account | What happened | Kind of gap |
|---|---|---|
| A | Paid Sep 30. Uploaded and got a result at 18:17 the same day. The event did not exist until Oct 5. | Instrumentation (not a product failure) |
| B | Paid Oct 3 on the old unlock-first flow. **No event of any kind** after the payment. | Unknown, because the return from Stripe records nothing |
| D | Paid Oct 8 from the unlock screen on Search/Ask/Earn, with no preview. Was on the upload page 7s later and visited it 3 times. Never uploaded. | Nothing to view: paid before having an analysis |
| C, E | Paid from the My Aid preview. Both viewed the full analysis. | — |

**Latent bug found in code (not yet seen in the 5 payers):**
- `finalise()` in `api/analyze.js` keeps the facts even when the whole set
  fails `validateSummary` (for example, a second-pass or scanned total with
  the same label and period as a first-pass figure but a different amount).
- That set is shown in the preview and saved.
- After paying, `GET /api/analyze` re-validates it, fails, and answers
  `404 none`. The client treats that as "no analysis" and sends the paying
  student to the upload page. No event records that it happened.

## 2. Hypotheses

Each hypothesis has a metric and a decision rule. Re-read them after 30 new
checkout starts or 14 days, whichever comes first.

### Checkout abandonment

**H1 — Paying before seeing value.** Students sent to Checkout from the
Search/Ask/Earn unlock screen (no preview of their own aid) pay less often
than students who saw their My Aid preview first.
- **Metric:** checkout→paid rate by `surface` (new column, below).
- **True if:** the preview rate is at least 2× the rate from other
  surfaces, with at least 10 checkouts per surface.
- **Action if true:** make the unlock screen on those tabs lead with the
  free upload, and put the $1 button second.

**H2 — In-app browsers lose checkouts.** Checkouts started in an in-app
browser complete less often. Stripe wallets are limited there, and the
return can land in a different browser that has no Fynliq session.
- **Metric:** checkout→paid rate for in-app vs other first touches; and
  `checkout_return_viewed` per `payment_confirmed`.
- **True if:** the in-app rate is under half the rest, or returns are
  under 80%.
- **Action if true:** show an "Open in your browser" step before Checkout
  in in-app browsers. Not built in this PR.

**H3 — Students decide not to pay; cards don't fail them.**
- **Metric:** the share of expired sessions with a payment attempt. The
  webhook now stores the PaymentIntent on expired sessions.
- **If under 30%:** the problem is value, trust or price, so work on
  H1/H2 and the copy.
- **If over 30%:** the problem is payment methods, so look at which ones
  are enabled. Card-testing accounts are excluded.

**H4 — Cancel versus vanish.** Today we cannot tell a student who pressed
Back or Cancel in Stripe from one who closed the tab.
- **Metric:** `checkout_cancelled` / `checkout_created`. This is coverage,
  not a pass/fail test. It splits the 12 abandoners into "came back" and
  "left".

### Paid but no full analysis

**H5 — The metric was mis-defined.** "Paid without a view" mixes three
kinds of payer: those with no analysis, those who paid before the event
existed, and real failures.
- **Metric:** of paid accounts that had a saved analysis at or after
  payment, the share with `full_analysis_viewed` within 24h of payment.
- **Healthy:** at least 95%. Today it is 2/2.
- Payers with no analysis are tracked separately (H6).

**H6 — Payers with no analysis are dropped on upload.**
- **Metric:**
  - the share of paid accounts with no analysis 24h after paying
    (today: 1/5, account D);
  - the share of tab payers who open the tab they paid for.
- **Action:** after Stripe confirms, a student with no saved analysis
  goes back to the tab they paid from, not to upload. Built in this PR.

**H7 — A saved analysis can fail to load after payment** (the `finalise`
bug).
- **Metric:** `saved_analysis_unavailable` events. This is a new
  server-side event.
- **Healthy:** 0. Any non-zero count is a bug to fix, not a rate to
  watch.

**H8 — The return from Stripe can land signed out.**
- **Metric:** `checkout_return_viewed` per `payment_confirmed`, measured
  per account.
- **Healthy:** at least 90%.
- Account B is the case this would have caught.

## 3. Changes in this PR (smallest that make the above measurable or fixed)

1. **Fix H7 at the source.**
   - `finalise()` now drops every fact in a conflicting group, then keeps
     only facts that pass validation together.
   - A set it returns always passes `validateSummary`.
   - `GET /api/analyze` applies the same repair to rows saved before this
     fix, so existing saved analyses load.
   - If nothing valid is left, it answers `404 {error:'unavailable'}` and
     records `saved_analysis_unavailable` on the server.
2. **Telemetry for H1, H3, H4, H8** (migration `202610120001`):
   - new events `checkout_return_viewed`, `checkout_cancelled`,
     `unlock_confirmed_viewed` and `saved_analysis_unavailable`;
   - a nullable `surface` on funnel events, recorded on `unlock_clicked`
     and `unlock_button_clicked`;
   - the webhook keeps the PaymentIntent on expired sessions;
   - an aggregate RPC, `purchase_funnel_metrics()`.
3. **Error handling on the return from Stripe (H8).**
   - A signed-out return used to poll for 10 minutes showing
     "confirming…". It now says to log in.
   - The account gate on `/beta/checkout` now opens Log in instead of Sign
     up, so a payer does not create a second account.
4. **Routing for H6.** After payment, a student with no saved analysis
   goes back to the tab they paid from.
5. **Funnel events no longer share the checkout rate limit.** Tracking
   calls use their own budget, so a busy campus IP can't 429 the $1
   button.

Not in this PR (needs a human decision):
- Stripe Radar rules for card testing.
- The in-app-browser "Open in browser" step.
- Any change to price or copy.

### How many saved analyses the old code made unreloadable

Run this in the SQL editor before applying the migration. It returns one
number and reads no content out. It counts saved analyses that hold the
same field, label and period with two different values. That is the case
the old `finalise()` saved and the reload rejected. Rows in this count load
again (repaired) once this PR is deployed.

```sql
select count(*) as unreloadable_saved_analyses
from public.aid_analyses x
where x.expires_at > now() and exists (
  select 1 from jsonb_array_elements(x.facts) f
  group by f->>'field',
           lower(regexp_replace(f->>'label', '[$,\s]', '', 'g')),
           lower(regexp_replace(coalesce(f->>'period', ''), '[$,\s]', '', 'g'))
  having count(distinct lower(regexp_replace(f->>'value', '[$,\s]', '', 'g'))) > 1);
```

This audit did not run it, because doing so means scanning stored aid
figures, and this audit was limited to event and billing counts.

## 4. Metrics to track

All of these come from `select public.purchase_funnel_metrics(<test ids>,
<since>)`. Live mode only; test accounts excluded.

| Metric | Definition | Today | Target / alarm |
|---|---|---|---|
| Preview → checkout | accounts with `checkout_created` ÷ accounts with `aid_preview_viewed` | 7/16 | watch |
| Checkout → paid | paid accounts ÷ accounts with `checkout_created` | 5/17 | watch, by surface and by in-app |
| Checkout → paid, by surface | as above, split by `surface` of the last unlock click | new | H1 rule |
| Abandon with payment attempt | expired sessions with a PaymentIntent ÷ expired sessions | 1/17 genuine (Stripe; the card-testing account's 3 excluded) | H3 rule |
| Cancel-return rate | `checkout_cancelled` ÷ `checkout_created` | new | coverage |
| Return seen | accounts with `checkout_return_viewed` ÷ accounts with `payment_confirmed` | new | ≥ 90% |
| Paid → full view (24h) | among payers with a saved analysis | 2/2 | ≥ 95% |
| Paid, no analysis (24h) | payers with no saved analysis 24h after paying | 1/5 | watch |
| Saved analysis unavailable | count of `saved_analysis_unavailable` | new | 0, page on any |
| Duplicate payments | `billing_checkouts.duplicate_payment` | 0 | 0 |
| Card-testing signals | accounts with ≥2 `incorrect_number` attempts (Stripe) | 1 | 0, Radar |
