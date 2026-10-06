-- Marketing attribution: which traffic source first brought each FYNQ
-- visitor (a TikTok video, Instagram, Google, a shared link...), kept with
-- their guest browser and, once they sign up, their account, so a $1
-- purchase can be traced back to where it started.
--
-- Apply after 202610050001_cost_estimate_kind.sql. REVIEW BEFORE APPLYING.
-- Safe to apply before or after the app code that calls it: until the code
-- is live nothing writes here, and until this is applied the app's calls
-- fail quietly and change nothing.
--
-- Identity: reuses the existing guest (public.anonymous_users) and account
-- (public.accounts + public.account_guests) model. One row per guest
-- browser. No new identity system.
--
-- First touch: the source columns are written once, when a guest's first
-- visit is recorded, and are never overwritten. Later visits that carry a
-- real signal (UTM tags, an ad click id, an outside referrer) update the
-- last_* columns instead, for last-touch analysis later. Plain direct
-- visits only move last_seen_at.
--
-- Existing data is never guessed at: every guest browser that exists when
-- this is applied gets channel 'legacy' (shown as "Legacy / Unattributed"),
-- and so does a browser first recorded more than 30 minutes after it was
-- created, because its real first visit was missed.
--
-- What is stored: UTM values, the referring site's host name only (never
-- the full referring URL), the landing path only (never the query string),
-- and times. No names, emails, IP addresses, document content or aid data.
--
-- Access: RLS on with no policies, revoked from anon and authenticated.
-- Only the service role (server code and the Command Center) can read it,
-- and browsers only ever write through the server.
begin;

create table public.acquisition_attribution (
 id uuid primary key default gen_random_uuid(),
 guest_id uuid unique references public.anonymous_users(id) on delete cascade,
 account_id uuid references public.accounts(user_id) on delete set null,
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),

 -- First touch. Written once.
 attribution_type text not null check (attribution_type in ('utm','click_id','referrer','direct','legacy')),
 channel text not null check (channel in ('tiktok','instagram','facebook','google','referral','direct','other','legacy')),
 source text check (source is null or char_length(source) between 1 and 100),
 medium text check (medium is null or char_length(medium) between 1 and 100),
 campaign text check (campaign is null or char_length(campaign) between 1 and 150),
 content text check (content is null or char_length(content) between 1 and 150),
 term text check (term is null or char_length(term) between 1 and 150),
 landing_page text check (landing_page is null or landing_page ~ '^/[A-Za-z0-9/_.-]{0,199}$'),
 referrer text check (referrer is null or referrer ~ '^[a-z0-9.-]{1,253}$'),
 raw_utm jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_utm) = 'object' and length(raw_utm::text) <= 1200),

 -- Last non-direct touch. Updated on every visit that carries a signal.
 last_touch_at timestamptz,
 last_attribution_type text check (last_attribution_type is null or last_attribution_type in ('utm','click_id','referrer')),
 last_channel text check (last_channel is null or last_channel in ('tiktok','instagram','facebook','google','referral','other')),
 last_source text check (last_source is null or char_length(last_source) between 1 and 100),
 last_medium text check (last_medium is null or char_length(last_medium) between 1 and 100),
 last_campaign text check (last_campaign is null or char_length(last_campaign) between 1 and 150),
 last_content text check (last_content is null or char_length(last_content) between 1 and 150),
 last_term text check (last_term is null or char_length(last_term) between 1 and 150),
 last_landing_page text check (last_landing_page is null or last_landing_page ~ '^/[A-Za-z0-9/_.-]{0,199}$'),
 last_referrer text check (last_referrer is null or last_referrer ~ '^[a-z0-9.-]{1,253}$'),

 touch_count integer not null default 1 check (touch_count >= 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (guest_id is not null or account_id is not null)
);
create index acquisition_attribution_account on public.acquisition_attribution(account_id);
create index acquisition_attribution_channel on public.acquisition_attribution(channel, first_seen_at);
create index acquisition_attribution_source on public.acquisition_attribution(source);
create index acquisition_attribution_campaign on public.acquisition_attribution(campaign, content);
create index acquisition_attribution_first_seen on public.acquisition_attribution(first_seen_at);

alter table public.acquisition_attribution enable row level security;
revoke all on public.acquisition_attribution from public, anon, authenticated;
grant all on public.acquisition_attribution to service_role;

