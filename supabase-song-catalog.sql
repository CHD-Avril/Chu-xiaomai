-- 音源曲库与征集期选曲策略增量迁移
-- 旧歌曲保留；新投稿必须引用可用曲库条目。
begin;

do $$ begin
  if to_regprocedure('public.qq_moderation_health()') is null then
    raise exception '请先执行 QQ 参与和账号管理迁移。';
  end if;
end $$;

create table if not exists public.song_catalog (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 80),
  artist text not null check (length(trim(artist)) between 1 and 80),
  title_lower text generated always as (lower(trim(title))) stored,
  artist_lower text generated always as (lower(trim(artist))) stored,
  source_url text,
  duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 3600),
  is_available boolean not null default false,
  is_active boolean not null default true,
  notes text not null default '',
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(title_lower, artist_lower)
);

create table if not exists public.period_catalog_policies (
  period_id uuid primary key references public.playlist_periods(id) on delete restrict,
  whitelist_enabled boolean not null default false,
  allowed_catalog_ids uuid[] not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.period_catalog_policies add column if not exists starts_at timestamptz;
alter table public.period_catalog_policies add column if not exists ends_at timestamptz;
alter table public.period_catalog_policies add column if not exists version bigint not null default 0;

alter table public.songs add column if not exists catalog_id uuid;
create index if not exists song_catalog_search_idx on public.song_catalog(title_lower, artist_lower);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='songs_catalog_fk' and conrelid='public.songs'::regclass) then
    alter table public.songs add constraint songs_catalog_fk foreign key(catalog_id) references public.song_catalog(id);
  end if;
end $$;
create unique index if not exists songs_catalog_period_unique on public.songs(period_id,catalog_id) where catalog_id is not null;
create index if not exists songs_catalog_id_idx on public.songs(catalog_id);

alter table public.song_catalog enable row level security;
alter table public.period_catalog_policies enable row level security;

drop policy if exists song_catalog_public_read on public.song_catalog;
drop policy if exists song_catalog_admin_read on public.song_catalog;
drop policy if exists period_catalog_policy_admin_read on public.period_catalog_policies;

revoke all on public.song_catalog, public.period_catalog_policies from public,anon,authenticated;
grant select on public.song_catalog, public.period_catalog_policies to authenticated;
create policy song_catalog_admin_read on public.song_catalog
  for select to authenticated using (public.is_current_user_admin());
create policy period_catalog_policy_admin_read on public.period_catalog_policies
  for select to authenticated using (public.is_current_user_admin());

create or replace function public.get_song_catalog(p_period_id uuid)
returns table(id uuid,title text,artist text,duration_seconds integer,notes text)
language sql security definer set search_path=public as $catalog$
  select c.id,c.title,c.artist,c.duration_seconds,''::text
  from public.song_catalog c
  left join public.period_catalog_policies policy on policy.period_id=p_period_id
  where c.is_active and c.is_available and nullif(trim(c.source_url),'') is not null
    and exists(select 1 from public.playlist_periods p where p.id=p_period_id and public.can_read_period(p.id))
    and (coalesce(policy.whitelist_enabled,false)=false
      or (policy.starts_at is not null and clock_timestamp()<policy.starts_at)
      or (policy.ends_at is not null and clock_timestamp()>=policy.ends_at)
      or c.id = any(coalesce(policy.allowed_catalog_ids,'{}'::uuid[])))
  order by c.title_lower,c.artist_lower;
$catalog$;
revoke all on function public.get_song_catalog(uuid) from public;
grant execute on function public.get_song_catalog(uuid) to anon, authenticated;

