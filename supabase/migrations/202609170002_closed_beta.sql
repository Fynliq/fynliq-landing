-- Public guest telemetry only. Apply this file alone; do NOT apply the old accounts draft.
-- No question/answer/document content columns. All functions are service-role only.
begin;
create table public.beta_invites (
 email text primary key check(email=lower(email)), enabled boolean not null default true,
 user_id uuid unique
);
create table public.anonymous_users (
 id uuid primary key, created_at timestamptz not null default now(), last_active_at timestamptz
);
create table public.beta_sessions (
 id uuid primary key default gen_random_uuid(), token_hash text unique not null,
 user_id uuid not null, kind text not null check(kind in ('guest','admin')), created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '8 hours', revoked boolean not null default false
);
create table public.events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.anonymous_users(id),
 event_type text not null check(event_type in ('guest_created','session_started','question_submitted','answer_received','answer_failed')),
 created_at timestamptz not null default now()
);
alter table public.events enable row level security;
revoke all on public.events from public,anon,authenticated;
grant all on public.events to service_role;
create index events_user_time on public.events(user_id,created_at);
create table public.beta_questions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.anonymous_users(id),
 session_id uuid not null references public.beta_sessions(id),
 created_at timestamptz not null default now(), finished_at timestamptz,
 state text not null default 'pending' check(state in ('pending','success','failed'))
);
create index beta_questions_time on public.beta_questions(created_at);
create index beta_questions_user_time on public.beta_questions(user_id,created_at);
create table public.beta_rate_windows (key text primary key, started_at timestamptz not null, hits integer not null);
alter table public.beta_invites enable row level security;
alter table public.anonymous_users enable row level security;
alter table public.beta_sessions enable row level security;
alter table public.beta_questions enable row level security;
alter table public.beta_rate_windows enable row level security;
revoke all on public.beta_invites, public.anonymous_users, public.beta_sessions, public.beta_questions, public.beta_rate_windows from public, anon, authenticated;
grant all on public.beta_invites, public.anonymous_users, public.beta_sessions, public.beta_questions, public.beta_rate_windows to service_role;

create function public.beta_invited(p_email text) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from public.beta_invites where email=lower(p_email) and enabled);
$$;
create function public.beta_login(p_user uuid,p_email text,p_hash text,p_previous text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.beta_invites where email=lower(p_email) and enabled and (user_id is null or user_id=p_user) for update;
 if not found then raise exception 'Invitation required';end if;
 update public.beta_invites set user_id=p_user where email=lower(p_email);

 update public.beta_sessions set revoked=true where token_hash=p_previous;
 insert into public.beta_sessions(token_hash,user_id,kind,expires_at) values(p_hash,p_user,'admin',now()+interval '1 hour');
 delete from public.beta_sessions s where s.expires_at<now()-interval '1 day'
 and not exists(select 1 from public.beta_questions q where q.session_id=s.id);
end;
$$;
create function public.beta_session(p_hash text) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'user_id',s.user_id,'kind',s.kind) from public.beta_sessions s

 where s.token_hash=p_hash and not s.revoked and s.expires_at>now() and
 (s.kind='guest' or exists(select 1 from public.beta_invites i where i.user_id=s.user_id and i.enabled));
$$;
create function public.beta_logout(p_hash text) returns void
language sql security definer set search_path='' as $$
 update public.beta_sessions set revoked=true where token_hash=p_hash;
