-- FYNQ Beta Unlock: a one-time $1 Stripe Checkout payment that unlocks
-- premium My Aid analysis for the lifetime of the beta.
--
-- Apply after 202609220001_upload_tracking.sql. REVIEW BEFORE APPLYING TO
-- PRODUCTION. Nothing in this file charges anyone or turns the paywall on:
-- the paywall is controlled by the server-only PAYWALL_ENABLED variable,
-- which defaults to false.
--
-- What is stored
--   * Checkout sessions and payments: Stripe ids, amount, currency, status,
--     test/live mode and timestamps. Never card details (Stripe keeps those).
--   * One entitlement row per paying account.
--   * Stripe event ids, for webhook idempotency.
--   * Content-free funnel events (event name, account, time, mode).
--   * Nothing about a student's documents: the unlock happens before any
--     document is chosen, so no aid content ever waits on a payment.
--
-- Grandfathering is deterministic, not stored: an account is grandfathered
-- when public.accounts.created_at <= the cutoff the server passes in
-- (FYNQ_BETA_GRANDFATHER_CUTOFF, default 2026-09-30T18:53:52.654622Z). The
-- comparison happens here, in Postgres, so microsecond precision is kept.
--
-- Every table is RLS-enabled with no policies and revoked from anon and
-- authenticated; every function is SECURITY DEFINER and executable by the
-- service role only. Browsers can never read or write billing data directly.
begin;

create table public.billing_checkouts (
 checkout_session_id text primary key check (checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9]{8,200}$'),
 account_id uuid not null references public.accounts(user_id) on delete cascade,
 livemode boolean not null,
 is_test_account boolean not null default false,
 status text not null default 'open'
  check (status in ('open','completed_unpaid','paid','failed','expired')),
 checkout_url text check (checkout_url is null or checkout_url ~ '^https://checkout\.stripe\.com/'),
 amount_total integer check (amount_total is null or amount_total >= 0),
 currency text check (currency is null or currency ~ '^[a-z]{3}$'),
 payment_intent_id text check (payment_intent_id is null or payment_intent_id ~ '^pi_[A-Za-z0-9_]{8,200}$'),
 stripe_customer_id text check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]{6,200}$'),
 payment_status text,
 -- True when this account already had an entitlement when this payment
 -- arrived: a second charge that should be reviewed for a refund.
 duplicate_payment boolean not null default false,
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 paid_at timestamptz
);
create index billing_checkouts_account on public.billing_checkouts(account_id, created_at desc);

create table public.billing_entitlements (
 account_id uuid primary key references public.accounts(user_id) on delete cascade,
 product text not null default 'fynq_beta_unlock' check (product = 'fynq_beta_unlock'),
 status text not null default 'active' check (status in ('active','revoked')),
 source text not null default 'stripe' check (source = 'stripe'),
 checkout_session_id text not null references public.billing_checkouts(checkout_session_id),
 payment_intent_id text,
 stripe_customer_id text,
 amount integer not null check (amount >= 0),
 currency text not null check (currency ~ '^[a-z]{3}$'),
 livemode boolean not null,
 is_test_account boolean not null default false,
 paid_at timestamptz not null,
 activated_at timestamptz not null default now()
);

create table public.billing_stripe_events (
 event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9_]{6,200}$'),
 event_type text not null check (length(event_type) <= 100),
 livemode boolean not null,
 checkout_session_id text,
 outcome text not null default 'processing' check (outcome ~ '^[a-z_]{1,40}$'),
 received_at timestamptz not null default now()
);

create table public.monetization_events (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now(),
 account_id uuid references public.accounts(user_id) on delete set null,
 event_type text not null check (event_type in (
  'my_aid_entered','preflight_completed','paywall_viewed','unlock_clicked','checkout_created',
  'checkout_completed','payment_confirmed','entitlement_activated','analysis_started','analysis_completed')),
 livemode boolean not null,
 is_test_account boolean not null default false
);
create index monetization_events_type_time on public.monetization_events(event_type, created_at);

alter table public.billing_checkouts enable row level security;
alter table public.billing_entitlements enable row level security;
alter table public.billing_stripe_events enable row level security;
alter table public.monetization_events enable row level security;
revoke all on public.billing_checkouts, public.billing_entitlements, public.billing_stripe_events,
 public.monetization_events from public, anon, authenticated;
grant all on public.billing_checkouts, public.billing_entitlements, public.billing_stripe_events,
 public.monetization_events to service_role;

-- ------------------------------------------------------------------ access

-- Who may run premium analysis. The server adds PAYWALL_ENABLED and the
-- admin/test account list on top of this.
create function public.billing_access(p_user uuid, p_cutoff timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'account', a.user_id is not null,
  'created_at', a.created_at,
  'grandfathered', coalesce(a.created_at <= p_cutoff, false),
  'premium', exists(select 1 from public.billing_entitlements e where e.account_id = p_user and e.status = 'active'))
 from (select 1) one left join public.accounts a on a.user_id = p_user;
