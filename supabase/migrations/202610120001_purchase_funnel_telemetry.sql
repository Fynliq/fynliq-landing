-- Purchase funnel audit (2026-10-12): make checkout abandonment and
-- "paid but never saw the full analysis" measurable.
-- See docs/audits/2026-10-12-purchase-funnel.md.
--
-- Apply after 202610060002_in_app_browser_attribution.sql.
-- REVIEW BEFORE APPLYING TO PRODUCTION.
--
-- Additive, and safe in either order with the app code:
--   * the old 4-argument billing_track calls keep working (p_surface has a
--     default);
--   * the app sends p_surface only when it has one;
--   * no existing row is changed.
--
-- Nothing here stores document content. `surface` is one of five fixed
-- words. A PaymentIntent id is a Stripe id, like the ones already stored for
-- paid sessions.
--
-- What it does
--   1. Four new funnel events:
--        checkout_return_viewed      browser reached the Stripe success page
--        checkout_cancelled          browser came back through Cancel
--        unlock_confirmed_viewed     the browser showed "Payment confirmed"
--        saved_analysis_unavailable  server: a saved analysis could not be
--                                    shown at all
--   2. monetization_events.surface: where an unlock was asked for.
--   3. The webhook keeps the PaymentIntent on expired and failed sessions,
--      so "tried to pay and did not" can be told apart from "never tried".
--   4. purchase_funnel_metrics(): the audit's metrics as one aggregate. No
--      ids, emails or content. service_role only.
begin;

-- 1 + 2 ---------------------------------------------------------------------

alter table public.monetization_events drop constraint monetization_events_event_type_check;
alter table public.monetization_events add constraint monetization_events_event_type_check check (event_type in (
 'my_aid_entered','preflight_completed','paywall_viewed','unlock_clicked','checkout_created',
 'checkout_completed','payment_confirmed','entitlement_activated','analysis_started','analysis_completed',
 'my_aid_page_view','aid_upload_started','aid_upload_completed','aid_analysis_started','aid_analysis_completed',
 'aid_preview_viewed','unlock_button_clicked','stripe_checkout_started','payment_completed','full_analysis_viewed',
 'checkout_return_viewed','checkout_cancelled','unlock_confirmed_viewed','saved_analysis_unavailable'));

alter table public.monetization_events
 add column surface text check (surface is null or surface in ('my_aid_preview','my_aid','ask','search','earn'));

drop function public.billing_track(uuid, text, boolean, boolean);
create function public.billing_track(p_user uuid, p_event text, p_livemode boolean, p_test boolean, p_surface text default null) returns void
language sql security definer set search_path='' as $$
 insert into public.monetization_events(account_id, event_type, livemode, is_test_account, surface)
 select a.user_id, p_event, p_livemode, p_test, p_surface from public.accounts a where a.user_id = p_user;
