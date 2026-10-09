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
--     answer without charging again; after that the answer is erased. When an
--     Idempotency-Key is sent, a keyed HMAC fingerprint of the (redacted)
--     question is kept for the same 24 hours, to refuse reusing the key for a
--     different question; without a key, nothing about the question is kept.
--   * Credits are a ledger (purchase, usage, refund, grant, adjustment,
--     reversal); the balance is the sum, kept SEPARATELY for test and live
--     mode: test credits (Stripe test payments) can never pay for live use,
--     and live credits are never spent by test keys.
--   * A reservation that never finishes (function killed, network lost) is
--     marked failed and refunded after 2 minutes, on the org's next request.
--   * A refunded or disputed Stripe payment takes its credits back
--     (a reversal; the balance may go negative). A dispute suspends the org. Every change goes through a function below that runs
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
--     public.biz_authenticate(text), public.biz_balance(uuid, boolean),
--     public.biz_reserve(uuid, uuid, text, text, text, text, integer, boolean),
--     public.biz_finish(text, boolean, integer, integer, jsonb),
--     public.biz_grant_purchase(uuid, integer, text, text, boolean),
--     public.biz_reverse_purchase(text, bigint, bigint, boolean, boolean), public.biz_sweep(uuid),
--     public.biz_adjust(uuid, integer, text, boolean),
--     public.biz_orgs_overview(), public.biz_org_keys(uuid), public.biz_account(uuid, boolean);
--   drop table public.business_pending_reversals, public.business_requests, public.business_credit_ledger, public.business_api_keys, public.business_orgs;
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
 kind text not null check (kind in ('purchase', 'usage', 'refund', 'grant', 'adjustment', 'reversal')),
 request_id text check (request_id is null or request_id ~ '^req_[a-f0-9]{32}$'),
 stripe_session_id text check (stripe_session_id is null or stripe_session_id ~ '^cs_(live|test)_[A-Za-z0-9]{1,200}$'),
 stripe_payment_intent text check (stripe_payment_intent is null or stripe_payment_intent ~ '^pi_[A-Za-z0-9]{1,200}$'),
 livemode boolean not null,
 note text check (note is null or char_length(note) <= 200),
 created_at timestamptz not null default now(),
 check ((kind = 'purchase') = (stripe_session_id is not null)),
 check ((kind = 'reversal') <= (stripe_payment_intent is not null)),
 check ((kind in ('usage', 'refund')) = (request_id is not null))
);
create unique index business_ledger_purchase_once on public.business_credit_ledger (stripe_session_id) where kind = 'purchase';
create unique index business_ledger_request_once on public.business_credit_ledger (request_id, kind) where request_id is not null;
create index business_ledger_org on public.business_credit_ledger (org_id, livemode);
create index business_ledger_payment_intent on public.business_credit_ledger (stripe_payment_intent) where stripe_payment_intent is not null;

