-- FYNLIQ Intelligence v1: read-only, aggregate metrics for arbitrary time
-- windows, so the intelligence layer can compare "today" with yesterday, the
-- previous period and trailing averages (billing_metrics is all-time only).
--
-- Apply after 202610060002_in_app_browser_attribution.sql. REVIEW BEFORE
-- APPLYING TO PRODUCTION. Independent of the app code: until this is applied
-- the intelligence snapshot falls back to the existing *_metrics RPCs (with
-- fewer metrics) and says so; once applied, nothing else changes.
--
-- What this does: two SECURITY DEFINER functions that only SELECT. No table,
-- column, trigger, policy or grant on existing objects is created or changed.
-- No data is written.
--
-- What is returned: counts and sums only. Never ids, emails, UTM text,
-- referrers, question or answer text, file names or aid figures. Attribution
-- is returned as counts per fixed channel enum.
--
-- Exclusions: admin/test accounts (p_test, the same list billing_metrics
-- receives) and rows flagged is_test_account, across sign-ups, uploads, Ask
-- questions (via the guest browsers linked to those accounts), the paywall
-- funnel and revenue. Revenue counts only Stripe mode p_livemode (the server
-- passes true: live money only). Accounts already entitled before a window are
-- left out of that window's Upload -> Checkout step (they can't check out).
--
-- Access: intelligence_metrics is service_role only, like every other FYNQ
-- RPC. intelligence_window (unbounded) is callable only from inside it.
--
-- Rollback (safe, nothing depends on these):
--   drop function public.intelligence_metrics(jsonb, uuid[], boolean);
--   drop function public.intelligence_window(timestamptz, timestamptz, uuid[], boolean);
begin;