create or replace function public.admin_upsert_song_catalog(
  p_id uuid default null,
  p_title text default '',
  p_artist text default '',
  p_source_url text default null,
  p_duration_seconds integer default null,
  p_is_available boolean default false,
  p_is_active boolean default true,
  p_notes text default ''
)
returns uuid language plpgsql security definer set search_path=public as $admin_catalog$
declare result_id uuid;
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  if length(trim(coalesce(p_title,''))) not between 1 and 80 or length(trim(coalesce(p_artist,''))) not between 1 and 80 then
    raise exception '歌名和歌手须为 1–80 字。';
  end if;
  if p_duration_seconds is not null and p_duration_seconds not between 1 and 3600 then
    raise exception '歌曲时长必须在 1–3600 秒之间。';
  end if;
  if length(coalesce(p_source_url,''))>500 or length(coalesce(p_notes,''))>500 then raise exception '音源和备注最多 500 字。'; end if;
  if p_is_available and nullif(trim(coalesce(p_source_url,'')),'') is null then raise exception '确认有音源前请填写音源地址或内部编号。'; end if;
  if p_id is null then
    insert into public.song_catalog(title,artist,source_url,duration_seconds,is_available,is_active,notes,created_by,updated_by)
      values(trim(p_title),trim(p_artist),nullif(trim(coalesce(p_source_url,'')),''),p_duration_seconds,p_is_available,p_is_active,trim(coalesce(p_notes,'')),auth.uid()::text,auth.uid()::text)
      returning id into result_id;
  else
    update public.song_catalog set title=trim(p_title),artist=trim(p_artist),source_url=nullif(trim(coalesce(p_source_url,'')),''),duration_seconds=p_duration_seconds,
      is_available=p_is_available,is_active=p_is_active,notes=trim(coalesce(p_notes,'')),updated_by=auth.uid()::text,updated_at=clock_timestamp()
      where id=p_id returning id into result_id;
    if result_id is null then raise exception '曲库条目不存在。'; end if;
  end if;
  insert into public.admin_action_log(actor_id,actor_name,action,target_id,details)
    values(auth.uid(),coalesce(auth.jwt()->>'email',auth.uid()::text),'catalog_update',result_id,jsonb_build_object('title',trim(p_title),'available',p_is_available,'active',p_is_active));
  return result_id;
