-- Fynliq Earn AI SMS pilot: consent metadata only, no message bodies or
-- unencrypted phone numbers. Apply after reviewing the existing beta schema.
begin;

create table if not exists public.fynliq_sms_consent (
  phone_hash text primary key check (phone_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('pending', 'active', 'opted_out')),
  deals_state text check (deals_state in ('pending', 'active', 'opted_out')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Also upgrade already-created pilot tables, if this draft was applied manually.
alter table public.fynliq_sms_consent
  add column if not exists deals_state text check (deals_state in ('pending', 'active', 'opted_out'));

create index if not exists fynliq_sms_consent_state_idx
  on public.fynliq_sms_consent (state, updated_at);

alter table public.fynliq_sms_consent enable row level security;
revoke all on public.fynliq_sms_consent from public, anon, authenticated;
grant select, insert, update on public.fynliq_sms_consent to service_role;

comment on table public.fynliq_sms_consent is
  'SMS opt-in state keyed by server-side HMAC phone hash; no user data or SMS contents.';

commit;
