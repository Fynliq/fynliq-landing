-- Phase 2 observability: one canonical analytics event log, an API request
-- log for product health, and read-only aggregate functions for agents.
--
-- What is stored, and what is not:
--   * analytics_events: stable event names (docs/analytics-events.md), the
--     guest browser id and account id, a first-touch attribution snapshot
--     (channel, UTM values, referrer host, landing path), coarse device type
--     and browser family, an optional experiment id, and small allow-listed
--     metadata (counts, durations, reason codes).
--     NEVER: names, emails, SSNs, student ids, document text, file names, aid
--     figures, raw user agents, IP addresses or free text.
--   * api_requests: route, method, HTTP status, duration and error class.
--     No URLs with query strings, no bodies, no IPs. Kept 30 days.
--
-- Access: service_role only (RLS on, no policies), like every other table.
-- Writes go through analytics_record / api_request_record (SECURITY DEFINER).
-- Reads for agents go through the ops_* functions, which are STABLE: called
-- over PostgREST with GET they run in a read-only transaction, so they cannot
-- change data even if someone tried.
--
-- Order vs code: apply BEFORE merging the code that calls these functions.
-- The code fails soft without them (events and request logs are dropped, the
-- site is unaffected), so applying late loses data but breaks nothing.
--
-- Rollback (loses only the collected analytics, nothing else depends on it):
--   drop function public.ops_applied_migrations(), public.ops_milestone_metrics(text), public.ops_health(timestamptz,timestamptz),
--     public.ops_revenue(timestamptz,timestamptz,text), public.ops_funnel(timestamptz,timestamptz,text,text),
--     public.api_request_record(text,text,integer,integer,integer,text,boolean),
--     public.analytics_record(jsonb), public.ops_test_ids(text);
--   drop table public.api_requests, public.analytics_events;
begin;

create table public.analytics_events (
 event_id uuid primary key,
 event_name text not null check (event_name in (
  'landing_view','return_session',
  'signup_started','signup_completed','login_completed','login_failed',
  'my_aid_viewed','upload_started','upload_completed','upload_failed',
  'analysis_started','analysis_completed','analysis_failed','results_viewed',
  'checkout_viewed','checkout_started','payment_completed','payment_failed','checkout_expired','unlock_verified',
  'client_error')),
 occurred_at timestamptz not null default now(),
 side text not null check (side in ('client','server')),
 anonymous_session_id uuid,
 user_id uuid,
 dedupe_key text check (dedupe_key is null or dedupe_key ~ '^[A-Za-z0-9:_.-]{1,120}$'),
 channel text check (channel is null or channel ~ '^[a-z_]{1,20}$'),
 source text check (source is null or char_length(source) between 1 and 100),
 medium text check (medium is null or char_length(medium) between 1 and 100),
 campaign text check (campaign is null or char_length(campaign) between 1 and 150),
 content text check (content is null or char_length(content) between 1 and 150),
 referrer text check (referrer is null or referrer ~ '^[a-z0-9.-]{1,253}$'),
 landing_page text check (landing_page is null or landing_page ~ '^/[A-Za-z0-9/_.-]{0,199}$'),
 device_type text not null default 'unknown' check (device_type in ('mobile','tablet','desktop','unknown')),
 browser text not null default 'other' check (browser in ('safari','chrome','firefox','edge','samsung','tiktok','instagram','facebook','other')),
 school text check (school is null or char_length(school) between 1 and 120),
 experiment_id text check (experiment_id is null or experiment_id ~ '^[a-z0-9_-]{1,40}$'),
 livemode boolean,
 is_test boolean not null default false,
 metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and length(metadata::text) <= 1000)
);
-- Once-only events (one signup per account, one payment per checkout, one
-- landing per browser per day) carry a dedupe_key; retries carry the same
-- event_id. Either way a duplicate is silently ignored.
create unique index analytics_events_dedupe on public.analytics_events(event_name, dedupe_key) where dedupe_key is not null;
create index analytics_events_time on public.analytics_events(occurred_at);
create index analytics_events_name_time on public.analytics_events(event_name, occurred_at);
create index analytics_events_user on public.analytics_events(user_id) where user_id is not null;
create index analytics_events_guest on public.analytics_events(anonymous_session_id) where anonymous_session_id is not null;