$$;
revoke all on function public.billing_track(uuid, text, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.billing_track(uuid, text, boolean, boolean, text) to service_role;

-- 3 -------------------------------------------------------------------------
-- Identical to 202609300001 except the two marked lines: expired and failed
-- sessions now keep the PaymentIntent Stripe reports. Same checks, same
-- outcomes, same single transaction.
create or replace function public.billing_stripe_event(
 p_event_id text, p_type text, p_livemode boolean, p_session text,
 p_account text, p_client_reference text, p_payment_status text,
 p_amount integer, p_currency text, p_payment_intent text, p_customer text,
 p_expected_amount integer, p_expected_currency text, p_test boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_row public.billing_checkouts;
 v_outcome text;
 v_entitled boolean;
 v_intent text := case when p_payment_intent ~ '^pi_[A-Za-z0-9_]{8,200}$' then p_payment_intent end;
begin
 insert into public.billing_stripe_events(event_id, event_type, livemode, checkout_session_id)
 values (p_event_id, p_type, p_livemode, p_session)
 on conflict (event_id) do nothing;
 if not found then
  return jsonb_build_object('duplicate', true, 'outcome', 'duplicate');
 end if;

 if p_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded',
   'checkout.session.async_payment_failed','checkout.session.expired') then
  v_outcome := 'ignored';
 else
  select * into v_row from public.billing_checkouts where checkout_session_id = p_session for update;
  if not found then
   v_outcome := 'unknown_session';
  elsif p_account is null or p_client_reference is null
    or v_row.account_id::text <> p_account or v_row.account_id::text <> p_client_reference then
   v_outcome := 'ownership_mismatch';
  elsif v_row.livemode <> p_livemode then
   v_outcome := 'mode_mismatch';
  elsif p_type = 'checkout.session.expired' then
   update public.billing_checkouts set status = 'expired',
    payment_intent_id = coalesce(payment_intent_id, v_intent)                                   -- changed
   where checkout_session_id = p_session and status = 'open';
   v_outcome := 'expired';
  elsif p_type = 'checkout.session.async_payment_failed' then
   update public.billing_checkouts set status = 'failed', payment_status = p_payment_status,
    payment_intent_id = coalesce(payment_intent_id, v_intent)                                   -- changed
   where checkout_session_id = p_session and status <> 'paid';
   v_outcome := 'payment_failed';
  else
   if p_type = 'checkout.session.completed' then
    insert into public.monetization_events(account_id, event_type, livemode, is_test_account)
    values (v_row.account_id, 'checkout_completed', p_livemode, p_test);
   end if;
   if v_row.status = 'paid' then
    v_outcome := 'already_paid';
   elsif p_payment_status is distinct from 'paid' then
    update public.billing_checkouts set status = 'completed_unpaid', payment_status = p_payment_status,
     completed_at = coalesce(completed_at, now()) where checkout_session_id = p_session;
    v_outcome := 'not_paid';
   elsif p_amount is distinct from p_expected_amount or p_currency is distinct from p_expected_currency then
    update public.billing_checkouts set payment_status = p_payment_status, amount_total = p_amount, currency = p_currency,
     completed_at = coalesce(completed_at, now()) where checkout_session_id = p_session;
    v_outcome := 'amount_mismatch';
   else
    v_entitled := exists(select 1 from public.billing_entitlements where account_id = v_row.account_id);
    update public.billing_checkouts set status = 'paid', payment_status = 'paid', amount_total = p_amount,
     currency = p_currency, payment_intent_id = p_payment_intent, stripe_customer_id = p_customer,
     completed_at = coalesce(completed_at, now()), paid_at = now(), duplicate_payment = v_entitled
    where checkout_session_id = p_session;
    insert into public.monetization_events(account_id, event_type, livemode, is_test_account)
    values (v_row.account_id, 'payment_confirmed', p_livemode, p_test);
    if v_entitled then
     v_outcome := 'already_entitled';
    else
     insert into public.billing_entitlements(account_id, checkout_session_id, payment_intent_id, stripe_customer_id,
      amount, currency, livemode, is_test_account, paid_at)
     values (v_row.account_id, p_session, p_payment_intent, p_customer, p_amount, p_currency, p_livemode, p_test, now());
     insert into public.monetization_events(account_id, event_type, livemode, is_test_account)
     values (v_row.account_id, 'entitlement_activated', p_livemode, p_test);
     v_outcome := 'entitlement_activated';
    end if;
   end if;
  end if;
 end if;

 update public.billing_stripe_events set outcome = v_outcome where event_id = p_event_id;
 return jsonb_build_object('duplicate', false, 'outcome', v_outcome);
end;
$$;

-- 4 -------------------------------------------------------------------------
-- The audit's metrics in one call. Counts and rates only.
--   select public.purchase_funnel_metrics('{<test account ids>}', now() - interval '14 days');
create function public.purchase_funnel_metrics(p_test uuid[], p_since timestamptz, p_livemode boolean default true) returns jsonb
language sql stable security definer set search_path='' as $$
 with
 ev as (
  select * from public.monetization_events
  where livemode = p_livemode and not is_test_account and account_id is not null
   and account_id <> all(coalesce(p_test, '{}')) and created_at >= p_since
 ),
 co as (
  select c.*, aa.attribution_type
  from public.billing_checkouts c left join public.acquisition_attribution aa on aa.id = c.attribution_id
  where c.livemode = p_livemode and not c.is_test_account and c.account_id <> all(coalesce(p_test, '{}')) and c.created_at >= p_since
 ),
 paid as (
  select e.account_id, e.paid_at from public.billing_entitlements e
  where e.livemode = p_livemode and not e.is_test_account and e.status = 'active'
   and e.account_id <> all(coalesce(p_test, '{}')) and e.paid_at >= p_since
 ),
 -- "Had an analysis to look at": a saved row, or a completed read, by 24h after paying.
 -- The completed-read event still counts after a saved row has expired.
 paid_detail as (
  select p.*,
   exists(select 1 from public.aid_analyses x where x.account_id = p.account_id and x.created_at <= p.paid_at + interval '24 hours')
    or exists(select 1 from public.monetization_events m where m.account_id = p.account_id
     and m.event_type in ('aid_analysis_completed','analysis_completed') and m.created_at <= p.paid_at + interval '24 hours') as had_analysis,
   exists(select 1 from public.monetization_events m where m.account_id = p.account_id and m.event_type = 'full_analysis_viewed'
     and m.created_at between p.paid_at - interval '1 minute' and p.paid_at + interval '24 hours') as viewed_24h,
   exists(select 1 from public.monetization_events m where m.account_id = p.account_id and m.event_type = 'checkout_return_viewed'
     and m.created_at between p.paid_at - interval '60 minutes' and p.paid_at + interval '60 minutes') as return_seen
  from paid p
 ),
 -- Each session's surface: the account's latest unlock click at or just before it was created.
 co_surface as (
  select c.checkout_session_id, c.account_id, c.status,
   coalesce((select m.surface from public.monetization_events m where m.account_id = c.account_id and m.event_type = 'unlock_clicked'
     and m.created_at between c.created_at - interval '5 minutes' and c.created_at + interval '5 seconds'
     order by m.created_at desc limit 1), 'unknown') as surface
  from co c
 ),
 surface_rows as (
  select surface, count(*) sessions, count(distinct account_id) accounts,
   count(distinct account_id) filter (where status = 'paid') paid_accounts
  from co_surface group by surface
 ),
 touch_rows as (
  select coalesce(attribution_type, 'none') first_touch, count(distinct account_id) accounts,
   count(distinct account_id) filter (where status = 'paid') paid_accounts
  from co group by 1
 ),
 n as (
  select
   (select count(distinct account_id) from ev where event_type = 'aid_preview_viewed') preview_accounts,
   (select count(distinct account_id) from co) checkout_accounts,
   (select count(*) from co) checkout_sessions,
   (select count(*) from paid) paid_accounts,
   (select count(*) from co where status = 'expired') expired_sessions,
   (select count(*) from co where status in ('expired','failed') and payment_intent_id is not null) expired_with_payment_attempt,
   (select count(distinct account_id) from ev where event_type = 'checkout_cancelled') cancel_returns,
   (select count(distinct account_id) from ev where event_type = 'checkout_return_viewed') return_viewed_accounts,
   (select count(*) from paid_detail where return_seen) paid_return_seen,
   (select count(*) from paid_detail where had_analysis) paid_with_analysis,
   (select count(*) from paid_detail where had_analysis and viewed_24h) paid_with_analysis_viewed_24h,
   (select count(*) from paid_detail where not had_analysis and paid_at <= now() - interval '24 hours') paid_without_analysis_24h,
   (select count(*) from ev where event_type = 'saved_analysis_unavailable') saved_analysis_unavailable,
   (select count(*) from co where duplicate_payment) duplicate_payments
 )
 select jsonb_build_object(
  'since', p_since, 'livemode', p_livemode,
  'preview_accounts', preview_accounts,
  'checkout_accounts', checkout_accounts,
  'checkout_sessions', checkout_sessions,
  'paid_accounts', paid_accounts,
  'preview_to_checkout_rate', round(checkout_accounts::numeric / nullif(preview_accounts, 0), 4),
  'checkout_to_paid_rate', round(paid_accounts::numeric / nullif(checkout_accounts, 0), 4),
  'expired_sessions', expired_sessions,
  'expired_with_payment_attempt', expired_with_payment_attempt,
  'cancel_returns', cancel_returns,
  'return_viewed_accounts', return_viewed_accounts,
  'paid_return_seen_rate', round(paid_return_seen::numeric / nullif(paid_accounts, 0), 4),
  'paid_with_analysis', paid_with_analysis,
  'paid_with_analysis_viewed_24h', paid_with_analysis_viewed_24h,
  'paid_full_view_rate', round(paid_with_analysis_viewed_24h::numeric / nullif(paid_with_analysis, 0), 4),
  'paid_without_analysis_24h', paid_without_analysis_24h,
  'saved_analysis_unavailable', saved_analysis_unavailable,
  'duplicate_payments', duplicate_payments,
  'by_surface', coalesce((select jsonb_object_agg(surface, jsonb_build_object('sessions', sessions, 'accounts', accounts, 'paid_accounts', paid_accounts)) from surface_rows), '{}'::jsonb),
  'by_first_touch', coalesce((select jsonb_object_agg(first_touch, jsonb_build_object('accounts', accounts, 'paid_accounts', paid_accounts)) from touch_rows), '{}'::jsonb))
 from n;
$$;
revoke all on function public.purchase_funnel_metrics(uuid[], timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.purchase_funnel_metrics(uuid[], timestamptz, boolean) to service_role;

commit;

-- After applying (SQL editor), these should all succeed and return counts only:
--   select public.purchase_funnel_metrics('{}', '2026-09-30', true);
--   select count(*) filter (where surface is not null) from public.monetization_events;  -- 0 until the app sends it