create table public.business_requests (
 request_id text primary key check (request_id ~ '^req_[a-f0-9]{32}$'),
 org_id uuid not null references public.business_orgs(id) on delete cascade,
 key_id uuid references public.business_api_keys(id) on delete set null,
 endpoint text not null check (endpoint ~ '^[A-Z]+ /api/v1/[a-z/_-]{1,60}$'),
 idempotency_key text check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
 fingerprint text check (fingerprint is null or fingerprint ~ '^[a-f0-9]{64}$'),
 livemode boolean not null,
 cost integer not null check (cost between 1 and 100),
 state text not null default 'pending' check (state in ('pending', 'succeeded', 'failed')),
 http_status integer check (http_status is null or http_status between 100 and 599),
 latency_ms integer check (latency_ms is null or latency_ms >= 0),
 response jsonb,
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
create unique index business_requests_idempotency on public.business_requests (org_id, livemode, idempotency_key) where idempotency_key is not null;
create index business_requests_org_time on public.business_requests (org_id, created_at);
create index business_requests_pending on public.business_requests (org_id, created_at) where state = 'pending';
create index business_requests_stored on public.business_requests (finished_at) where response is not null or fingerprint is not null;

-- A refund or dispute that arrives before its purchase was credited (the grant
-- is still being retried). Applied by biz_grant_purchase when the grant lands.
-- Holds only Stripe ids and amounts. Refunds of non-business charges also land
-- here (they never match a purchase) and are harmless.
create table public.business_pending_reversals (
 stripe_payment_intent text primary key check (stripe_payment_intent ~ '^pi_[A-Za-z0-9]{1,200}$'),
 reversed_amount bigint not null check (reversed_amount >= 0),
 total_amount bigint not null check (total_amount > 0),
 livemode boolean not null,
 dispute boolean not null,
 created_at timestamptz not null default now()
);

alter table public.business_pending_reversals enable row level security;
alter table public.business_orgs enable row level security;
alter table public.business_api_keys enable row level security;
alter table public.business_credit_ledger enable row level security;
alter table public.business_requests enable row level security;
revoke all on public.business_orgs, public.business_api_keys, public.business_credit_ledger, public.business_requests, public.business_pending_reversals from public, anon, authenticated;
grant select, insert, update, delete on public.business_orgs, public.business_api_keys, public.business_credit_ledger, public.business_requests, public.business_pending_reversals to service_role;
revoke all on sequence public.business_credit_ledger_id_seq from public, anon, authenticated;
grant usage, select on sequence public.business_credit_ledger_id_seq to service_role;

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
exception when unique_violation then
 -- Re-approving an org whose email already has another open application or account.
 raise exception 'email_in_use' using errcode = 'P0001';
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

-- Balance in one mode. Test and live credits never mix.
create function public.biz_balance(p_org uuid, p_livemode boolean) returns integer
language sql stable security definer set search_path = '' as $$
 select coalesce(sum(delta), 0)::integer from public.business_credit_ledger where org_id = p_org and livemode = p_livemode;
$$;

-- Fail and refund this organization's reservations still pending after 2
-- minutes (killed function, lost connection). Caller holds the org lock.
create function public.biz_sweep(p_org uuid) returns void
language sql security definer set search_path = '' as $$
 with stale as (
  update public.business_requests set state = 'failed', http_status = 504, finished_at = now()
  where org_id = p_org and state = 'pending' and created_at < now() - interval '2 minutes'
  returning request_id, org_id, cost, livemode)
 insert into public.business_credit_ledger (org_id, delta, kind, request_id, livemode)
 select org_id, cost, 'refund', request_id, livemode from stale
 on conflict (request_id, kind) where request_id is not null do nothing;
$$;

-- Reserve credits for one request, atomically, in the key's mode. Results:
--   reserved      a pending request row and a usage debit now exist
--   replay        same Idempotency-Key and question succeeded in the last 24 h: its stored answer, no charge
--   mismatch      same Idempotency-Key was used for a different question (no charge)
--   in_progress   same Idempotency-Key is still running
--   insufficient  not enough credits (no charge)
--   org_inactive  the organization isn't approved (no charge)
create function public.biz_reserve(p_org uuid, p_key uuid, p_request text, p_endpoint text, p_idem text, p_fingerprint text, p_cost integer, p_livemode boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_balance integer; v_prev record;
begin
 if p_livemode is null then raise exception 'invalid_input'; end if;
 if (p_idem is null) <> (p_fingerprint is null) then raise exception 'invalid_input'; end if;
 perform pg_advisory_xact_lock(hashtextextended('biz:' || p_org::text, 0));
 perform 1 from public.business_orgs where id = p_org and status = 'approved';
 if not found then return jsonb_build_object('result', 'org_inactive'); end if;
 perform public.biz_sweep(p_org);
 if p_idem is not null then
  select state, http_status, response, fingerprint, finished_at into v_prev from public.business_requests
  where org_id = p_org and livemode = p_livemode and idempotency_key = p_idem;
  if found then
   if v_prev.state = 'pending' then
    return jsonb_build_object('result', 'in_progress');
   elsif v_prev.state = 'succeeded' and v_prev.response is not null and v_prev.finished_at > now() - interval '24 hours' then
    if v_prev.fingerprint is distinct from p_fingerprint then return jsonb_build_object('result', 'mismatch'); end if;
    return jsonb_build_object('result', 'replay', 'httpStatus', v_prev.http_status, 'response', v_prev.response,
                              'balance', public.biz_balance(p_org, p_livemode));
   end if;
   -- A failed or expired earlier attempt releases the key for a fresh try.
   update public.business_requests set idempotency_key = null where org_id = p_org and livemode = p_livemode and idempotency_key = p_idem;
  end if;
 end if;
 v_balance := public.biz_balance(p_org, p_livemode);
 if v_balance < p_cost then return jsonb_build_object('result', 'insufficient', 'balance', v_balance); end if;
 insert into public.business_requests (request_id, org_id, key_id, endpoint, idempotency_key, fingerprint, livemode, cost)
 values (p_request, p_org, p_key, p_endpoint, p_idem, p_fingerprint, p_livemode, p_cost);
 insert into public.business_credit_ledger (org_id, delta, kind, request_id, livemode) values (p_org, -p_cost, 'usage', p_request, p_livemode);
 return jsonb_build_object('result', 'reserved', 'balance', v_balance - p_cost);
end $$;

-- Finish a reserved request. A failure refunds its credits exactly once.
create function public.biz_finish(p_request text, p_ok boolean, p_status integer, p_latency integer, p_response jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
 select org_id, cost, state, livemode into r from public.business_requests where request_id = p_request for update;
 if not found then raise exception 'request_not_found'; end if;
 if r.state = 'pending' then
  update public.business_requests
  set state = case when p_ok then 'succeeded' else 'failed' end, http_status = p_status, latency_ms = p_latency,
      response = case when p_ok then p_response else null end, finished_at = now()
  where request_id = p_request;
  if not p_ok then
   insert into public.business_credit_ledger (org_id, delta, kind, request_id, livemode) values (r.org_id, r.cost, 'refund', p_request, r.livemode)
   on conflict (request_id, kind) where request_id is not null do nothing;
  end if;
 end if;
 -- Stored answers are kept 24 hours for idempotent replays, then erased (all organizations).
 update public.business_requests set response = null, fingerprint = null
 where (response is not null or fingerprint is not null) and finished_at < now() - interval '24 hours';
 return jsonb_build_object('balance', public.biz_balance(r.org_id, r.livemode), 'state', (select state from public.business_requests where request_id = p_request));
end $$;

-- Credits from a verified, paid Stripe Checkout Session. Once per session.
create function public.biz_grant_purchase(p_org uuid, p_credits integer, p_session text, p_payment_intent text, p_livemode boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rows integer; v_pending record;
begin
 if p_credits is null or p_credits < 1 or p_credits > 1000000 then raise exception 'invalid_credits'; end if;
 if p_livemode is null then raise exception 'invalid_input'; end if;
 perform pg_advisory_xact_lock(hashtextextended('biz:' || p_org::text, 0));
 perform 1 from public.business_orgs where id = p_org;
 if not found then raise exception 'org_not_found'; end if;
 insert into public.business_credit_ledger (org_id, delta, kind, stripe_session_id, stripe_payment_intent, livemode)
 values (p_org, p_credits, 'purchase', p_session, p_payment_intent, p_livemode)
 on conflict (stripe_session_id) where kind = 'purchase' do nothing;
 get diagnostics v_rows = row_count;
 -- A refund or dispute that arrived first is applied now.
 if v_rows = 1 and p_payment_intent is not null then
  select * into v_pending from public.business_pending_reversals where stripe_payment_intent = p_payment_intent and livemode = p_livemode;
  if found then
   perform public.biz_reverse_purchase(p_payment_intent, v_pending.reversed_amount, v_pending.total_amount, p_livemode, v_pending.dispute);
   delete from public.business_pending_reversals where stripe_payment_intent = p_payment_intent;
  end if;
 end if;
 return jsonb_build_object('granted', v_rows = 1, 'balance', public.biz_balance(p_org, p_livemode));
end $$;

-- A refunded or disputed payment takes back its credits, in proportion to the
-- amount refunded (all of them for a dispute). Cumulative: Stripe sends the
-- running refunded total, so repeated or partial events reverse only the
-- difference. The balance may go negative. A dispute also suspends the org.
create function public.biz_reverse_purchase(p_payment_intent text, p_reversed_amount bigint, p_total_amount bigint, p_livemode boolean, p_dispute boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_purchase record; v_target integer; v_done integer; v_delta integer;
begin
 if p_payment_intent is null or p_total_amount is null or p_total_amount <= 0 or p_reversed_amount is null or p_reversed_amount < 0 then raise exception 'invalid_input'; end if;
 select org_id, delta, livemode into v_purchase from public.business_credit_ledger
 where kind = 'purchase' and stripe_payment_intent = p_payment_intent and livemode = p_livemode;
 if not found then
  -- Not credited (yet): remember the largest reversal; biz_grant_purchase applies it if the purchase lands later.
  insert into public.business_pending_reversals (stripe_payment_intent, reversed_amount, total_amount, livemode, dispute)
  values (p_payment_intent, p_reversed_amount, p_total_amount, p_livemode, p_dispute)
  on conflict (stripe_payment_intent) do update set
   reversed_amount = greatest(public.business_pending_reversals.reversed_amount, excluded.reversed_amount),
   dispute = public.business_pending_reversals.dispute or excluded.dispute;
  return jsonb_build_object('result', 'no_purchase');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('biz:' || v_purchase.org_id::text, 0));
 v_target := case when p_dispute then v_purchase.delta
                  else least(v_purchase.delta, ceil(v_purchase.delta::numeric * p_reversed_amount / p_total_amount)::integer) end;
 select coalesce(-sum(delta), 0)::integer into v_done from public.business_credit_ledger
 where kind = 'reversal' and stripe_payment_intent = p_payment_intent;
 v_delta := v_target - v_done;
 if v_delta > 0 then
  insert into public.business_credit_ledger (org_id, delta, kind, stripe_payment_intent, livemode, note)
  values (v_purchase.org_id, -v_delta, 'reversal', p_payment_intent, v_purchase.livemode, case when p_dispute then 'Stripe dispute' else 'Stripe refund' end);
 end if;
 if p_dispute then
  update public.business_orgs set status = 'suspended', decided_at = now() where id = v_purchase.org_id and status = 'approved';
 end if;
 return jsonb_build_object('result', 'reversed', 'credits', greatest(v_delta, 0), 'balance', public.biz_balance(v_purchase.org_id, v_purchase.livemode));
end $$;

-- Manual credits from the console (free trial, invoiced customers, corrections), in one mode.
create function public.biz_adjust(p_org uuid, p_delta integer, p_note text, p_livemode boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then raise exception 'invalid_delta'; end if;
 if p_livemode is null then raise exception 'invalid_input'; end if;
 perform pg_advisory_xact_lock(hashtextextended('biz:' || p_org::text, 0));
 perform 1 from public.business_orgs where id = p_org;
 if not found then raise exception 'org_not_found'; end if;
 if p_delta < 0 and public.biz_balance(p_org, p_livemode) + p_delta < 0 then raise exception 'balance_would_go_negative'; end if;
 insert into public.business_credit_ledger (org_id, delta, kind, note, livemode)
 values (p_org, p_delta, case when p_delta > 0 then 'grant' else 'adjustment' end, left(btrim(coalesce(p_note, '')), 200), p_livemode);
 return jsonb_build_object('balance', public.biz_balance(p_org, p_livemode));
end $$;

-- ------------------------------------------------------------------ views

-- Internal console: every organization with balance, keys and 30-day usage.
create function public.biz_orgs_overview() returns jsonb
language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) from (
  select o.id, o.name, o.contact_email "contactEmail", o.website, o.use_case "useCase", o.status, o.created_at, o.decided_at "decidedAt",
   public.biz_balance(o.id, true) balance,
   public.biz_balance(o.id, false) "testBalance",
   (select coalesce(sum(delta), 0) from public.business_credit_ledger l where l.org_id = o.id and l.livemode and l.kind = 'purchase') "creditsPurchased",
   (select coalesce(-sum(delta), 0) from public.business_credit_ledger l where l.org_id = o.id and l.livemode and l.kind = 'reversal') "creditsReversed",
   (select count(*) from public.business_api_keys k where k.org_id = o.id and k.revoked_at is null) "activeKeys",
   (select count(*) from public.business_requests r where r.org_id = o.id and r.livemode and r.created_at > now() - interval '30 days') "requests30d",
   (select count(*) from public.business_requests r where r.org_id = o.id and r.livemode and r.created_at > now() - interval '30 days' and r.state = 'failed') "failed30d"
  from public.business_orgs o) x;
$$;

create function public.biz_org_keys(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'prefix', prefix, 'livemode', livemode,
   'createdAt', created_at, 'lastUsedAt', last_used_at, 'revokedAt', revoked_at) order by created_at desc), '[]'::jsonb)
 from public.business_api_keys where org_id = p_org;
$$;

-- What a customer may see about itself (GET /api/v1/account), in the calling key's mode.
-- Sweeps stale reservations first, so the balance it reports is current.
create function public.biz_account(p_org uuid, p_livemode boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('biz:' || p_org::text, 0));
 perform public.biz_sweep(p_org);
 select jsonb_build_object(
  'name', o.name, 'status', o.status, 'balance', public.biz_balance(o.id, p_livemode),
  'requests30d', (select count(*) from public.business_requests r where r.org_id = o.id and r.livemode = p_livemode and r.created_at > now() - interval '30 days'),
  'succeeded30d', (select count(*) from public.business_requests r where r.org_id = o.id and r.livemode = p_livemode and r.created_at > now() - interval '30 days' and r.state = 'succeeded'),
  'creditsUsed30d', (select coalesce(-sum(delta), 0) from public.business_credit_ledger l where l.org_id = o.id and l.livemode = p_livemode and l.kind in ('usage', 'refund') and l.created_at > now() - interval '30 days'))
 into v from public.business_orgs o where o.id = p_org;
 return v;
end $$;

revoke all on function
 public.biz_apply(text, text, text, text), public.biz_set_status(uuid, text),
 public.biz_create_key(uuid, text, text, text, boolean), public.biz_revoke_key(uuid),
 public.biz_authenticate(text), public.biz_balance(uuid, boolean),
 public.biz_reserve(uuid, uuid, text, text, text, text, integer, boolean),
 public.biz_finish(text, boolean, integer, integer, jsonb),
 public.biz_grant_purchase(uuid, integer, text, text, boolean),
 public.biz_reverse_purchase(text, bigint, bigint, boolean, boolean), public.biz_sweep(uuid),
 public.biz_adjust(uuid, integer, text, boolean),
 public.biz_orgs_overview(), public.biz_org_keys(uuid), public.biz_account(uuid, boolean)
from public, anon, authenticated;
grant execute on function
 public.biz_apply(text, text, text, text), public.biz_set_status(uuid, text),
 public.biz_create_key(uuid, text, text, text, boolean), public.biz_revoke_key(uuid),
 public.biz_authenticate(text), public.biz_balance(uuid, boolean),
 public.biz_reserve(uuid, uuid, text, text, text, text, integer, boolean),
 public.biz_finish(text, boolean, integer, integer, jsonb),
 public.biz_grant_purchase(uuid, integer, text, text, boolean),
 public.biz_reverse_purchase(text, bigint, bigint, boolean, boolean), public.biz_sweep(uuid),
 public.biz_adjust(uuid, integer, text, boolean),
 public.biz_orgs_overview(), public.biz_org_keys(uuid), public.biz_account(uuid, boolean)
to service_role;

commit;