$$;

-- ------------------------------------------------------------------ funnel

create function public.billing_track(p_user uuid, p_event text, p_livemode boolean, p_test boolean) returns void
language sql security definer set search_path='' as $$
 insert into public.monetization_events(account_id, event_type, livemode, is_test_account)
 select a.user_id, p_event, p_livemode, p_test from public.accounts a where a.user_id = p_user;
$$;

-- ---------------------------------------------------------------- checkout

-- An open, unexpired Checkout Session this account already started, so a
-- double click or a second tab reuses it instead of opening a second charge.
create function public.billing_open_checkout(p_user uuid, p_livemode boolean) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id', c.checkout_session_id, 'url', c.checkout_url)
 from public.billing_checkouts c
 where c.account_id = p_user and c.livemode = p_livemode and c.status = 'open'
  and c.checkout_url is not null and c.expires_at > now() + interval '5 minutes'
 order by c.created_at desc limit 1;
$$;

create function public.billing_checkout_created(p_session text, p_user uuid, p_livemode boolean, p_test boolean,
 p_url text, p_expires timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Stripe's idempotency key can hand back a session FYNQ already recorded
 -- (two clicks inside the same window): record it, and count it, once.
 insert into public.billing_checkouts(checkout_session_id, account_id, livemode, is_test_account, checkout_url, expires_at)
 values (p_session, p_user, p_livemode, p_test, p_url, p_expires)
 on conflict (checkout_session_id) do nothing;
 if found then
  insert into public.monetization_events(account_id, event_type, livemode, is_test_account)
  values (p_user, 'checkout_created', p_livemode, p_test);
 elsif not exists(select 1 from public.billing_checkouts where checkout_session_id = p_session and account_id = p_user) then
  raise exception 'Checkout session belongs to another account';
 end if;
end;
$$;

-- ----------------------------------------------------------------- webhook

-- Applies one verified Stripe event, exactly once. The caller has already
-- checked the signature; this function checks everything else:
--   * the event id has not been processed before (idempotency),
--   * the Checkout Session was created by FYNQ for THIS account
--     (metadata and client_reference_id must both match the stored owner),
--   * test/live mode matches,
--   * the payment status is actually 'paid',
--   * the amount and currency are exactly the configured price.
-- Only then is the entitlement activated. Everything runs in one
-- transaction: a failure rolls back the event id too, so Stripe's retry is
-- processed normally.
create function public.billing_stripe_event(
 p_event_id text, p_type text, p_livemode boolean, p_session text,
 p_account text, p_client_reference text, p_payment_status text,
 p_amount integer, p_currency text, p_payment_intent text, p_customer text,
 p_expected_amount integer, p_expected_currency text, p_test boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_row public.billing_checkouts;
 v_outcome text;
 v_entitled boolean;
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
   update public.billing_checkouts set status = 'expired' where checkout_session_id = p_session and status = 'open';
   v_outcome := 'expired';
  elsif p_type = 'checkout.session.async_payment_failed' then
   update public.billing_checkouts set status = 'failed', payment_status = p_payment_status
   where checkout_session_id = p_session and status <> 'paid';
   v_outcome := 'payment_failed';
  else
   -- checkout.session.completed or async_payment_succeeded
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

-- ----------------------------------------------------------------- metrics

-- One Stripe mode's funnel. Admin/test accounts are excluded twice over:
-- by the flag recorded when the row was written, and by the current list
-- the server passes in.
create function public.billing_mode_metrics(p_livemode boolean, p_test uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
 with ev as (
  select * from public.monetization_events
  where livemode = p_livemode and not is_test_account and account_id is not null and account_id <> all(coalesce(p_test, '{}'))
 ), paid as (
  select * from public.billing_entitlements
  where livemode = p_livemode and not is_test_account and status = 'active' and account_id <> all(coalesce(p_test, '{}'))
 ), payments as (
  select * from public.billing_checkouts
  where livemode = p_livemode and status = 'paid' and not is_test_account and account_id <> all(coalesce(p_test, '{}'))
 ), counts as (
  select
   (select count(distinct account_id) from ev where event_type = 'my_aid_entered') entered,
   (select count(distinct account_id) from ev where event_type = 'preflight_completed') preflight,
   (select count(*) from ev where event_type = 'paywall_viewed') paywall_views,
   (select count(distinct account_id) from ev where event_type = 'paywall_viewed') paywall_viewers,
   (select count(*) from ev where event_type = 'unlock_clicked') unlock_clicks,
   (select count(distinct account_id) from ev where event_type = 'checkout_created') checkout_starts,
   (select count(*) from ev where event_type = 'checkout_created') checkout_sessions,
   (select count(distinct account_id) from ev where event_type = 'checkout_completed') checkout_completed,
   (select count(distinct account_id) from ev where event_type = 'payment_confirmed') payment_confirmed,
   (select count(*) from paid) paid_accounts,
   (select count(*) from payments) payments,
   (select count(*) from payments where duplicate_payment) duplicate_payments,
   (select coalesce(sum(amount_total), 0) from payments) gross_revenue_cents,
   (select count(distinct account_id) from ev where event_type = 'analysis_started') analysis_started,
   (select count(distinct account_id) from ev where event_type = 'analysis_completed') analysis_completed_accounts,
   (select count(*) from ev where event_type = 'analysis_completed') analyses_completed,
   (select count(*) from public.upload_events u join paid p on p.account_id = u.account_id where u.created_at >= p.paid_at) paid_user_upload_batches,
   (select coalesce(sum(u.files), 0) from public.upload_events u join paid p on p.account_id = u.account_id where u.created_at >= p.paid_at) paid_user_files,
   (select count(distinct u.account_id) from public.upload_events u join paid p on p.account_id = u.account_id where u.created_at >= p.paid_at) paid_user_uploaders,
   (select count(*) from public.beta_questions q join public.account_guests g on g.guest_id = q.user_id
     join paid p on p.account_id = g.user_id where q.state = 'success' and q.created_at >= p.paid_at) paid_user_completed_questions
 )
 select jsonb_build_object(
  'my_aid_entered_accounts', entered,
  'preflight_completed_accounts', preflight,
  'paywall_views', paywall_views,
  'paywall_viewers', paywall_viewers,
  'unlock_clicks', unlock_clicks,
  'checkout_starts', checkout_starts,
  'checkout_sessions', checkout_sessions,
  'checkout_completed_accounts', checkout_completed,
  'payment_confirmed_accounts', payment_confirmed,
  'paid_accounts', paid_accounts,
  'payments', payments,
  'duplicate_payments', duplicate_payments,
  'gross_revenue_cents', gross_revenue_cents,
  'paywall_to_checkout_rate', round(checkout_starts::numeric / nullif(paywall_viewers, 0), 4),
  'checkout_to_paid_rate', round(paid_accounts::numeric / nullif(checkout_starts, 0), 4),
  'paywall_to_paid_rate', round(paid_accounts::numeric / nullif(paywall_viewers, 0), 4),
  'analysis_started_accounts', analysis_started,
  'analysis_completed_accounts', analysis_completed_accounts,
  'analyses_completed', analyses_completed,
  'paid_user_upload_batches', paid_user_upload_batches,
  'paid_user_files', paid_user_files,
  'paid_user_uploaders', paid_user_uploaders,
  'paid_user_completed_questions', paid_user_completed_questions)
 from counts;
$$;

create function public.billing_metrics(p_cutoff timestamptz, p_test uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'cutoff', p_cutoff,
  'grandfathered_accounts', (select count(*) from public.accounts where created_at <= p_cutoff),
  'post_cutoff_accounts', (select count(*) from public.accounts where created_at > p_cutoff and user_id <> all(coalesce(p_test, '{}'))),
  'excluded_test_accounts', coalesce(cardinality(p_test), 0),
  'live', public.billing_mode_metrics(true, p_test),
  'test_mode', public.billing_mode_metrics(false, p_test));
$$;

revoke all on function
 public.billing_access(uuid, timestamptz),
 public.billing_track(uuid, text, boolean, boolean),
 public.billing_open_checkout(uuid, boolean),
 public.billing_checkout_created(text, uuid, boolean, boolean, text, timestamptz),
 public.billing_stripe_event(text, text, boolean, text, text, text, text, integer, text, text, text, integer, text, boolean),
 public.billing_mode_metrics(boolean, uuid[]),
 public.billing_metrics(timestamptz, uuid[])
from public, anon, authenticated;
grant execute on function
 public.billing_access(uuid, timestamptz),
 public.billing_track(uuid, text, boolean, boolean),
 public.billing_open_checkout(uuid, boolean),
 public.billing_checkout_created(text, uuid, boolean, boolean, text, timestamptz),
 public.billing_stripe_event(text, text, boolean, text, text, text, text, integer, text, text, text, integer, text, boolean),
 public.billing_mode_metrics(boolean, uuid[]),
 public.billing_metrics(timestamptz, uuid[])
to service_role;
commit;

-- After applying, confirm the grandfathered count matches the 20 accounts
-- that existed at the cutoff (run in the SQL editor):
--   select count(*) from public.accounts where created_at <= '2026-09-30T18:53:52.654622Z';