-- Existing guest browsers: Legacy / Unattributed, linked to their account
-- when they already have one. Nothing is inferred about where they came from.
insert into public.acquisition_attribution(guest_id, account_id, first_seen_at, last_seen_at, attribution_type, channel, touch_count)
select u.id,
 (select g.user_id from public.account_guests g where g.guest_id = u.id order by g.linked_at limit 1),
 u.created_at, coalesce(u.last_active_at, u.created_at), 'legacy', 'legacy', 0
from public.anonymous_users u;

-- ------------------------------------------------------------------ visits

-- Records one visit from a guest browser. p_touch has already been
-- classified and cleaned by the server (server/attribution.js); this
-- function cleans it again and never trusts its shape.
-- Returns 'first_touch', 'legacy', 'touched' or 'unknown_guest'.
create function public.attribution_touch(p_guest uuid, p_touch jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare
 v_created timestamptz;
 v_type text := p_touch->>'attribution_type';
 v_channel text := p_touch->>'channel';
 v_source text := left(nullif(btrim(lower(p_touch->>'source')), ''), 100);
 v_medium text := left(nullif(btrim(lower(p_touch->>'medium')), ''), 100);
 v_campaign text := left(nullif(btrim(lower(p_touch->>'campaign')), ''), 150);
 v_content text := left(nullif(btrim(lower(p_touch->>'content')), ''), 150);
 v_term text := left(nullif(btrim(lower(p_touch->>'term')), ''), 150);
 v_landing text := case when p_touch->>'landing_page' ~ '^/[A-Za-z0-9/_.-]{0,199}$' then p_touch->>'landing_page' end;
 v_referrer text := case when lower(p_touch->>'referrer') ~ '^[a-z0-9.-]{1,253}$' then lower(p_touch->>'referrer') end;
 v_raw jsonb := case when jsonb_typeof(p_touch->'raw_utm') = 'object' and length((p_touch->'raw_utm')::text) <= 1200
  then p_touch->'raw_utm' else '{}'::jsonb end;
 v_signal boolean;
 v_legacy boolean;
 v_account uuid;
begin
 select created_at into v_created from public.anonymous_users where id = p_guest;
 if not found then return 'unknown_guest'; end if;

 if v_type is null or v_type not in ('utm','click_id','referrer','direct')
  or v_channel is null or v_channel not in ('tiktok','instagram','facebook','google','referral','direct','other')
  or (v_type = 'direct') <> (v_channel = 'direct') then
  v_type := 'direct'; v_channel := 'direct';
 end if;
 if v_type = 'direct' then
  v_source := null; v_medium := null; v_campaign := null; v_content := null; v_term := null; v_referrer := null; v_raw := '{}'::jsonb;
 end if;
 v_signal := v_type <> 'direct';

 -- A returning browser: first touch stays exactly as it was.
 update public.acquisition_attribution set
  last_seen_at = now(), touch_count = touch_count + 1, updated_at = now(),
  last_touch_at = case when v_signal then now() else last_touch_at end,
  last_attribution_type = case when v_signal then v_type else last_attribution_type end,
  last_channel = case when v_signal then v_channel else last_channel end,
  last_source = case when v_signal then v_source else last_source end,
  last_medium = case when v_signal then v_medium else last_medium end,
  last_campaign = case when v_signal then v_campaign else last_campaign end,
  last_content = case when v_signal then v_content else last_content end,
  last_term = case when v_signal then v_term else last_term end,
  last_landing_page = case when v_signal then v_landing else last_landing_page end,
  last_referrer = case when v_signal then v_referrer else last_referrer end
 where guest_id = p_guest;
 if found then return 'touched'; end if;

 -- First record for this browser. If the browser is older than 30 minutes
 -- its real first visit was missed, so it is legacy, not this visit's source.
 v_legacy := v_created < now() - interval '30 minutes';
 select g.user_id into v_account from public.account_guests g where g.guest_id = p_guest order by g.linked_at limit 1;
 insert into public.acquisition_attribution(
  guest_id, account_id, first_seen_at, last_seen_at, attribution_type, channel,
  source, medium, campaign, content, term, landing_page, referrer, raw_utm,
  last_touch_at, last_attribution_type, last_channel, last_source, last_medium, last_campaign, last_content, last_term, last_landing_page, last_referrer)
 values (
  p_guest, v_account, v_created, now(),
  case when v_legacy then 'legacy' else v_type end,
  case when v_legacy then 'legacy' else v_channel end,
  case when v_legacy then null else v_source end,
  case when v_legacy then null else v_medium end,
  case when v_legacy then null else v_campaign end,
  case when v_legacy then null else v_content end,
  case when v_legacy then null else v_term end,
  case when v_legacy then null else v_landing end,
  case when v_legacy then null else v_referrer end,
  case when v_legacy then '{}'::jsonb else v_raw end,
  case when v_signal then now() end,
  case when v_signal then v_type end,
  case when v_signal then v_channel end,
  case when v_signal then v_source end,
  case when v_signal then v_medium end,
  case when v_signal then v_campaign end,
  case when v_signal then v_content end,
  case when v_signal then v_term end,
  case when v_signal then v_landing end,
  case when v_signal then v_referrer end)
 on conflict (guest_id) do update set
  last_seen_at = now(), touch_count = public.acquisition_attribution.touch_count + 1, updated_at = now();
 return case when v_legacy then 'legacy' else 'first_touch' end;
end;
$$;

-- ---------------------------------------------------------------- accounts

-- When a guest browser is linked to an account (sign-up, log-in, or a
-- returning logged-in visit), its attribution row is attached to that
-- account. This hooks the existing link table, so account_start_session
-- and account_link_guest need no changes.
create function public.attribution_link_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.acquisition_attribution set account_id = new.user_id, updated_at = now()
 where guest_id = new.guest_id and account_id is null;
 return new;
end;
$$;
create trigger account_guests_attribution after insert on public.account_guests
 for each row execute function public.attribution_link_account();

-- An account's first-touch attribution: the earliest-seen of all the guest
-- browsers it has used. An account created before its earliest recorded
-- visit existed before attribution could see it, so it is legacy.
-- Returns null for an unknown account.
create function public.attribution_for_account(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with acct as (select created_at from public.accounts where user_id = p_user),
 best as (
  select x.* from public.acquisition_attribution x
  where x.account_id = p_user or x.guest_id in (select g.guest_id from public.account_guests g where g.user_id = p_user)
  order by x.first_seen_at, x.created_at limit 1)
 select case
  when best.id is null or best.channel = 'legacy' or acct.created_at < best.first_seen_at
   then jsonb_build_object('id', best.id, 'guest_id', best.guest_id, 'attribution_type', 'legacy', 'channel', 'legacy')
  else jsonb_build_object('id', best.id, 'guest_id', best.guest_id, 'attribution_type', best.attribution_type,
   'channel', best.channel, 'source', best.source, 'medium', best.medium, 'campaign', best.campaign,
   'content', best.content, 'first_seen_at', best.first_seen_at)
 end
 from acct left join best on true;
$$;

-- ----------------------------------------------------------------- payments

-- Each Checkout Session keeps the account's first touch as it was when the
-- checkout started (or, for one started before attribution existed, when it
-- was paid), so the purchase stays traceable even if links change later.
alter table public.billing_checkouts
 add column attribution_id uuid references public.acquisition_attribution(id) on delete set null,
 add column attribution_channel text check (attribution_channel is null or attribution_channel in ('tiktok','instagram','facebook','google','referral','direct','other','legacy')),
 add column attribution_source text check (attribution_source is null or char_length(attribution_source) <= 100),
 add column attribution_campaign text check (attribution_campaign is null or char_length(attribution_campaign) <= 150),
 add column attribution_content text check (attribution_content is null or char_length(attribution_content) <= 150);

-- Checkouts that already exist predate attribution.
update public.billing_checkouts set attribution_channel = 'legacy' where attribution_channel is null;

create function public.attribution_stamp_checkout() returns trigger
language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 if new.attribution_channel is null and (tg_op = 'INSERT' or new.status = 'paid') then
  v := public.attribution_for_account(new.account_id);
  if v is not null then
   new.attribution_id := (v->>'id')::uuid;
   new.attribution_channel := v->>'channel';
   new.attribution_source := v->>'source';
   new.attribution_campaign := v->>'campaign';
   new.attribution_content := v->>'content';
  end if;
 end if;
 return new;
end;
$$;
create trigger billing_checkouts_attribution before insert or update of status on public.billing_checkouts
 for each row execute function public.attribution_stamp_checkout();

revoke all on function
 public.attribution_touch(uuid, jsonb),
 public.attribution_for_account(uuid),
 public.attribution_link_account(),
 public.attribution_stamp_checkout()
from public, anon, authenticated;
grant execute on function
 public.attribution_touch(uuid, jsonb),
 public.attribution_for_account(uuid)
to service_role;
commit;

-- After applying, every existing guest browser should be legacy:
--   select channel, count(*) from public.acquisition_attribution group by 1;
