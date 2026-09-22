-- Upload tracking for /admin. Records THAT a document read happened and how
-- it went, never what was in it: no file names, text, figures or images.
create table public.upload_events (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now(),
 account_id uuid references public.accounts(user_id) on delete set null,
 guest_id uuid references public.anonymous_users(id) on delete set null,
 outcome text not null check(outcome in ('read','no_aid_lines','unreadable','privacy_blocked','reader_error')),
 files integer not null check(files between 0 and 3),
 figures integer not null default 0 check(figures between 0 and 40),
 reason text check(reason is null or reason ~ '^[a-z0-9+-]{1,200}$')
);
create index upload_events_time on public.upload_events(created_at);
alter table public.upload_events enable row level security;
revoke all on public.upload_events from public, anon, authenticated;
grant all on public.upload_events to service_role;

create function public.record_upload(p_account uuid,p_guest uuid,p_outcome text,p_files integer,p_figures integer,p_reason text) returns void
language sql security definer set search_path='' as $$
 insert into public.upload_events(account_id,guest_id,outcome,files,figures,reason)
 values(
  (select user_id from public.accounts where user_id=p_account),
  (select id from public.anonymous_users where id=p_guest),
  p_outcome,p_files,p_figures,p_reason);
$$;

create function public.upload_metrics() returns jsonb
language sql security definer set search_path='' as $$
select jsonb_build_object(
 'total_uploads',(select count(*) from public.upload_events),
 'read_ok',(select count(*) from public.upload_events where outcome='read'),
 'not_read',(select count(*) from public.upload_events where outcome<>'read'),
 'uploads_today',(select count(*) from public.upload_events where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
 'uploads_7_days',(select count(*) from public.upload_events where created_at>now()-interval '7 days'),
 'people_uploading',(select count(distinct coalesce(account_id::text,guest_id::text)) from public.upload_events where coalesce(account_id,guest_id) is not null),
 'by_outcome',(select coalesce(jsonb_object_agg(outcome,n),'{}'::jsonb) from (select outcome,count(*) n from public.upload_events group by 1)x),
 'by_day',(select coalesce(jsonb_agg(x order by x.period),'[]'::jsonb) from
  (select to_char(created_at at time zone 'UTC','YYYY-MM-DD') period,count(*) uploads,count(*) filter(where outcome='read') read_ok from public.upload_events group by 1)x),
 'recent',(select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) from
  (select e.created_at,e.outcome,e.files,e.figures,e.reason,a.email from public.upload_events e left join public.accounts a on a.user_id=e.account_id order by e.created_at desc limit 50)x)
);
$$;

-- Account list gains an uploads column.
create or replace function public.account_metrics() returns jsonb
language sql security definer set search_path='' as $$
select jsonb_build_object(
 'total_accounts',(select count(*) from public.accounts),
 'accounts_today',(select count(*) from public.accounts where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
 'accounts_7_days',(select count(*) from public.accounts where created_at>now()-interval '7 days'),
 'accounts_30_days',(select count(*) from public.accounts where created_at>now()-interval '30 days'),
 'logins_today',(select count(*) from public.account_events where event_type='logged_in' and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
 'active_accounts_7_days',(select count(distinct user_id) from public.account_events where event_type='logged_in' and created_at>now()-interval '7 days'),
 'accounts_by_day',(select coalesce(jsonb_agg(x order by x.period),'[]'::jsonb) from
  (select to_char(created_at at time zone 'UTC','YYYY-MM-DD') period,count(*) accounts from public.accounts group by 1)x),
 'accounts',(select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) from
  (select a.email,a.created_at,a.last_login_at,a.login_count,
   (select count(*) from public.beta_questions q join public.account_guests g on g.guest_id=q.user_id where g.user_id=a.user_id) questions,
   (select count(*) from public.upload_events u where u.account_id=a.user_id) uploads
   from public.accounts a)x)
);
$$;

revoke all on function public.record_upload(uuid,uuid,text,integer,integer,text),public.upload_metrics(),public.account_metrics() from public,anon,authenticated;
grant execute on function public.record_upload(uuid,uuid,text,integer,integer,text),public.upload_metrics(),public.account_metrics() to service_role;