end;
$admin_catalog$;
revoke all on function public.admin_upsert_song_catalog(uuid,text,text,text,integer,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.admin_upsert_song_catalog(uuid,text,text,text,integer,boolean,boolean,text) to authenticated;

drop function if exists public.admin_set_period_catalog_policy(uuid,boolean,uuid[]);
create or replace function public.admin_set_period_catalog_policy(p_period_id uuid,p_whitelist_enabled boolean,p_allowed_catalog_ids uuid[],p_starts_at timestamptz,p_ends_at timestamptz,p_version bigint)
returns void language plpgsql security definer set search_path=public as $policy$
declare current_version bigint;
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  perform 1 from public.playlist_periods where id=p_period_id for update;
  if not found then raise exception '征集期不存在。'; end if;
  select version into current_version from public.period_catalog_policies where period_id=p_period_id;
  if p_version is distinct from coalesce(current_version,0) then raise exception '规则已被其他管理员更新，请重新读取。'; end if;
  if p_starts_at is not null and p_ends_at is not null and p_starts_at>=p_ends_at then raise exception '开始时间必须早于结束时间。'; end if;
  if cardinality(p_allowed_catalog_ids)>5000 or exists(select 1 from unnest(p_allowed_catalog_ids) x where x is null or not exists(select 1 from public.song_catalog c where c.id=x)) then raise exception '白名单含无效歌曲或超过 5000 首。'; end if;
  insert into public.period_catalog_policies(period_id,whitelist_enabled,allowed_catalog_ids,starts_at,ends_at,version,updated_by,updated_at)
    values(p_period_id,p_whitelist_enabled,coalesce(p_allowed_catalog_ids,'{}'),p_starts_at,p_ends_at,1,auth.uid()::text,clock_timestamp())
    on conflict(period_id) do update set whitelist_enabled=excluded.whitelist_enabled,allowed_catalog_ids=excluded.allowed_catalog_ids,starts_at=excluded.starts_at,ends_at=excluded.ends_at,version=period_catalog_policies.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  insert into public.admin_action_log(actor_id,actor_name,action,target_id,details)
    values(auth.uid(),coalesce(auth.jwt()->>'email',auth.uid()::text),'catalog_policy',p_period_id,jsonb_build_object('enabled',p_whitelist_enabled,'starts_at',p_starts_at,'ends_at',p_ends_at,'allowed',p_allowed_catalog_ids));
end;
$policy$;
revoke all on function public.admin_set_period_catalog_policy(uuid,boolean,uuid[],timestamptz,timestamptz,bigint) from public,anon,authenticated;
grant execute on function public.admin_set_period_catalog_policy(uuid,boolean,uuid[],timestamptz,timestamptz,bigint) to authenticated;

drop function if exists public.submit_song_from_catalog(uuid,text,text);
create function public.submit_song_from_catalog(p_catalog_id uuid,p_playlist_date text,p_voter_cookie text)
returns table(id uuid,title text,artist text,playlist_date text,likes_count integer,created_at timestamptz,error_code text,error_message text)
language plpgsql security definer set search_path=public as $submit_catalog$
declare selected public.song_catalog%rowtype; policy public.period_catalog_policies%rowtype; result record; target uuid;
begin
  target=p_playlist_date::uuid;
  perform 1 from public.playlist_periods p where p.id=target for share;
  select * into policy from public.period_catalog_policies where period_id=target for share;
  select * into selected from public.song_catalog where song_catalog.id=p_catalog_id for share;
  if selected.id is null or not selected.is_active or not selected.is_available or nullif(trim(selected.source_url),'') is null
    or (coalesce(policy.whitelist_enabled,false)
      and (policy.starts_at is null or clock_timestamp()>=policy.starts_at)
      and (policy.ends_at is null or clock_timestamp()<policy.ends_at)
      and not (p_catalog_id=any(policy.allowed_catalog_ids))) then
    perform public.consume_api_attempt('submission',p_playlist_date,p_voter_cookie);
    return query select null::uuid,null::text,null::text,null::text,0,null::timestamptz,'P0001'::text,'这首歌当前没有可用音源，或不在本期可选范围内。'::text;
    return;
  end if;
  -- Reuse validated rate limits, tester access, account quota and duplicate rules.
  select * into result from public.submit_song(selected.title,selected.artist,p_playlist_date,p_voter_cookie);
  if result.id is not null then update public.songs set catalog_id=p_catalog_id where songs.id=result.id; end if;
  return query select result.id,result.title,result.artist,result.playlist_date,result.likes_count,result.created_at,result.error_code,result.error_message;
end;
$submit_catalog$;
-- Internal only: QQ gateway supplies the trusted identity. Never expose a cookie-based bypass.
revoke all on function public.submit_song_from_catalog(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.submit_song(text,text,text,text) from anon,authenticated;

create or replace function public.qq_participate(
  p_app_id text,p_openid text,p_nickname text,p_avatar text,
  p_operation text,p_period_id uuid,p_song_id uuid default null,
  p_title text default null,p_artist text default null,p_action text default null,
  p_reason text default null,p_test_user_id uuid default null,p_client_ip text default null
)
returns jsonb language plpgsql security definer set search_path=public as $qq$
declare account_id uuid; actor text; test_period boolean; result jsonb;
  previous_sub text=current_setting('request.jwt.claim.sub',true);
  previous_claims text=current_setting('request.jwt.claims',true);
  previous_headers text=current_setting('request.headers',true);
begin
  if p_operation is null or p_operation not in ('votes','submit','like','dislike')
    or p_app_id is null or p_app_id !~ '^[0-9]+$'
    or nullif(trim(p_openid),'') is null or length(p_openid)>128 then
    return jsonb_build_object('error','invalid_request');
  end if;
  -- Same lock order as test-mode changes and the existing rate-limit guard.
  select is_test into test_period from public.playlist_periods where id=p_period_id for share;
  if not found then return jsonb_build_object('error','period_unavailable'); end if;
  if test_period then
    perform 1 from public.test_accounts where user_id=p_test_user_id and enabled for share;
    if not found then return jsonb_build_object('error','test_login_required'); end if;
  end if;
  insert into public.qq_accounts(app_id,openid,nickname,avatar)
    values(p_app_id,p_openid,left(coalesce(p_nickname,'QQ 用户'),100),left(coalesce(p_avatar,''),2048))
    on conflict(app_id,openid) do update set nickname=excluded.nickname,avatar=excluded.avatar,updated_at=clock_timestamp()
    returning id into account_id;
  perform public.assert_qq_account_allowed(account_id,p_operation);
  -- Formal periods use the persistent QQ account UUID. Test periods keep their
  -- existing tester UUID and additionally require QQ login at the backend.
  actor=case when test_period then p_test_user_id::text else account_id::text end;
  perform set_config('request.jwt.claim.sub',coalesce(p_test_user_id::text,''),true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','service_role','sub',p_test_user_id)::text,true);
  -- The backend supplies the peer IP from Nginx, not a browser field. Otherwise
  -- every visitor would share the backend server's Supabase rate-limit IP.
  if p_client_ip is not null then perform p_client_ip::inet; end if;
  perform set_config('request.headers',jsonb_build_object('x-real-ip',p_client_ip)::text,true);
  if p_operation='votes' then
    result=jsonb_build_object(
      'likes',(select coalesce(jsonb_agg(song_id),'[]'::jsonb) from public.get_my_likes(p_period_id::text,actor)),
      'dislikes',(select coalesce(jsonb_agg(song_id),'[]'::jsonb) from public.get_my_dislikes(p_period_id::text,actor)));
  elsif p_operation='submit' then
    select to_jsonb(r) into result from public.submit_song_from_catalog(p_song_id,p_period_id::text,actor) r;
  elsif p_operation='like' and p_action in ('on','off') then
    select to_jsonb(r) into result from public.toggle_song_like(p_song_id,p_period_id::text,actor,
      case p_action when 'on' then 'like' else 'unlike' end) r;
  elsif p_operation='dislike' and p_action in ('on','off') then
    select to_jsonb(r) into result from public.toggle_song_dislike(p_song_id,p_period_id::text,actor,
      case p_action when 'on' then 'dislike' else 'undislike' end,p_reason) r;
  else
    result=jsonb_build_object('error','invalid_request');
  end if;
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  perform set_config('request.headers',coalesce(previous_headers,''),true);
  -- Only business errors from our existing RPCs are returned. SQL/permission
  -- failures remain generic at the HTTP boundary. Counters remain committed.
  if result->>'error_message' like '本浏览器%' then
    result=jsonb_set(result,'{error_message}',to_jsonb(replace(result->>'error_message','本浏览器','本账号')));
  end if;
  return result;
exception when sqlstate 'P0002' then
  return jsonb_build_object('error',case when sqlerrm in ('account_banned','voting_restricted','submission_restricted') then sqlerrm else 'participation_unavailable' end);
when sqlstate 'P0001' then
  -- Rate-limit failures occur before a new attempt is inserted. Return a stable
  -- code instead of leaking arbitrary SQL error text through the HTTP gateway.
  return jsonb_build_object('error',case when sqlerrm='请求过于频繁，请稍后再试。'
    then 'rate_limited' else 'period_unavailable' end);
end;
$qq$;
revoke all on function public.qq_participate(text,text,text,text,text,uuid,uuid,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.qq_participate(text,text,text,text,text,uuid,uuid,text,text,text,text,uuid,text) to service_role;


create or replace function public.qq_catalog_health()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('ok',position('submit_song_from_catalog' in pg_get_functiondef('public.qq_participate(text,text,text,text,text,uuid,uuid,text,text,text,text,uuid,text)'::regprocedure))>0
    and not has_function_privilege('anon','public.submit_song_from_catalog(uuid,text,text)','EXECUTE')
    and not has_function_privilege('authenticated','public.submit_song_from_catalog(uuid,text,text)','EXECUTE'));
$$;
revoke all on function public.qq_catalog_health() from public,anon,authenticated;
grant execute on function public.qq_catalog_health() to service_role;
notify pgrst, 'reload schema';
commit;