-- One window [p_start, p_end). Conversion counts are cohort-in-window: the
-- later step must happen inside the same window, so every rate built from
-- these numbers is between 0 and 1.
create function public.intelligence_window(p_start timestamptz, p_end timestamptz, p_test uuid[], p_livemode boolean)
returns jsonb
language sql stable security definer set search_path='' as $$
 with
 test as (select coalesce(p_test, '{}'::uuid[]) ids),
 -- Guest browsers linked to an admin/test account are internal traffic.
 test_guests as (
  select g.guest_id from public.account_guests g, test where g.user_id = any(test.ids)),
 new_guests as (
  select u.id from public.anonymous_users u
  where u.created_at >= p_start and u.created_at < p_end
   and u.id not in (select guest_id from test_guests)),
 new_accounts as (
  select a.user_id from public.accounts a, test
  where a.created_at >= p_start and a.created_at < p_end and a.user_id <> all(test.ids)),
 uploads as (
  select e.* from public.upload_events e, test
  where e.created_at >= p_start and e.created_at < p_end
   and (e.account_id is null or e.account_id <> all(test.ids))
   and (e.guest_id is null or e.guest_id not in (select guest_id from test_guests))),
 -- Questions belong to guest browsers; drop the ones linked to an admin/test account.
 questions as (
  select q.* from public.beta_questions q
  where q.created_at >= p_start and q.created_at < p_end
   and q.user_id not in (select guest_id from test_guests)),
 -- Accounts that had already paid before the window can never start checkout,
 -- so their uploads are not part of the Upload -> Checkout step.
 entitled_before as (
  select b.account_id from public.billing_entitlements b
  where b.status = 'active' and b.paid_at < p_start),
 mev as (
  select m.account_id, m.created_at,
   case m.event_type
    when 'checkout_created' then 'checkout'      when 'stripe_checkout_started' then 'checkout'
    when 'unlock_clicked' then 'unlock'          when 'unlock_button_clicked' then 'unlock'
    when 'paywall_viewed' then 'paywall'         when 'aid_preview_viewed' then 'preview'
    when 'my_aid_entered' then 'my_aid'          when 'my_aid_page_view' then 'my_aid'
    when 'aid_upload_completed' then 'upload'    when 'full_analysis_viewed' then 'full_view'
    else m.event_type end step
  from public.monetization_events m, test
  where m.created_at >= p_start and m.created_at < p_end and m.livemode = p_livemode
   and not m.is_test_account and m.account_id is not null and m.account_id <> all(test.ids)),
 paid as (
  select c.account_id, c.paid_at, c.amount_total, c.duplicate_payment from public.billing_checkouts c, test
  where c.livemode = p_livemode and c.status = 'paid' and c.paid_at >= p_start and c.paid_at < p_end
   and not c.is_test_account and c.account_id <> all(test.ids)),
 stripe_outcomes as (
  select e.outcome from public.billing_stripe_events e
  join public.billing_checkouts c on c.checkout_session_id = e.checkout_session_id, test
  where e.livemode = p_livemode and e.received_at >= p_start and e.received_at < p_end
   and not c.is_test_account and c.account_id <> all(test.ids)),
 first_upload as (select account_id, min(created_at) at from mev
  where step = 'upload' and account_id not in (select account_id from entitled_before) group by 1),
 first_checkout as (select account_id, min(created_at) at from mev where step = 'checkout' group by 1),
 activity as (
  select l.user_id account_id from public.account_events l
   where l.event_type = 'logged_in' and l.created_at >= p_start and l.created_at < p_end
  union select e.account_id from uploads e where e.account_id is not null
  union select m.account_id from public.monetization_events m
   where m.account_id is not null and m.created_at >= p_start and m.created_at < p_end
  union select g.user_id from questions q join public.account_guests g on g.guest_id = q.user_id),
 attributed as (
  select x.channel, count(*) n from public.acquisition_attribution x
  where x.first_seen_at >= p_start and x.first_seen_at < p_end and x.channel <> 'legacy'
   and (x.guest_id is null or x.guest_id not in (select guest_id from test_guests)) group by 1)
 select jsonb_build_object(
  'start', p_start, 'end', p_end,
  -- Traffic
  'new_visitors', (select count(*) from new_guests),
  'new_visitors_signed_up', (select count(distinct g.id) from new_guests g
    join public.account_guests ag on ag.guest_id = g.id join new_accounts a on a.user_id = ag.user_id),
  'new_visitors_paid', (select count(distinct g.id) from new_guests g
    join public.account_guests ag on ag.guest_id = g.id join paid p on p.account_id = ag.user_id),
  'returning_accounts', (select count(distinct t.account_id) from activity t
    join public.accounts a on a.user_id = t.account_id, test
    where a.created_at < p_start and a.user_id <> all(test.ids)),
  'attributed_visitors', (select coalesce(sum(n), 0) from attributed),
  'visitors_by_channel', (select coalesce(jsonb_object_agg(channel, n), '{}'::jsonb) from attributed),
  -- Accounts
  'signups', (select count(*) from new_accounts),
  'signups_uploaded', (select count(*) from new_accounts a
    where exists(select 1 from uploads e where e.account_id = a.user_id)),
  'logins', (select count(*) from public.account_events l
    where l.event_type = 'logged_in' and l.created_at >= p_start and l.created_at < p_end),
  -- Uploads (all users, server-recorded)
  'uploads', (select count(*) from uploads),
  'uploads_read', (select count(*) from uploads where outcome = 'read'),
  'uploads_failed', (select count(*) from uploads where outcome <> 'read'),
  'uploads_by_outcome', (select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb)
    from (select outcome, count(*) n from uploads group by 1) o),
  'uploaders', (select count(distinct coalesce(account_id::text, guest_id::text)) from uploads
    where coalesce(account_id, guest_id) is not null),
  -- Ask FYNLIQ
  'questions', (select count(*) from questions),
  'questions_answered', (select count(*) from questions where state = 'success'),
  'questions_failed', (select count(*) from questions
    where state = 'failed' or (state = 'pending' and created_at < now() - interval '2 minutes')),
  'askers', (select count(distinct user_id) from questions),
  -- Paywall funnel (paywall-eligible accounts only; distinct accounts)
  'my_aid_accounts', (select count(distinct account_id) from mev where step = 'my_aid'),
  'eligible_upload_accounts', (select count(*) from first_upload),
  'preview_accounts', (select count(distinct account_id) from mev where step in ('preview', 'paywall')),
  'unlock_click_accounts', (select count(distinct account_id) from mev where step = 'unlock'),
  'checkout_accounts', (select count(*) from first_checkout),
  'checkout_sessions', (select count(*) from mev where step = 'checkout'),
  'upload_then_checkout_accounts', (select count(*) from first_upload u
    where exists(select 1 from mev c where c.step = 'checkout' and c.account_id = u.account_id and c.created_at >= u.at)),
  'checkout_then_paid_accounts', (select count(*) from first_checkout c
    where exists(select 1 from paid p where p.account_id = c.account_id and p.paid_at >= c.at)),
  -- Money (Stripe mode p_livemode, verified webhook only)
  'payments', (select count(*) from paid),
  'paid_accounts', (select count(distinct account_id) from paid),
  'revenue_cents', (select coalesce(sum(amount_total), 0) from paid),
  'duplicate_payments', (select count(*) from paid where duplicate_payment),
  'failed_payments', (select count(*) from stripe_outcomes where outcome = 'payment_failed'),
  'expired_checkouts', (select count(*) from stripe_outcomes where outcome = 'expired'));
