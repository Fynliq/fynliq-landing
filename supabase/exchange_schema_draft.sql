-- FYNLIQ EXCHANGE: DEVELOPMENT SCHEMA DRAFT ONLY.
-- Do not execute against production without integration tests, verified checkout,
-- fraud controls, payment webhooks, and privacy/security review.
-- Use a dedicated sandbox Supabase project during implementation.
-- This draft exposes NO customer write policies and therefore cannot trade.
create extension if not exists pgcrypto;

create table public.fx_catalog (
 id uuid primary key default gen_random_uuid(),
 slug text not null unique,
 name text not null,
 category text not null check(category in ('sneakers','apparel','electronics','college')),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.fx_variants (
 id uuid primary key default gen_random_uuid(),
 catalog_id uuid not null references public.fx_catalog(id),
 variant_key text not null,
 condition text not null check(condition in ('new','like_new','used_good')),
 unique(catalog_id,variant_key,condition)
);
create table public.fx_listings (
 id uuid primary key default gen_random_uuid(),
 seller_id uuid not null references auth.users(id),
 variant_id uuid not null references public.fx_variants(id),
 ask_cents integer not null check(ask_cents between 100 and 10000000),
 proof_path text,
 status text not null default 'draft' check(status in ('draft','open','reserved','sold','withdrawn')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.fx_bids (
 id uuid primary key default gen_random_uuid(),
 buyer_id uuid not null references auth.users(id),
 variant_id uuid not null references public.fx_variants(id),
 max_cents integer not null check(max_cents between 100 and 10000000),
 status text not null default 'open' check(status in ('open','reserved','filled','cancelled','expired')),
 created_at timestamptz not null default now()
);
create table public.fx_matches (
 id uuid primary key default gen_random_uuid(),
 listing_id uuid not null references public.fx_listings(id),
 bid_id uuid not null references public.fx_bids(id),
 trade_cents integer not null check(trade_cents between 100 and 10000000),
 status text not null default 'pending_checkout' check(status in ('pending_checkout','payment_confirmed','shipped','delivered','completed','cancelled','refunded','disputed')),
 stripe_payment_intent_id text unique,
 created_at timestamptz not null default now(),
 checkout_expires_at timestamptz not null default (now()+interval '15 minutes')
);
create unique index fx_one_active_match_per_listing on public.fx_matches(listing_id)
 where status not in ('cancelled','refunded');
create unique index fx_one_active_match_per_bid on public.fx_matches(bid_id)
 where status not in ('cancelled','refunded');
create index fx_listings_order_book on public.fx_listings(variant_id,ask_cents,created_at) where status='open';
create index fx_bids_order_book on public.fx_bids(variant_id,max_cents desc,created_at) where status='open';
create table public.fx_sms_consent (
 user_id uuid primary key references auth.users(id),
 phone_e164 text not null,
 transactional_opt_in boolean not null default false,
 marketing_opt_in boolean not null default false,
 source text,
 opted_in_at timestamptz,
 opted_out_at timestamptz
);

alter table public.fx_catalog enable row level security;
alter table public.fx_variants enable row level security;
alter table public.fx_listings enable row level security;
alter table public.fx_bids enable row level security;
alter table public.fx_matches enable row level security;
alter table public.fx_sms_consent enable row level security;
create policy fx_catalog_public_read on public.fx_catalog for select to anon, authenticated using(active = true);
create policy fx_variants_public_read on public.fx_variants for select to anon, authenticated using(true);
create policy fx_listing_owner_read on public.fx_listings for select to authenticated using(seller_id=(select auth.uid()));
create policy fx_bid_owner_read on public.fx_bids for select to authenticated using(buyer_id=(select auth.uid()));
create policy fx_match_party_read on public.fx_matches for select to authenticated using(
 exists(select 1 from public.fx_listings l where l.id=listing_id and l.seller_id=(select auth.uid()))
 or exists(select 1 from public.fx_bids b where b.id=bid_id and b.buyer_id=(select auth.uid()))
);
create policy fx_sms_owner_read on public.fx_sms_consent for select to authenticated using(user_id=(select auth.uid()));

-- No INSERT/UPDATE/DELETE grants or RLS policies for clients.
-- Implement server-side, transactionally locked order placement and order matching,
-- idempotency, secure read-only market depth, expiry/retry cleanup, and verified
-- Stripe Connect webhooks BEFORE moving this from draft to deployed infrastructure.
-- Secrets and card numbers NEVER belong in these tables.
