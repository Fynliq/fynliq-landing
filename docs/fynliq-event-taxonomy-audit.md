# FYNLIQ event taxonomy audit

Can FYNQ reliably rebuild the funnel below from data it already stores?
Audited against `feat/connect-ask-backend` @ `6a7b9bf` and read-only production
metadata (aggregate counts only) on 2026-10-06.

Legend: ✅ reliable · ◐ partial / caveated · ✗ not collected

```
visitor → signup → ask_fynliq → aid_upload_started → aid_upload_completed →
analysis_viewed → pricing_viewed → checkout_started → payment_success → return_visit
```

| Canonical step | Status | Where it lives today | Who it covers | Notes |
| --- | --- | --- | --- | --- |
| `visitor` | ◐ | `anonymous_users` row + `events.guest_created` (`api/beta-auth.js` `action:'guest'`, fired by `AccountProvider` on first load) | Every browser that runs the SPA's JS | Counts **new browsers**, not people or visits. Bots without JS aren't counted. Admin browsers are included. |
| `signup` | ✅ | `accounts.created_at`, `account_events.signed_up` | Everyone who creates an account | Test and admin accounts are excluded by id (`FYNQ_BILLING_TEST_ACCOUNT_IDS`, `BETA_ADMIN_USER_IDS`). |
| `ask_fynliq` | ✅ | `beta_questions` (+ `events.question_submitted` / `answer_received` / `answer_failed`) | Everyone (guest-level). Linked to accounts through `account_guests`. | 5 questions in production so far. |
| `aid_upload_started` | ◐ | `monetization_events.aid_upload_started` (client-reported) | **Paywall-eligible accounts only** | Production also has `events.upload_started` (drift, 0 rows). |
| `aid_upload_completed` | ✅ / ◐ | `upload_events` (server, every batch, with outcome) · `monetization_events.aid_upload_completed` (eligible only) | All uploads / eligible accounts | Use `upload_events` for volume and success, and `monetization_events` for the paywall funnel. Production also has `events.upload_completed` / `upload_failed` rows written by code that isn't in git (see drift). |
| `analysis_viewed` | ◐ | `monetization_events.aid_preview_viewed` (locked preview), `full_analysis_viewed` (unlocked) | Eligible accounts only | Grandfathered users' result views aren't recorded. |
| `pricing_viewed` | ◐ | `monetization_events.paywall_viewed` | Eligible accounts only | Fired by both `AidPreview` (alongside `aid_preview_viewed`) and `UnlockMyAid`, so **views ≠ viewers**. Use distinct accounts. |
| `checkout_started` | ✅ | `monetization_events.checkout_created` (server, when Stripe returns a session), `billing_checkouts` | Eligible accounts | `aid_funnel_events` view renames it to `stripe_checkout_started`. `unlock_clicked` (server) and `unlock_button_clicked` (client) are two separate pre-checkout clicks. |
| `payment_success` | ✅ | `billing_checkouts.status='paid'` / `paid_at` (webhook only), `monetization_events.payment_confirmed`, `billing_entitlements` | Eligible accounts, live and test mode kept separate | The view renames it to `payment_completed`. |
| `return_visit` | ✗ / ◐ | `acquisition_attribution.last_seen_at` / `touch_count` (guest, since 2026-10-06, **overwritten** on each visit). Account activity (log-ins, uploads, funnel events) as a proxy. | — | No per-visit history. Critical journey step 14 is ✗. |

## Duplicate and overlapping systems (found, not changed)

1. **Two names for the same step** in `monetization_events`: `checkout_created`
   / `stripe_checkout_started`, `payment_confirmed` / `payment_completed`,
   `unlock_clicked` / `unlock_button_clicked`, `analysis_started` /
   `aid_analysis_started`, and `analysis_completed` / `aid_analysis_completed`.
   The `aid_funnel_events` view already maps the first two pairs.
2. **Three upload trails**: `upload_events` (server truth),
   `monetization_events.aid_upload_*` (eligible funnel) and production-only
   `events.upload_*` (drift).
3. **Production-only analytics**: `record_event()`, `usage_metrics()` and
   `product_metrics()` define a parallel page-view taxonomy (`my_aid_viewed`,
   `search_viewed`, `ask_fynliq_viewed`, `search_submitted`) that no code in
   this repository writes.

Intelligence v1 **does not add an event system.** It reads the server-side
sources of truth (`upload_events`, `accounts`, `beta_questions`,
`billing_checkouts`, `billing_stripe_events`) and the eligible-account funnel
(`monetization_events`). It treats both names in each duplicate pair as one
step.

## Recommendations (in order; none applied)

1. **👤 Reconcile the drift first.** Find what writes `events.upload_*`, then
   either bring `page_analytics` / `record_event` into git or retire it. Don't
   build on it until then.
2. **Adopt one canonical vocabulary** (the arrow list above) as a read-only
   view: `analytics_funnel_events(step, at, account_id, guest_id, scope)`,
   built from the existing tables. That's a view migration with no data move,
   so it's low risk. Don't rename stored event types; old rows must stay
   valid.
3. **Add a content-free `visit_started`** (guest id, time, channel enum),
   deduplicated per 30 minutes. It gives real sessions and return visits. If
   the drift's `record_event` is adopted, it already does the deduplication.
4. **Record `my_aid_page_view` and the result views for grandfathered
   accounts too**, with a `scope` flag (`eligible` / `grandfathered`), so the
   engagement funnel covers everyone while revenue analysis keeps filtering
   to eligible accounts.
5. **Stop double-firing `paywall_viewed`** from `AidPreview` (it already fires
   `aid_preview_viewed`), or document views-vs-viewers. This changes existing
   admin numbers, so it needs a human decision.
6. **Exclude admin browsers** from visitor counts, for example by linking the
   admin session's guest browser to a test flag.
