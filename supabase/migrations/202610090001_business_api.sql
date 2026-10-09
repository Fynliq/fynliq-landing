-- FYNQ Business API: approved organizations, hashed API keys, a prepaid
-- credit ledger and a request log, for the paid Aid Q&A API served by FYNQ
-- Cloud (fynq-command-center).
--
-- REVIEW BEFORE APPLYING TO PRODUCTION. Additive only: new tables and
-- functions; nothing existing is changed.
--
-- Data rules:
--   * API keys are stored as SHA-256 hashes; the secret is shown once at creation.
--   * The request log never stores the question. It stores the generated
--     answer for 24 hours only, so an Idempotency-Key retry returns the same
--     answer without charging again; after that the answer is erased.
--   * Credits are a ledger (purchase, usage, refund, grant, adjustment); the
--     balance is the sum. Every change goes through a function below that runs
--     in one transaction under a per-organization lock, so concurrent requests
--     can't spend the same credit twice.
--   * A Stripe Checkout Session can grant credits once (unique index), so
--     webhook retries are harmless.
--
-- Access: RLS on with no policies; everything is granted to service_role only
-- and goes through SECURITY DEFINER functions with search_path=''.
--
-- Rollback (only while no customer data exists):
--   drop function public.biz_apply(text, text, text, text), public.biz_set_status(uuid, text),
--     public.biz_create_key(uuid, text, text, text, boolean), public.biz_revoke_key(uuid),
--     public.biz_authenticate(text), public.biz_balance(uuid),
--     public.biz_reserve(uuid, uuid, text, text, text, integer),
--     public.biz_finish(text, boolean, integer, integer, jsonb),
--     public.biz_grant_purchase(uuid, integer, text, boolean), public.biz_adjust(uuid, integer, text),
--     public.biz_orgs_overview(), public.biz_org_keys(uuid), public.biz_account(uuid);
--   drop table public.business_requests, public.business_credit_ledger, public.business_api_keys, public.business_orgs;
begin;

create table public.business_orgs (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(btrim(name)) between 2 and 120),
 contact_email text not null check (char_length(contact_email) <= 254 and contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,24}$'),
 website text check (website is null or (char_length(website) <= 300 and website ~* '^https?://')),
 use_case text not null check (char_length(btrim(use_case)) between 20 and 2000),
 status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
 created_at timestamptz not null default now(),
 decided_at timestamptz
);
-- One open application or active account per contact email.
create unique index business_orgs_open_email on public.business_orgs (lower(contact_email)) where status in ('pending', 'approved');

create table public.business_api_keys (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.business_orgs(id) on delete cascade,
 name text not null check (char_length(btrim(name)) between 1 and 60),
 prefix text not null check (prefix ~ '^fynq_(live|test)_[A-Za-z0-9]{6}$'),
 key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
 livemode boolean not null,
 created_at timestamptz not null default now(),
 last_used_at timestamptz,
 revoked_at timestamptz
);
create index business_api_keys_org on public.business_api_keys (org_id);

create table public.business_credit_ledger (
 id bigint generated always as identity primary key,
 org_id uuid not null references public.business_orgs(id) on delete restrict,
 delta integer not null check (delta <> 0 and delta between -1000000 and 1000000),
 kind text not null check (kind in ('purchase', 'usage', 'refund', 'grant', 'adjustment')),
 request_id text check (request_id is null or request_id ~ '^req_[a-f0-9]{32}$'),
 stripe_session_id text check (stripe_session_id is null or stripe_session_id ~ '^cs_(live|test)_[A-Za-z0-9]{1,200}$'),
 livemode boolean,
 note text check (note is null or char_length(note) <= 200),
 created_at timestamptz not null default now(),
 check ((kind = 'purchase') = (stripe_session_id is not null)),
 check ((kind in ('usage', 'refund')) = (request_id is not null))
);
create unique index business_ledger_purchase_once on public.business_credit_ledger (stripe_session_id) where kind = 'purchase';
create unique index business_ledger_request_once on public.business_credit_ledger (request_id, kind) where request_id is not null;
create index business_ledger_org on public.business_credit_ledger (org_id);