$$;

-- Several windows in one round trip. p_windows is an array of
-- {"key": "current", "start": "<ISO>", "end": "<ISO>"}; at most 8 windows,
-- each at most 400 days long, end after start.
create function public.intelligence_metrics(p_windows jsonb, p_test uuid[], p_livemode boolean)
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 v_out jsonb := '{}'::jsonb;
 v_item jsonb;
 v_key text;
 v_start timestamptz;
 v_end timestamptz;
begin
 if p_windows is null or jsonb_typeof(p_windows) <> 'array'
  or jsonb_array_length(p_windows) < 1 or jsonb_array_length(p_windows) > 8 then
  raise exception 'p_windows must be an array of 1 to 8 windows';
 end if;
 for v_item in select * from jsonb_array_elements(p_windows) loop
  v_key := v_item->>'key';
  if v_key is null or v_key !~ '^[a-z0-9_]{1,40}$' then raise exception 'Invalid window key'; end if;
  v_start := (v_item->>'start')::timestamptz;
  v_end := (v_item->>'end')::timestamptz;
  if v_start is null or v_end is null or v_end <= v_start or v_end - v_start > interval '400 days' then
   raise exception 'Invalid window %', v_key;
  end if;
  v_out := v_out || jsonb_build_object(v_key, public.intelligence_window(v_start, v_end, p_test, p_livemode));
 end loop;
 return jsonb_build_object(
  'generated_at', now(),
  'history', jsonb_build_object(
   'first_visitor_at', (select min(created_at) from public.anonymous_users),
   'first_account_at', (select min(created_at) from public.accounts),
   'first_upload_at', (select min(created_at) from public.upload_events),
   'first_attributed_at', (select min(first_seen_at) from public.acquisition_attribution where channel <> 'legacy'),
   'first_funnel_event_at', (select min(created_at) from public.monetization_events where livemode = p_livemode)),
  'windows', v_out);
end;
$$;

revoke all on function public.intelligence_window(timestamptz, timestamptz, uuid[], boolean),
 public.intelligence_metrics(jsonb, uuid[], boolean) from public, anon, authenticated;
-- intelligence_window has no input bounds, so nobody may call it directly: it
-- runs only inside intelligence_metrics (security definer, as the owner),
-- which validates the windows first.
revoke all on function public.intelligence_window(timestamptz, timestamptz, uuid[], boolean) from service_role;
grant execute on function public.intelligence_metrics(jsonb, uuid[], boolean) to service_role;
commit;

-- After applying (read-only smoke test in the SQL editor):
--   select public.intelligence_metrics(
--     jsonb_build_array(jsonb_build_object('key','last_7_days','start',now()-interval '7 days','end',now())),
--     '{}'::uuid[], true);
