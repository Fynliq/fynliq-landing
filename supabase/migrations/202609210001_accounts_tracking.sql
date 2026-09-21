-- Fynliq accounts: email + password log-in (Supabase Auth) with sign-up and
-- log-in tracking for the /admin dashboard. Apply after 202609170002.
-- Stores: email, when the account was created, when it last logged in, how
-- many times, and which guest browsers it used (so question counts can be
-- attributed). Never passwords (Supabase Auth keeps those, hashed), never
-- document or question content.
begin;
create table public.accounts (
 user_id uuid primary key, email text unique not null check(email=lower(email)),
 created_at timestamptz not null default now(), last_login_at timestamptz, login_count integer not null default 0
);
create table public.account_sessions (
 id uuid primary key default gen_random_uuid(), token_hash text unique not null,
 user_id uuid not null references public.accounts(user_id) on delete cascade,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 days',
 revoked boolean not null default false
);
create table public.account_guests (
 user_id uuid not null references public.accounts(user_id) on delete cascade,
 guest_id uuid not null references public.anonymous_users(id) on delete cascade,
 linked_at timestamptz not null default now(), primary key(user_id,guest_id)
);
create table public.account_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.accounts(user_id) on delete cascade,
 event_type text not null check(event_type in ('signed_up','logged_in','logged_out')),
 created_at timestamptz not null default now()
);
create index account_events_time on public.account_events(created_at);
alter table public.accounts enable row level security;
alter table public.account_sessions enable row level security;
alter table public.account_guests enable row level security;
alter table public.account_events enable row level security;
revoke all on public.accounts, public.account_sessions, public.account_guests, public.account_events from public, anon, authenticated;
grant all on public.accounts, public.account_sessions, public.account_guests, public.account_events to service_role;

-- Records a new account (idempotent) and a signed_up event.
create function public.account_signed_up(p_user uuid,p_email text) returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.accounts(user_id,email) values(p_user,lower(p_email)) on conflict (user_id) do nothing;
 if found then insert into public.account_events(user_id,event_type) values(p_user,'signed_up'); end if;
end;
$$;

-- Starts a session, counts the log-in and links this browser's guest id.
create function public.account_start_session(p_user uuid,p_email text,p_hash text,p_guest uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row public.accounts; v_expires timestamptz := now()+interval '30 days';
begin
 insert into public.accounts(user_id,email) values(p_user,lower(p_email)) on conflict (user_id) do nothing;
 update public.accounts set last_login_at=now(),login_count=login_count+1 where user_id=p_user returning * into v_row;
 insert into public.account_sessions(token_hash,user_id,expires_at) values(p_hash,p_user,v_expires);
 insert into public.account_events(user_id,event_type) values(p_user,'logged_in');
 if p_guest is not null and exists(select 1 from public.anonymous_users where id=p_guest) then
  insert into public.account_guests(user_id,guest_id) values(p_user,p_guest) on conflict do nothing;
 end if;
 delete from public.account_sessions where expires_at<now()-interval '1 day';
 return jsonb_build_object('email',v_row.email,'created_at',v_row.created_at,'expires_at',v_expires);
end;
$$;

create function public.account_session(p_hash text) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('user_id',a.user_id,'email',a.email,'created_at',a.created_at,'expires_at',s.expires_at)
 from public.account_sessions s join public.accounts a on a.user_id=s.user_id
 where s.token_hash=p_hash and not s.revoked and s.expires_at>now();
$$;

create function public.account_logout(p_hash text) returns void
language sql security definer set search_path='' as $$
 with ended as (update public.account_sessions set revoked=true where token_hash=p_hash and not revoked returning user_id)
 insert into public.account_events(user_id,event_type) select user_id,'logged_out' from ended;
$$;

create function public.account_link_guest(p_user uuid,p_guest uuid) returns void
language sql security definer set search_path='' as $$
 insert into public.account_guests(user_id,guest_id)
 select p_user,p_guest where exists(select 1 from public.anonymous_users where id=p_guest)
 on conflict do nothing;
$$;

create function public.account_metrics() returns jsonb
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
   (select count(*) from public.beta_questions q join public.account_guests g on g.guest_id=q.user_id where g.user_id=a.user_id) questions
   from public.accounts a)x)
);
$$;

revoke all on function public.account_signed_up(uuid,text),public.account_start_session(uuid,text,text,uuid),public.account_session(text),
 public.account_logout(text),public.account_link_guest(uuid,uuid),public.account_metrics() from public,anon,authenticated;
grant execute on function public.account_signed_up(uuid,text),public.account_start_session(uuid,text,text,uuid),public.account_session(text),
 public.account_logout(text),public.account_link_guest(uuid,uuid),public.account_metrics() to service_role;
commit;