create table public.business_requests (
 request_id text primary key check (request_id ~ '^req_[a-f0-9]{32}$'),
 org_id uuid not null references public.business_orgs(id) on delete cascade,
 key_id uuid references public.business_api_keys(id) on delete set null,
 endpoint text not null check (endpoint ~ '^[A-Z]+ /api/v1/[a-z/_-]{1,60}$'),
 idempotency_key text check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
 cost integer not null check (cost between 1 and 100),
 state text not null default 'pending' check (state in ('pending', 'succeeded', 'failed')),
 http_status integer check (http_status is null or http_status between 100 and 599),
 latency_ms integer check (latency_ms is null or latency_ms >= 0),
 response jsonb,
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
create unique index business_requests_idempotency on public.business_requests (org_id, idempotency_key) where idempotency_key is not null;
create index business_requests_org_time on public.business_requests (org_id, created_at);

alter table public.business_orgs enable row level security;
alter table public.business_api_keys enable row level security;
alter table public.business_credit_ledger enable row level security;
alter table public.business_requests enable row level security;
revoke all on public.business_orgs, public.business_api_keys, public.business_credit_ledger, public.business_requests from public, anon, authenticated;
grant select, insert, update, delete on public.business_orgs, public.business_api_keys, public.business_credit_ledger, public.business_requests to service_role;

-- ------------------------------------------------------------ applications

create function public.biz_apply(p_name text, p_email text, p_website text, p_use_case text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
 insert into public.business_orgs (name, contact_email, website, use_case)
 values (btrim(p_name), lower(btrim(p_email)), nullif(btrim(coalesce(p_website, '')), ''), btrim(p_use_case))
 returning id into v_id;
 return v_id;
exception when unique_violation then
 raise exception 'already_applied' using errcode = 'P0001';
end $$;

create function public.biz_set_status(p_org uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if p_status not in ('approved', 'rejected', 'suspended') then raise exception 'invalid_status'; end if;
 update public.business_orgs set status = p_status, decided_at = now() where id = p_org;
 if not found then raise exception 'org_not_found'; end if;
end $$;

-- ------------------------------------------------------------------- keys

create function public.biz_create_key(p_org uuid, p_name text, p_prefix text, p_hash text, p_livemode boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
 perform 1 from public.business_orgs where id = p_org and status = 'approved' for update;
 if not found then raise exception 'org_not_approved'; end if;
 if (select count(*) from public.business_api_keys where org_id = p_org and revoked_at is null) >= 10 then raise exception 'too_many_keys'; end if;
 insert into public.business_api_keys (org_id, name, prefix, key_hash, livemode)
 values (p_org, btrim(p_name), p_prefix, p_hash, p_livemode) returning id into v_id;
 return v_id;
end $$;

create function public.biz_revoke_key(p_key uuid) returns boolean
language sql security definer set search_path = '' as $$
 with r as (update public.business_api_keys set revoked_at = now() where id = p_key and revoked_at is null returning 1)
 select exists(select 1 from r);
$$;

-- The only way to turn a presented key into an organization. Unknown or revoked -> null.
create function public.biz_authenticate(p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then return null; end if;
 select k.id key_id, k.livemode, o.id org_id, o.name org_name, o.status org_status into r
 from public.business_api_keys k join public.business_orgs o on o.id = k.org_id
 where k.key_hash = p_hash and k.revoked_at is null;
 if not found then return null; end if;
 update public.business_api_keys set last_used_at = now()
 where id = r.key_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
 return jsonb_build_object('keyId', r.key_id, 'orgId', r.org_id, 'orgName', r.org_name, 'orgStatus', r.org_status, 'livemode', r.livemode);
end $$;

-- ---------------------------------------------------------------- credits

create function public.biz_balance(p_org uuid) returns integer
language sql stable security definer set search_path = '' as $$
 select coalesce(sum(delta), 0)::integer from public.business_credit_ledger where org_id = p_org;
$$;

-- Reserve credits for one request, atomically. Results:
--   reserved      a pending request row and a usage debit now exist
--   replay        same Idempotency-Key already succeeded: its stored answer, no charge
--   in_progress   same Idempotency-Key is still running
--   insufficient  not enough credits (no charge)
--   org_inactive  the organization isn't approved (no charge)
create function public.biz_reserve(p_org uuid, p_key uuid, p_request text, p_endpoint text, p_idem text, p_cost integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_balance integer; v_prev record;
begin
 perform pg_advisory_xact_lock(hashtextextended('biz:' || p_org::text, 0));
 perform 1 from public.business_orgs where id = p_org and status = 'approved';
 if not found then return jsonb_build_object('result', 'org_inactive'); end if;
 if p_idem is not null then
  select state, http_status, response into v_prev from public.business_requests where org_id = p_org and idempotency_key = p_idem;
  if found then
   if v_prev.state = 'succeeded' and v_prev.response is not null then
    return jsonb_build_object('result', 'replay', 'httpStatus', v_prev.http_status, 'response', v_prev.response);
   elsif v_prev.state = 'pending' then
    return jsonb_build_object('result', 'in_progress');
   end if;
   -- A failed (or expired) earlier attempt releases the key for a fresh try.
   update public.business_requests set idempotency_key = null where org_id = p_org and idempotency_key = p_idem;
  end if;
 end if;
 v_balance := public.biz_balance(p_org);
 if v_balance < p_cost then return jsonb_build_object('result', 'insufficient', 'balance', v_balance); end if;
 insert into public.business_requests (request_id, org_id, key_id, endpoint, idempotency_key, cost)
 values (p_request, p_org, p_key, p_endpoint, p_idem, p_cost);
 insert into public.business_credit_ledger (org_id, delta, kind, request_id) values (p_org, -p_cost, 'usage', p_request);
 -- Stored answers are kept 24 hours for idempotent replays, then erased.
 update public.business_requests set response = null
 where org_id = p_org and response is not null and finished_at < now() - interval '24 hours';
 return jsonb_build_object('result', 'reserved', 'balance', v_balance - p_cost);
end $$;

-- Finish a reserved request. A failure refunds its credits exactly once.
create function public.biz_finish(p_request text, p_ok boolean, p_status integer, p_latency integer, p_response jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
 select org_id, cost, state into r from public.business_requests where request_id = p_request for update;
 if not found then raise exception 'request_not_found'; end if;
 if r.state = 'pending' then
  update public.business_requests
  set state = case when p_ok then 'succeeded' else 'failed' end, http_status = p_status, latency_ms = p_latency,
      response = case when p_ok then p_response else null end, finished_at = now()
  where request_id = p_request;
  if not p_ok then
   insert into public.business_credit_ledger (org_id, delta, kind, request_id) values (r.org_id, r.cost, 'refund', p_request)
   on conflict (request_id, kind) where request_id is not null do nothing;
  end if;
 end if;
 return jsonb_build_object('balance', public.biz_balance(r.org_id));
end $$;

-- Credits from a verified, paid Stripe Checkout Session. Once per session.
create function public.biz_grant_purchase(p_org uuid, p_credits integer, p_session text, p_livemode boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
 if p_credits is null or p_credits < 1 or p_credits > 1000000 then raise exception 'invalid_credits'; end if;
 perform 1 from public.business_orgs where id = p_org;
 if not found then raise exception 'org_not_found'; end if;
 insert into public.business_credit_ledger (org_id, delta, kind, stripe_session_id, livemode)
 values (p_org, p_credits, 'purchase', p_session, p_livemode)
 on conflict (stripe_session_id) where kind = 'purchase' do nothing;
 get diagnostics v_rows = row_count;
 return jsonb_build_object('granted', v_rows = 1, 'balance', public.biz_balance(p_org));
end $$;

-- Manual credits from the console (free trial, invoiced customers, corrections).
create function public.biz_adjust(p_org uuid, p_delta integer, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then raise exception 'invalid_delta'; end if;
 perform pg_advisory_xact_lock(hashtextextended('biz:' || p_org::text, 0));
 perform 1 from public.business_orgs where id = p_org;
 if not found then raise exception 'org_not_found'; end if;
 if p_delta < 0 and public.biz_balance(p_org) + p_delta < 0 then raise exception 'balance_would_go_negative'; end if;
 insert into public.business_credit_ledger (org_id, delta, kind, note)
 values (p_org, p_delta, case when p_delta > 0 then 'grant' else 'adjustment' end, left(btrim(coalesce(p_note, '')), 200));
 return jsonb_build_object('balance', public.biz_balance(p_org));
end $$;

-- ------------------------------------------------------------------ views

-- Internal console: every organization with balance, keys and 30-day usage.
create function public.biz_orgs_overview() returns jsonb
language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) from (
  select o.id, o.name, o.contact_email "contactEmail", o.website, o.use_case "useCase", o.status, o.created_at, o.decided_at "decidedAt",
   (select coalesce(sum(delta), 0) from public.business_credit_ledger l where l.org_id = o.id) balance,
   (select coalesce(sum(delta), 0) from public.business_credit_ledger l where l.org_id = o.id and l.kind = 'purchase') "creditsPurchased",
   (select count(*) from public.business_api_keys k where k.org_id = o.id and k.revoked_at is null) "activeKeys",
   (select count(*) from public.business_requests r where r.org_id = o.id and r.created_at > now() - interval '30 days') "requests30d",
   (select count(*) from public.business_requests r where r.org_id = o.id and r.created_at > now() - interval '30 days' and r.state = 'failed') "failed30d"
  from public.business_orgs o) x;
$$;

create function public.biz_org_keys(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'prefix', prefix, 'livemode', livemode,
   'createdAt', created_at, 'lastUsedAt', last_used_at, 'revokedAt', revoked_at) order by created_at desc), '[]'::jsonb)
 from public.business_api_keys where org_id = p_org;
$$;

-- What a customer may see about itself (GET /api/v1/account).
create function public.biz_account(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
  'name', o.name, 'status', o.status, 'balance', public.biz_balance(o.id),
  'requests30d', (select count(*) from public.business_requests r where r.org_id = o.id and r.created_at > now() - interval '30 days'),
  'succeeded30d', (select count(*) from public.business_requests r where r.org_id = o.id and r.created_at > now() - interval '30 days' and r.state = 'succeeded'),
  'creditsUsed30d', (select coalesce(-sum(delta), 0) from public.business_credit_ledger l where l.org_id = o.id and l.kind in ('usage', 'refund') and l.created_at > now() - interval '30 days'))
 from public.business_orgs o where o.id = p_org;
$$;

revoke all on function
 public.biz_apply(text, text, text, text), public.biz_set_status(uuid, text),
 public.biz_create_key(uuid, text, text, text, boolean), public.biz_revoke_key(uuid),
 public.biz_authenticate(text), public.biz_balance(uuid),
 public.biz_reserve(uuid, uuid, text, text, text, integer),
 public.biz_finish(text, boolean, integer, integer, jsonb),
 public.biz_grant_purchase(uuid, integer, text, boolean), public.biz_adjust(uuid, integer, text),
 public.biz_orgs_overview(), public.biz_org_keys(uuid), public.biz_account(uuid)
from public, anon, authenticated;
grant execute on function
 public.biz_apply(text, text, text, text), public.biz_set_status(uuid, text),
 public.biz_create_key(uuid, text, text, text, boolean), public.biz_revoke_key(uuid),
 public.biz_authenticate(text), public.biz_balance(uuid),
 public.biz_reserve(uuid, uuid, text, text, text, integer),
 public.biz_finish(text, boolean, integer, integer, jsonb),
 public.biz_grant_purchase(uuid, integer, text, boolean), public.biz_adjust(uuid, integer, text),
 public.biz_orgs_overview(), public.biz_org_keys(uuid), public.biz_account(uuid)
to service_role;

commit;