create table public.api_requests (
 id bigint generated always as identity primary key,
 occurred_at timestamptz not null default now(),
 route text not null check (route ~ '^/api/[a-z0-9/_-]{1,60}$'),
 method text not null check (method in ('GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD','OTHER')),
 status integer not null check (status between 100 and 599),
 duration_ms integer not null check (duration_ms between 0 and 600000),
 db_errors integer not null default 0 check (db_errors between 0 and 100),
 error_class text check (error_class is null or error_class ~ '^[A-Za-z]{1,40}$'),
 synthetic boolean not null default false
);
create index api_requests_time on public.api_requests(occurred_at);
create index api_requests_route_time on public.api_requests(route, occurred_at);

alter table public.analytics_events enable row level security;
alter table public.api_requests enable row level security;
revoke all on public.analytics_events, public.api_requests from public, anon, authenticated;
grant all on public.analytics_events, public.api_requests to service_role;

-- ------------------------------------------------------------------ writes

-- Records a batch of up to 25 events. Each event is validated on its own: a
-- malformed one is skipped, never the batch. Returns how many were stored.
create function public.analytics_record(p_events jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare
 e jsonb;
 v_name text;
 v_guest uuid;
 v_user uuid;
 v_inserted integer := 0;
 n integer;
 a record;
begin
 if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) > 25 then
  return 0;
 end if;
 for e in select value from jsonb_array_elements(p_events) loop
  begin
   v_name := e->>'event_name';
   v_guest := nullif(e->>'anonymous_session_id', '')::uuid;
   v_user := nullif(e->>'user_id', '')::uuid;

   -- A return session needs an earlier day with activity from the same person.
   if v_name = 'return_session' and not exists (
     select 1 from public.analytics_events x
     where x.event_name in ('landing_view','return_session','signup_completed','login_completed')
       and x.occurred_at < date_trunc('day', now())
       and ((v_user is not null and x.user_id = v_user)
         or (v_guest is not null and x.anonymous_session_id = v_guest))) then
    continue;
   end if;

   -- First-touch attribution snapshot, from the guest browser if known.
   select aa.channel, aa.source, aa.medium, aa.campaign, aa.content, aa.referrer, aa.landing_page
     into a
   from public.acquisition_attribution aa
   where (v_guest is not null and aa.guest_id = v_guest) or (v_user is not null and aa.account_id = v_user)
   order by (v_guest is not null and aa.guest_id = v_guest) desc, aa.first_seen_at
   limit 1;

   insert into public.analytics_events(
    event_id, event_name, side, anonymous_session_id, user_id, dedupe_key,
    channel, source, medium, campaign, content, referrer, landing_page,
    device_type, browser, experiment_id, livemode, is_test, metadata)
   values (
    (e->>'event_id')::uuid, v_name, coalesce(e->>'side', 'server'), v_guest, v_user, nullif(e->>'dedupe_key', ''),
    a.channel, a.source, a.medium, a.campaign, a.content, a.referrer, a.landing_page,
    coalesce(e->>'device_type', 'unknown'), coalesce(e->>'browser', 'other'), nullif(e->>'experiment_id', ''),
    (e->>'livemode')::boolean, coalesce((e->>'is_test')::boolean, false), coalesce(e->'metadata', '{}'::jsonb))
   on conflict do nothing;
   get diagnostics n = row_count;
   v_inserted := v_inserted + n;
  exception when others then
   -- Malformed event: drop it, keep the rest. Analytics never breaks a request.
   null;
  end;
 end loop;
 return v_inserted;
end;
$$;

