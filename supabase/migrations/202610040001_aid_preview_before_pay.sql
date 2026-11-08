-- Preview before paying.
--
-- My Aid now reads a student's documents BEFORE the $1 unlock, shows a free
-- preview, and keeps the full result on the server so it can be released
-- after Stripe confirms payment (and still be there after a cancel, a
-- refresh, or logging out and back in).
--
-- What is stored, and what is not:
--   * Stored: the verified aid figures the reader extracted (field, label,
--     amount, period, document/page number, and the short redacted quote the
--     figure was checked against) plus the computed overview.
--   * Not stored: files, file names, raw document text, names, SSNs, student
--     or account numbers. Files never reach the server; text is redacted on
--     the device and again on the server before the read.
--   * Kept 30 days, then deleted by aid_analysis_save on the next save.
--
-- Access: service_role only (RLS on, no policies). Every read goes through
-- aid_analysis_get, which takes the account id from the server-verified
-- session and only returns that account's own rows.
begin;

create table public.aid_analyses (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(user_id) on delete cascade,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '30 days',
 document_kind text not null check (document_kind in ('fafsa-submission-summary','award-letter','account-statement')),
 file_count integer not null check (file_count between 1 and 3),
 facts jsonb not null check (jsonb_typeof(facts) = 'array' and jsonb_array_length(facts) between 1 and 40),
 overview jsonb not null check (jsonb_typeof(overview) = 'object')
);
create index aid_analyses_account_time on public.aid_analyses(account_id, created_at desc);
create index aid_analyses_expiry on public.aid_analyses(expires_at);

alter table public.aid_analyses enable row level security;
revoke all on public.aid_analyses from public, anon, authenticated;
grant all on public.aid_analyses to service_role;

-- Saves one analysis for one account and returns its id. Also clears expired
-- rows, so retention does not depend on a separate scheduled job.
create function public.aid_analysis_save(p_user uuid, p_kind text, p_files integer, p_facts jsonb, p_overview jsonb)
returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 delete from public.aid_analyses where expires_at < now();
 insert into public.aid_analyses(account_id, document_kind, file_count, facts, overview)
 select a.user_id, p_kind, p_files, p_facts, p_overview from public.accounts a where a.user_id = p_user
 returning id into v_id;
 if v_id is null then raise exception 'Unknown account'; end if;
 return v_id;
end;
$$;

-- One analysis belonging to p_user: by id, or the newest when p_id is null.
-- Another account's id returns nothing, exactly like an unknown id.
create function public.aid_analysis_get(p_user uuid, p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id', x.id, 'created_at', x.created_at, 'document_kind', x.document_kind,
  'file_count', x.file_count, 'facts', x.facts, 'overview', x.overview)
 from public.aid_analyses x
 where x.account_id = p_user and x.expires_at > now() and (p_id is null or x.id = p_id)
 order by x.created_at desc limit 1;
$$;

revoke all on function public.aid_analysis_save(uuid, text, integer, jsonb, jsonb), public.aid_analysis_get(uuid, uuid)
 from public, anon, authenticated;
grant execute on function public.aid_analysis_save(uuid, text, integer, jsonb, jsonb), public.aid_analysis_get(uuid, uuid)
 to service_role;

-- Funnel events for the new flow. The existing names stay valid so older rows
-- and the existing admin numbers keep working.
alter table public.monetization_events drop constraint monetization_events_event_type_check;
alter table public.monetization_events add constraint monetization_events_event_type_check check (event_type in (
 'my_aid_entered','preflight_completed','paywall_viewed','unlock_clicked','checkout_created',
 'checkout_completed','payment_confirmed','entitlement_activated','analysis_started','analysis_completed',
 'my_aid_page_view','aid_upload_started','aid_upload_completed','aid_analysis_started','aid_analysis_completed',
 'aid_preview_viewed','unlock_button_clicked','stripe_checkout_started','payment_completed','full_analysis_viewed'));

-- One readable funnel. Two steps are recorded by the existing payment code
-- under their original names and are shown here under the new ones:
--   checkout_created  (recorded when a Stripe Checkout Session is created) -> stripe_checkout_started
--   payment_confirmed (recorded only from a signature-verified webhook)    -> payment_completed
create view public.aid_funnel_events with (security_invoker = true) as
 select id, created_at, account_id, livemode, is_test_account,
  case event_type when 'checkout_created' then 'stripe_checkout_started'
                  when 'payment_confirmed' then 'payment_completed'
                  else event_type end as event_type
 from public.monetization_events
 where event_type in ('my_aid_page_view','aid_upload_started','aid_upload_completed','aid_analysis_started',
  'aid_analysis_completed','aid_preview_viewed','unlock_button_clicked','checkout_created','stripe_checkout_started',
  'payment_confirmed','payment_completed','full_analysis_viewed');
revoke all on public.aid_funnel_events from public, anon, authenticated;
grant select on public.aid_funnel_events to service_role;

commit;

-- Funnel, last 30 days, real accounts only (run in the SQL editor):
--   select event_type, count(*) events, count(distinct account_id) accounts
--   from public.aid_funnel_events
--   where created_at > now() - interval '30 days' and livemode and not is_test_account
--   group by 1 order by 2 desc;
