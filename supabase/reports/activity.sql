-- Run only in the administrator SQL editor. No public API/view grants.
-- UTC calendar-day retention; authenticated accounts. Anonymous activity is
-- reported separately and must not be described as uniquely identified people.
with active as (
  select distinct user_id, (created_at at time zone 'UTC')::date as day
  from public.fynliq_events where user_id is not null
), cohort as (
  select user_id,(created_at at time zone 'UTC')::date as joined from public.fynliq_profiles
)
select
  (select count(distinct user_id) from active where day=current_date) as dau,
  (select count(distinct user_id) from active where day>current_date-7) as wau,
  (select count(distinct user_id) from active where day>current_date-30) as mau,
  (select count(*) from cohort where joined=current_date) as new_accounts_today,
  (select count(distinct a.user_id) from active a join cohort c using(user_id) where a.day=current_date and c.joined<current_date) as returning_accounts_today;

-- D1/D7/D30: denominator contains only cohorts old enough to reach that day.
with cohort as (
  select user_id,(created_at at time zone 'UTC')::date as joined from public.fynliq_profiles
), active as (
  select distinct user_id,(created_at at time zone 'UTC')::date as day from public.fynliq_events where user_id is not null
)
select n.days,
  count(*) filter(where c.joined+n.days<=current_date) as eligible_accounts,
  count(*) filter(where c.joined+n.days<=current_date and exists(select 1 from active a where a.user_id=c.user_id and a.day=c.joined+n.days)) as retained_accounts
from cohort c cross join (values(1),(7),(30)) n(days) group by n.days order by n.days;

-- Activity per authenticated active account in the trailing 30 days.
select count(*) filter(where event_name='ask_fynliq_question')::numeric/nullif(count(distinct user_id),0) as questions_per_active_user,
  count(*) filter(where event_name='document_uploaded')::numeric/nullif(count(distinct user_id),0) as uploads_per_active_user,
  count(distinct (user_id,session_id))::numeric/nullif(count(distinct user_id),0) as sessions_per_active_user
from public.fynliq_events where user_id is not null and created_at>=now()-interval '30 days';

-- Anonymous session conversion (cookie/session based; not a cross-device person count).
select count(distinct session_id) filter(where event_name='anonymous_session_started') as anonymous_sessions,
  count(distinct session_id) filter(where event_name='signup_started') as signup_started_sessions,
  count(distinct session_id) filter(where event_name='signup_completed') as signup_completed_sessions
from public.fynliq_events where created_at>=now()-interval '30 days';

-- Calendar-month active accounts and growth. Current month is partial.
with counts as (
  select date_trunc('month',created_at) as month,count(distinct user_id) as active_users
  from public.fynliq_events where user_id is not null group by 1
), months as (
  select generate_series(coalesce((select min(month) from counts),date_trunc('month',now())),date_trunc('month',now()),interval '1 month') as month
), monthly as (
  select months.month,coalesce(counts.active_users,0) as active_users from months left join counts using(month)
)
select month,active_users,
  100.0*(active_users-lag(active_users) over(order by month))/nullif(lag(active_users) over(order by month),0) as growth_percent
from monthly order by month;