create function public.api_request_record(p_route text, p_method text, p_status integer, p_duration integer,
 p_db_errors integer, p_error_class text, p_synthetic boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.api_requests(route, method, status, duration_ms, db_errors, error_class, synthetic)
 values (p_route, p_method, p_status, least(greatest(p_duration, 0), 600000), least(greatest(coalesce(p_db_errors, 0), 0), 100),
  p_error_class, coalesce(p_synthetic, false));
 -- Retention without a scheduler: roughly one call in 200 trims old rows.
 if random() < 0.005 then
  delete from public.api_requests where occurred_at < now() - interval '30 days';
 end if;
end;
$$;

-- ------------------------------------------------------------------- reads
-- All STABLE, aggregate-only. p_test is a comma-separated list of account ids
-- to exclude (admin and test accounts), on top of the is_test flags.

create function public.ops_test_ids(p_test text) returns uuid[]
language sql immutable set search_path='' as $$
 select coalesce(array_agg(t::uuid), '{}')
 from unnest(string_to_array(coalesce(p_test, ''), ',')) t
 where t ~ '^[0-9a-fA-F-]{36}$';
$$;

-- Funnel counts by unique person, optionally split by one dimension.
-- A person is the account when known; a guest browser that later logged in is
-- counted as that account (account_guests), so pre-signup steps join up.
create function public.ops_funnel(p_since timestamptz, p_until timestamptz, p_segment text default 'none', p_test text default '')
returns jsonb
language sql stable security definer set search_path='' as $$
 with ids as (select public.ops_test_ids(p_test) t),
 ev as (
  select e.*,
   coalesce(e.user_id,
    (select ag.user_id from public.account_guests ag where ag.guest_id = e.anonymous_session_id order by ag.linked_at limit 1),
    e.anonymous_session_id) as actor
  from public.analytics_events e, ids
  where e.occurred_at >= p_since and e.occurred_at < p_until
    and not e.is_test
    and (e.user_id is null or e.user_id <> all(ids.t))
    -- Money events count only in Stripe live mode.
    and (e.event_name not in ('checkout_started','payment_completed','payment_failed','checkout_expired','unlock_verified')
         or e.livemode is true)
 ),
 seg as (
  select ev.*, case p_segment
    when 'source' then coalesce(ev.channel, 'unknown')
    when 'campaign' then coalesce(ev.campaign, '(none)')
    when 'content' then coalesce(ev.content, '(none)')
    when 'device' then ev.device_type
    when 'browser' then ev.browser
    when 'school' then coalesce(ev.school, '(unknown)')
    when 'experiment' then coalesce(ev.experiment_id, '(none)')
    when 'date' then to_char(ev.occurred_at at time zone 'UTC', 'YYYY-MM-DD')
    else 'all' end as segment
  from ev where ev.actor is not null
 ),
 visits as (
  select segment, actor, count(distinct (occurred_at at time zone 'UTC')::date) days
  from seg where event_name in ('landing_view','return_session') group by segment, actor
 ),
 counts as (
  select segment,
   count(distinct actor) filter (where event_name = 'landing_view') visitors,
   count(distinct actor) filter (where event_name = 'signup_completed') signups,
   count(distinct actor) filter (where event_name = 'my_aid_viewed') qualified,
   count(distinct actor) filter (where event_name = 'upload_started') upload_starters,
   count(distinct actor) filter (where event_name = 'upload_completed') uploaders,
   count(distinct actor) filter (where event_name = 'analysis_completed') analysed,
   count(*) filter (where event_name = 'analysis_completed') analyses,
   count(*) filter (where event_name = 'analysis_failed') analysis_failures,
   count(*) filter (where event_name = 'upload_failed') upload_failures,
   count(distinct actor) filter (where event_name = 'results_viewed') result_viewers,
   count(distinct actor) filter (where event_name = 'checkout_viewed') checkout_viewers,
   count(distinct actor) filter (where event_name = 'checkout_started') checkout_starters,
   count(distinct actor) filter (where event_name = 'payment_completed') payers,
   count(*) filter (where event_name = 'payment_failed') payment_failures,
   count(distinct actor) filter (where event_name = 'return_session') returning_events
  from seg group by segment
 )
 select jsonb_build_object(
  'since', p_since, 'until', p_until, 'segment', p_segment,
  'rows', coalesce(jsonb_agg(jsonb_build_object(
   'segment', c.segment, 'visitors', c.visitors, 'signups', c.signups, 'qualified_sessions', c.qualified,
   'upload_starters', c.upload_starters, 'uploaders', c.uploaders, 'analysed', c.analysed, 'analyses', c.analyses,
   'analysis_failures', c.analysis_failures, 'upload_failures', c.upload_failures,
   'result_viewers', c.result_viewers, 'checkout_viewers', c.checkout_viewers, 'checkout_starters', c.checkout_starters,
   'payers', c.payers, 'payment_failures', c.payment_failures,
   'returning_users', greatest(c.returning_events,
     (select count(*) from visits v where v.segment = c.segment and v.days >= 2)))
   order by c.visitors desc, c.segment), '[]'::jsonb))
 from counts c;
$$;

-- Authoritative money, from the billing tables the webhook writes (not from
-- analytics events): live mode only, admin/test accounts excluded.
create function public.ops_revenue(p_since timestamptz, p_until timestamptz, p_test text default '')
returns jsonb
language sql stable security definer set search_path='' as $$
 with ids as (select public.ops_test_ids(p_test) t),
 paid as (
  select c.* from public.billing_checkouts c, ids
  where c.livemode and c.status = 'paid' and not c.is_test_account and c.account_id <> all(ids.t)
    and c.paid_at >= p_since and c.paid_at < p_until
 ),
 started as (
  select c.* from public.billing_checkouts c, ids
  where c.livemode and not c.is_test_account and c.account_id <> all(ids.t)
    and c.created_at >= p_since and c.created_at < p_until
 ),
 hooks as (
  select * from public.billing_stripe_events
  where livemode and received_at >= p_since and received_at < p_until
 )
 select jsonb_build_object(
  'checkout_starts', (select count(*) from started),
  'checkout_starters', (select count(distinct account_id) from started),
  'payments', (select count(*) from paid),
  'payers', (select count(distinct account_id) from paid),
  'duplicate_payments', (select count(*) from paid where duplicate_payment),
  'revenue_cents', (select coalesce(sum(amount_total), 0) from paid),
  'currency', 'usd',
  'payment_failures', (select count(*) from started where status = 'failed'),
  'checkouts_expired', (select count(*) from started where status = 'expired'),
  'webhook_events', (select count(*) from hooks),
  'webhook_problems', (select count(*) from hooks
     where outcome in ('processing','unknown_session','ownership_mismatch','mode_mismatch','amount_mismatch')),
  'webhook_outcomes', coalesce((select jsonb_object_agg(outcome, n) from
     (select outcome, count(*) n from hooks group by outcome) o), '{}'::jsonb));
$$;

-- Product health over a window: API errors and latency per route, AI reader
-- failures and latency, authentication failures, webhook failures, frontend
-- errors. Synthetic uptime probes are excluded.
create function public.ops_health(p_since timestamptz, p_until timestamptz)
returns jsonb
language sql stable security definer set search_path='' as $$
 with req as (
  select * from public.api_requests
  where occurred_at >= p_since and occurred_at < p_until and not synthetic
 ),
 routes as (
  select route,
   count(*) requests,
   count(*) filter (where status >= 500) errors_5xx,
   count(*) filter (where status >= 400 and status < 500) errors_4xx,
   count(*) filter (where status = 429) rate_limited,
   sum(db_errors) db_errors,
   percentile_cont(0.5) within group (order by duration_ms) p50_ms,
   percentile_cont(0.95) within group (order by duration_ms) p95_ms
  from req group by route
 ),
 ai as (
  select event_name, (metadata->>'ai_ms')::numeric ai_ms
  from public.analytics_events
  where occurred_at >= p_since and occurred_at < p_until and not is_test
    and event_name in ('analysis_completed','analysis_failed')
 )
 select jsonb_build_object(
  'since', p_since, 'until', p_until,
  'requests', (select count(*) from req),
  'errors_5xx', (select count(*) from req where status >= 500),
  'errors_4xx', (select count(*) from req where status >= 400 and status < 500),
  'error_rate', (select case when count(*) = 0 then null else round(count(*) filter (where status >= 500)::numeric / count(*), 4) end from req),
  'db_errors', (select coalesce(sum(db_errors), 0) from req),
  'p50_ms', (select percentile_cont(0.5) within group (order by duration_ms) from req),
  'p95_ms', (select percentile_cont(0.95) within group (order by duration_ms) from req),
  'routes', coalesce((select jsonb_agg(to_jsonb(r) order by r.requests desc) from routes r), '[]'::jsonb),
  'ai', jsonb_build_object(
    'completed', (select count(*) from ai where event_name = 'analysis_completed'),
    'failed', (select count(*) from ai where event_name = 'analysis_failed'),
    'success_rate', (select case when count(*) = 0 then null else round(count(*) filter (where event_name = 'analysis_completed')::numeric / count(*), 4) end from ai),
    'p50_ms', (select percentile_cont(0.5) within group (order by ai_ms) from ai where ai_ms is not null),
    'p95_ms', (select percentile_cont(0.95) within group (order by ai_ms) from ai where ai_ms is not null)),
  'auth_failures', (select count(*) from public.analytics_events
     where event_name = 'login_failed' and occurred_at >= p_since and occurred_at < p_until),
  'webhook_failures', (select count(*) from req where route = '/api/stripe-webhook' and status >= 400),
  'frontend_errors', (select count(*) from public.analytics_events
     where event_name = 'client_error' and occurred_at >= p_since and occurred_at < p_until));
$$;

-- The numbers ops/milestones.yaml is evaluated against. All-time, from the
-- authoritative tables where they exist.
create function public.ops_milestone_metrics(p_test text default '')
returns jsonb
language sql stable security definer set search_path='' as $$
 with ids as (select public.ops_test_ids(p_test) t),
 visitors as (
  select (occurred_at at time zone 'UTC')::date d, count(distinct anonymous_session_id) n
  from public.analytics_events
  where event_name = 'landing_view' and not is_test and occurred_at >= now() - interval '8 days'
  group by 1
 ),
 recent as (
  select * from public.api_requests where occurred_at >= now() - interval '24 hours' and not synthetic
 )
 select jsonb_build_object(
  'registered_users', (select count(*) from public.accounts a, ids where a.user_id <> all(ids.t)),
  'unique_successful_uploaders', (select count(distinct coalesce(u.account_id::text, u.guest_id::text))
     from public.upload_events u, ids
     where u.outcome = 'read' and (u.account_id is null or u.account_id <> all(ids.t))),
  'qualified_sessions', (select count(*) from (
     select coalesce(e.user_id, e.anonymous_session_id)::text p from public.analytics_events e, ids
       where e.event_name = 'my_aid_viewed' and not e.is_test and (e.user_id is null or e.user_id <> all(ids.t))
     union
     select m.account_id::text from public.monetization_events m, ids
       where m.event_type = 'my_aid_page_view' and not m.is_test_account and m.account_id <> all(ids.t)) q
     where p is not null),
  'successful_non_test_payments', (select count(*) from public.billing_entitlements b, ids
     where b.livemode and b.status = 'active' and not b.is_test_account and b.account_id <> all(ids.t)),
  'visitors_last_24h', (select count(distinct anonymous_session_id) from public.analytics_events
     where event_name = 'landing_view' and not is_test and occurred_at >= now() - interval '24 hours'),
  'visitors_daily_avg_7d', (select coalesce(round(avg(n), 2), 0) from visitors where d < (now() at time zone 'UTC')::date),
  'api_requests_24h', (select count(*) from recent),
  'rate_limited_share_24h', (select case when count(*) = 0 then 0 else round(count(*) filter (where status = 429)::numeric / count(*), 4) end from recent),
  'events_last_seen', coalesce((select jsonb_object_agg(event_name, last_seen) from
     (select event_name, max(occurred_at) last_seen from public.analytics_events group by event_name) s), '{}'::jsonb),
  'api_requests_last_seen', (select max(occurred_at) from public.api_requests));
$$;

-- Which migrations production has applied (names only), so the engineering
-- report can flag repo migrations that are not applied yet, and drift.
-- Dynamic SQL because supabase_migrations only exists on Supabase itself.
create function public.ops_applied_migrations()
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 if to_regclass('supabase_migrations.schema_migrations') is null then
  return '[]'::jsonb;
 end if;
 execute 'select coalesce(jsonb_agg(jsonb_build_object(''version'', version, ''name'', name) order by version), ''[]''::jsonb)
          from supabase_migrations.schema_migrations' into v;
 return v;
end;
$$;

revoke all on function public.analytics_record(jsonb), public.api_request_record(text,text,integer,integer,integer,text,boolean),
 public.ops_funnel(timestamptz,timestamptz,text,text), public.ops_revenue(timestamptz,timestamptz,text),
 public.ops_health(timestamptz,timestamptz), public.ops_milestone_metrics(text), public.ops_test_ids(text),
 public.ops_applied_migrations()
 from public, anon, authenticated;
grant execute on function public.analytics_record(jsonb), public.api_request_record(text,text,integer,integer,integer,text,boolean),
 public.ops_funnel(timestamptz,timestamptz,text,text), public.ops_revenue(timestamptz,timestamptz,text),
 public.ops_health(timestamptz,timestamptz), public.ops_milestone_metrics(text), public.ops_test_ids(text),
 public.ops_applied_migrations()
 to service_role;

commit;
