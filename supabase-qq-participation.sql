-- Incremental migration: run AFTER supabase-test-mode.sql. Keeps existing data.
-- Public browsing stays available; all participation goes through the QQ backend.
begin;

do $prerequisites$
begin
  if to_regprocedure('public.assert_test_period_access(text,text,boolean)') is null
    or to_regclass('public.test_accounts') is null then
    raise exception '请先执行 supabase-test-mode.sql；本迁移不会清空数据。';
  end if;
end;
$prerequisites$;

create table if not exists public.qq_accounts (
  id uuid primary key default gen_random_uuid(),
  app_id text not null check (app_id ~ '^[0-9]+$'),
  openid text not null check (length(openid) between 1 and 128),
  nickname text not null,
  avatar text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_id,openid)
);
alter table public.qq_accounts enable row level security;
revoke all on public.qq_accounts from public,anon,authenticated;
grant select on public.qq_accounts to authenticated;
drop policy if exists qq_accounts_admin_read on public.qq_accounts;
create policy qq_accounts_admin_read on public.qq_accounts for select to authenticated
  using (public.is_current_user_admin());

-- The backend supplies the profile from its verified HttpOnly QQ session. Only a
-- server Secret/service_role key may call this entry point, never the browser.
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
    select to_jsonb(r) into result from public.submit_song(p_title,p_artist,p_period_id::text,actor) r;
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
exception when sqlstate 'P0001' then
  -- Rate-limit failures occur before a new attempt is inserted. Return a stable
  -- code instead of leaking arbitrary SQL error text through the HTTP gateway.
  return jsonb_build_object('error',case when sqlerrm='请求过于频繁，请稍后再试。'
    then 'rate_limited' else 'period_unavailable' end);
end;
$qq$;
revoke all on function public.qq_participate(text,text,text,text,text,uuid,uuid,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.qq_participate(text,text,text,text,text,uuid,uuid,text,text,text,text,uuid,text) to service_role;

-- Close the old anonymous paths, including reads of another actor's vote state.
-- Internal SECURITY DEFINER calls above keep using the tested business logic.
revoke all on function public.submit_song(text,text,text,text),
  public.toggle_song_like(uuid,text,text,text),
  public.toggle_song_dislike(uuid,text,text,text,text),
  public.get_my_likes(text,text),public.get_my_dislikes(text,text)
  from public,anon,authenticated;

notify pgrst, 'reload schema';
commit;
