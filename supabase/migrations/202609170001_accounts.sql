-- New Fynliq account tables only. Inspect the target database before applying.
begin;
create table public.fynliq_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);
create table public.fynliq_documents (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null,
  analysis jsonb not null,
  files jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique(user_id, source_id)
);
create index fynliq_documents_owner_created on public.fynliq_documents(user_id, created_at desc);
create table public.fynliq_conversations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(id, user_id)
);
create table public.fynliq_questions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  question text not null check (length(question) between 1 and 2000),
  answer jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(conversation_id,user_id) references public.fynliq_conversations(id,user_id) on delete cascade
);
create index fynliq_questions_owner_created on public.fynliq_questions(user_id, created_at desc);
create table public.fynliq_events (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  anonymous_id uuid,
  session_id uuid not null,
  event_name text not null check(event_name in ('anonymous_session_started','signup_started','signup_completed','login_completed','session_started','document_uploaded','document_saved','ask_fynliq_question','conversation_started','return_session','logout')),
  created_at timestamptz not null default now(),
  check(user_id is not null or anonymous_id is not null)
);
create index fynliq_events_user_time on public.fynliq_events(user_id,created_at);
create index fynliq_events_anon_time on public.fynliq_events(anonymous_id,created_at);
create index fynliq_events_name_time on public.fynliq_events(event_name,created_at);
create index fynliq_events_session on public.fynliq_events(session_id);

-- Writes are server-only, after JWT verification. RLS also protects direct REST access.
alter table public.fynliq_profiles enable row level security;
alter table public.fynliq_documents enable row level security;
alter table public.fynliq_conversations enable row level security;
alter table public.fynliq_questions enable row level security;
alter table public.fynliq_events enable row level security;
revoke all on public.fynliq_profiles, public.fynliq_documents, public.fynliq_conversations, public.fynliq_questions, public.fynliq_events from anon, authenticated;
grant select on public.fynliq_profiles, public.fynliq_documents, public.fynliq_conversations, public.fynliq_questions to authenticated;
grant all on public.fynliq_profiles, public.fynliq_documents, public.fynliq_conversations, public.fynliq_questions, public.fynliq_events to service_role;
create policy fynliq_profile_owner on public.fynliq_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy fynliq_document_owner on public.fynliq_documents for select to authenticated using ((select auth.uid()) = user_id);
create policy fynliq_conversation_owner on public.fynliq_conversations for select to authenticated using ((select auth.uid()) = user_id);
create policy fynliq_question_owner on public.fynliq_questions for select to authenticated using ((select auth.uid()) = user_id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('fynliq-documents','fynliq-documents',false,2800000,array['application/pdf','image/png','image/jpeg','image/webp']);
-- No anonymous/authenticated object policies: all file access is through the
-- authenticated API, which checks the metadata owner before streaming a download.
create function public.fynliq_record_activity(p_id uuid,p_user uuid,p_anonymous uuid,p_session uuid,p_event text)
returns void language plpgsql set search_path = public, pg_temp as $$
declare inserted_profile uuid;
begin
  if p_user is not null then
    insert into public.fynliq_profiles(user_id) values(p_user)
    on conflict(user_id) do nothing returning user_id into inserted_profile;
    if inserted_profile is not null then
      insert into public.fynliq_events(id,user_id,anonymous_id,session_id,event_name)
      values(gen_random_uuid(),p_user,p_anonymous,p_session,'signup_completed');
    end if;
    update public.fynliq_profiles set last_active_at=now() where user_id=p_user;
  end if;
  insert into public.fynliq_events(id,user_id,anonymous_id,session_id,event_name)
  values(p_id,p_user,case when p_user is null then p_anonymous else null end,p_session,p_event)
  on conflict(id) do nothing;
end;
$$;
revoke all on function public.fynliq_record_activity(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fynliq_record_activity(uuid,uuid,uuid,uuid,text) to service_role;
commit;
