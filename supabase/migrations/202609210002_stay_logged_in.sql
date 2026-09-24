-- Applied to the Fynliq Supabase project on 2026-09-21.
-- Sessions slide: every visit pushes the end a year out, so an account in
-- regular use never has to log in again.
create or replace function public.account_start_session(p_user uuid,p_email text,p_hash text,p_guest uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row public.accounts; v_expires timestamptz := now()+interval '365 days';
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
drop function public.account_session(text);
create function public.account_session(p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 update public.account_sessions s set expires_at=now()+interval '365 days'
 from public.accounts a
 where a.user_id=s.user_id and s.token_hash=p_hash and not s.revoked and s.expires_at>now()
 returning jsonb_build_object('user_id',a.user_id,'email',a.email,'created_at',a.created_at,'expires_at',s.expires_at) into v;
 return v;
end;
$$;
revoke all on function public.account_session(text) from public,anon,authenticated;
grant execute on function public.account_session(text) to service_role;
alter table public.account_sessions alter column expires_at set default now()+interval '365 days';
