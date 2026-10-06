-- Marketing attribution: count visits opened inside TikTok's, Instagram's
-- or Facebook's built-in browser as that app, even when the link is the
-- plain fynliq.com (TikTok's browser sends no referrer, so these visits
-- were landing in Direct).
--
-- Apply after 202610060001_acquisition_attribution.sql. REVIEW BEFORE APPLYING.
-- Safe in either order with the app code: until the code is live nothing
-- sends 'in_app'; until this is applied an 'in_app' touch is stored as
-- direct by attribution_touch (it never errors).
--
-- Adds one attribution_type, 'in_app', for the first touch and the last
-- non-direct touch. Only the app's name is stored (channel/source); the
-- browser's user-agent string is never sent or stored. Existing rows are
-- not touched.
begin;

alter table public.acquisition_attribution
 drop constraint acquisition_attribution_attribution_type_check,
 add constraint acquisition_attribution_attribution_type_check
  check (attribution_type in ('utm','click_id','referrer','in_app','direct','legacy')),
 drop constraint acquisition_attribution_last_attribution_type_check,
 add constraint acquisition_attribution_last_attribution_type_check
  check (last_attribution_type is null or last_attribution_type in ('utm','click_id','referrer','in_app'));

-- Same function as 202610060001, with 'in_app' accepted.
create or replace function public.attribution_touch(p_guest uuid, p_touch jsonb) returns text
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

 if v_type is null or v_type not in ('utm','click_id','referrer','in_app','direct')
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

revoke all on function public.attribution_touch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.attribution_touch(uuid, jsonb) to service_role;
commit;