$$;
create function public.beta_rate(p_key text,p_limit integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_limit<1 or p_limit>100000 then return false;end if;
 delete from public.beta_rate_windows where started_at<now()-interval '2 minutes';
 insert into public.beta_rate_windows(key,started_at,hits) values(p_key,now(),1)
 on conflict(key) do update set
 hits=case when public.beta_rate_windows.started_at<=now()-interval '1 minute' then 1 else public.beta_rate_windows.hits+1 end,
 started_at=case when public.beta_rate_windows.started_at<=now()-interval '1 minute' then now() else public.beta_rate_windows.started_at end
 returning hits into n;
 return n<=p_limit;
end;
$$;
create function public.beta_reserve_question(p_user uuid,p_session uuid,p_global integer,p_daily integer,p_minute integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare question_id uuid; day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
 -- One transaction lock serializes reservations across all Vercel instances.
 perform pg_advisory_xact_lock(746192);
 if p_global<1 or p_daily<1 or p_minute<1 then return jsonb_build_object('allowed',false);end if;
 if not exists(select 1 from public.beta_sessions s
 where s.id=p_session and s.user_id=p_user and not s.revoked and s.expires_at>now() and s.kind='guest')
 then raise exception 'Session required';end if;
 if (select count(*) from public.beta_questions where created_at>=day_start)>=p_global
 or (select count(*) from public.beta_questions where user_id=p_user and created_at>=day_start)>=p_daily
 or (select count(*) from public.beta_questions where user_id=p_user and created_at>now()-interval '1 minute')>=p_minute
 then return jsonb_build_object('allowed',false);end if;
 insert into public.beta_questions(user_id,session_id) values(p_user,p_session) returning id into question_id;
 insert into public.events(id,user_id,event_type) values(question_id,p_user,'question_submitted');
 update public.anonymous_users set last_active_at=now() where id=p_user;
 update public.beta_sessions set expires_at=now()+interval '30 days' where id=p_session;
 return jsonb_build_object('allowed',true,'id',question_id);
end;
$$;
create function public.beta_finish_question(p_id uuid,p_success boolean) returns void
language sql security definer set search_path='' as $$
 with completed as (update public.beta_questions set state=case when p_success then 'success' else 'failed' end,finished_at=now()
 where id=p_id and state='pending' returning user_id)
 insert into public.events(user_id,event_type) select user_id,case when p_success then 'answer_received' else 'answer_failed' end from completed;
$$;
create function public.beta_metrics() returns jsonb
language sql security definer set search_path='' as $$
select jsonb_build_object(
 'total_users',(select count(*) from public.anonymous_users),
 'total_signups',(select count(*) from public.anonymous_users),
 'new_today',(select count(*) from public.anonymous_users where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
 'new_7_days',(select count(*) from public.anonymous_users where created_at>now()-interval '7 days'),
 'new_30_days',(select count(*) from public.anonymous_users where created_at>now()-interval '30 days'),
 'dau',(select count(distinct user_id) from public.beta_questions where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' and created_at<=now()),
 'wau',(select count(distinct user_id) from public.beta_questions where created_at>now()-interval '7 days' and created_at<=now()),
 'mau',(select count(distinct user_id) from public.beta_questions where created_at>now()-interval '30 days' and created_at<=now()),
 'returning_users',(select count(*) from (select user_id from public.beta_questions group by user_id having count(distinct (created_at at time zone 'UTC')::date)>=2) r),
 'activated_users',(select count(distinct user_id) from public.beta_questions where state='success'),
 'total_questions',(select count(*) from public.beta_questions),
 'successful_answers',(select count(*) from public.beta_questions where state='success'),
 'failed_answers',(select count(*) from public.beta_questions where state='failed' or (state='pending' and created_at<now()-interval '2 minutes')),
 'pending_answers',(select count(*) from public.beta_questions where state='pending' and created_at>=now()-interval '2 minutes'),
 'questions_per_user',coalesce((select count(*)::numeric from public.beta_questions)/nullif((select count(*) from public.anonymous_users),0),0),
 'signups_by_day',(select coalesce(jsonb_agg(x order by x.period),'[]'::jsonb) from
  (select to_char(created_at at time zone 'UTC','YYYY-MM-DD') period,count(*) users from public.anonymous_users group by 1)x),
 'signups_by_week',(select coalesce(jsonb_agg(x order by x.period),'[]'::jsonb) from
  (select to_char(date_trunc('week',created_at at time zone 'UTC'),'YYYY-MM-DD') period,count(*) users from public.anonymous_users group by 1)x),
 'signups_by_month',(select coalesce(jsonb_agg(x order by x.period),'[]'::jsonb) from
  (select to_char(created_at at time zone 'UTC','YYYY-MM') period,count(*) users from public.anonymous_users group by 1)x),
 'users',(select coalesce(jsonb_agg(x order by x.signup_date),'[]'::jsonb) from
  (select u.id user_id,u.created_at signup_date,max(q.created_at) last_active,count(q.id) questions,
  count(q.id) filter(where q.state='success') successful_answers,
  count(distinct (q.created_at at time zone 'UTC')::date)>=2 is_returning
  from public.anonymous_users u left join public.beta_questions q on q.user_id=u.id group by u.id)x)
);
$$;
revoke all on function public.beta_invited(text),public.beta_login(uuid,text,text,text),public.beta_session(text),public.beta_logout(text),
 public.beta_rate(text,integer),public.beta_reserve_question(uuid,uuid,integer,integer,integer),public.beta_finish_question(uuid,boolean),public.beta_metrics() from public,anon,authenticated;
grant execute on function public.beta_invited(text),public.beta_login(uuid,text,text,text),public.beta_session(text),public.beta_logout(text),
 public.beta_rate(text,integer),public.beta_reserve_question(uuid,uuid,integer,integer,integer),public.beta_finish_question(uuid,boolean),public.beta_metrics() to service_role;
create function public.beta_guest(p_user uuid,p_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.anonymous_users(id) values(p_user);
 insert into public.beta_sessions(token_hash,user_id,kind,expires_at) values(p_hash,p_user,'guest',now()+interval '30 days');
 insert into public.events(user_id,event_type) values(p_user,'guest_created'),(p_user,'session_started');
end;
$$;
revoke all on function public.beta_guest(uuid,text) from public,anon,authenticated;
grant execute on function public.beta_guest(uuid,text) to service_role;
commit;
