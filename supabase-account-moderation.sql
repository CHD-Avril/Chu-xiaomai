-- Incremental migration AFTER supabase-qq-participation.sql. Preserves all data.
-- Always apply this last: it installs the guarded QQ participation gateway.
begin;

do $prerequisites$ begin
  if to_regclass('public.qq_accounts') is null or to_regclass('public.admin_action_log') is null then
    raise exception '请先执行 QQ 登录和管理工作流迁移；本迁移不会清空数据。';
  end if;
end; $prerequisites$;

create table if not exists public.account_moderation (
  account_id uuid primary key references public.qq_accounts(id),
  vote_until timestamptz,
  submission_until timestamptz,
  ban_until timestamptz,
  version bigint not null default 0 check(version>=0)
);
create table if not exists public.account_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.qq_accounts(id),
  action text not null check(action in ('warn','restrict_vote','restrict_submission','ban','lift_vote','lift_submission','unban')),
  reason text not null check(length(trim(reason)) between 1 and 500),
  expires_at timestamptz,
  actor_id uuid not null,
  actor_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(id,account_id)
);
create index if not exists account_moderation_actions_account_idx on public.account_moderation_actions(account_id,created_at desc,id);
create table if not exists public.account_notice_reads (
  account_id uuid not null references public.qq_accounts(id),
  action_id uuid not null,
  read_at timestamptz not null default clock_timestamp(),
  primary key(account_id,action_id),
  foreign key(action_id,account_id) references public.account_moderation_actions(id,account_id)
);
alter table public.account_moderation enable row level security;
alter table public.account_moderation_actions enable row level security;
alter table public.account_notice_reads enable row level security;
revoke all on public.account_moderation,public.account_moderation_actions,public.account_notice_reads from public,anon,authenticated;
-- No client has direct table writes, including an authenticated administrator.
grant select on public.account_moderation,public.account_moderation_actions to authenticated;
drop policy if exists account_moderation_admin_read on public.account_moderation;
create policy account_moderation_admin_read on public.account_moderation for select to authenticated using(public.is_current_user_admin());
drop policy if exists account_actions_admin_read on public.account_moderation_actions;
create policy account_actions_admin_read on public.account_moderation_actions for select to authenticated using(public.is_current_user_admin());

create or replace function public.qq_moderation_state(p_account_id uuid)
returns jsonb language sql volatile security definer set search_path=public as $$
  select jsonb_build_object('version',coalesce(m.version,0),
    'banned',coalesce(m.ban_until>clock_timestamp(),false),
    'vote_restricted',coalesce(m.vote_until>clock_timestamp(),false),
    'submission_restricted',coalesce(m.submission_until>clock_timestamp(),false),
    'ban_until',case when m.ban_until='infinity'::timestamptz then null else m.ban_until end,
    'vote_until',case when m.vote_until='infinity'::timestamptz then null else m.vote_until end,
    'submission_until',case when m.submission_until='infinity'::timestamptz then null else m.submission_until end)
  from (select p_account_id id) a left join public.account_moderation m on m.account_id=a.id;
$$;
revoke all on function public.qq_moderation_state(uuid) from public,anon,authenticated,service_role;

create or replace function public.assert_qq_account_allowed(p_account_id uuid,p_operation text)
returns void language plpgsql security definer set search_path=public as $$
declare m public.account_moderation%rowtype;
begin
  if p_operation='votes' then return; end if; -- Personal state remains readable.
  select * into m from public.account_moderation where account_id=p_account_id;
  if m.ban_until>clock_timestamp() then raise exception 'account_banned' using errcode='P0002'; end if;
  if p_operation in ('like','dislike') and m.vote_until>clock_timestamp() then raise exception 'voting_restricted' using errcode='P0002'; end if;
  if p_operation='submit' and m.submission_until>clock_timestamp() then raise exception 'submission_restricted' using errcode='P0002'; end if;
end;
$$;
revoke all on function public.assert_qq_account_allowed(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.admin_list_qq_accounts(p_search text default '',p_offset integer default 0,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; keyword text=left(trim(coalesce(p_search,'')),100);
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  if p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100 then raise exception '分页参数无效。'; end if;
  select jsonb_build_object('total',(select count(*) from public.qq_accounts a where keyword='' or a.id::text=keyword or a.nickname ilike '%'||keyword||'%'),
    'items',coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb)) into result from (
    select a.id,a.nickname,a.avatar,a.created_at,a.updated_at,public.qq_moderation_state(a.id) moderation
    from public.qq_accounts a where keyword='' or a.id::text=keyword or a.nickname ilike '%'||keyword||'%'
    order by a.updated_at desc,a.id limit p_limit offset p_offset
  ) rows;
  return result;
end;
$$;

create or replace function public.admin_get_account_moderation(p_account_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare account public.qq_accounts%rowtype;
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  select * into account from public.qq_accounts where id=p_account_id;
  if not found then raise exception '站内账号不存在，请刷新账号列表。'; end if;
  return jsonb_build_object('account',jsonb_build_object('id',account.id,'nickname',account.nickname,'avatar',account.avatar),
    'moderation',public.qq_moderation_state(account.id),
    'actions',(select coalesce(jsonb_agg(to_jsonb(events)),'[]'::jsonb) from (
      select id,action,reason,expires_at,actor_name,created_at from public.account_moderation_actions
      where account_id=account.id order by created_at desc,id limit 100
    ) events));
end;
$$;

create or replace function public.admin_moderate_account(p_account_id uuid,p_action text,p_reason text,p_duration_hours integer,p_expected_version bigint)
returns void language plpgsql security definer set search_path=public as $$
declare current_version bigint; expiry timestamptz; name text; event_id uuid;
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  if nullif(trim(p_reason),'') is null or length(trim(p_reason))>500 then raise exception '请填写 1–500 字的处理原因。'; end if;
  if p_action is null or p_action not in ('warn','restrict_vote','restrict_submission','ban','lift_vote','lift_submission','unban') then raise exception '处理类型无效。'; end if;
  if p_expected_version is null or p_expected_version<0 then raise exception '请先刷新账号状态。'; end if;
  if p_action in ('restrict_vote','restrict_submission','ban') then
    if p_duration_hours is not null and p_duration_hours not between 1 and 87600 then raise exception '限制时长须为 1–87600 小时，或选择长期。'; end if;
    expiry=case when p_duration_hours is null then 'infinity'::timestamptz else clock_timestamp()+make_interval(hours=>p_duration_hours) end;
  elsif p_duration_hours is not null then raise exception '警告和解除限制不需要设置时长。'; end if;
  -- Gateway writes already lock this account after their period lock. Waiting
  -- here makes a committed restriction apply to every following write request.
  perform 1 from public.qq_accounts where id=p_account_id for update;
  if not found then raise exception '站内账号不存在。'; end if;
  insert into public.account_moderation(account_id) values(p_account_id) on conflict do nothing;
  select version into current_version from public.account_moderation where account_id=p_account_id for update;
  if current_version<>p_expected_version then raise exception '账号状态已被其他管理员修改，请重新读取后再处理。'; end if;
  update public.account_moderation set
    vote_until=case p_action when 'restrict_vote' then expiry when 'lift_vote' then null else vote_until end,
    submission_until=case p_action when 'restrict_submission' then expiry when 'lift_submission' then null else submission_until end,
    ban_until=case p_action when 'ban' then expiry when 'unban' then null else ban_until end,
    version=version+1 where account_id=p_account_id;
  name=coalesce(auth.jwt()->>'email',auth.uid()::text);
  insert into public.account_moderation_actions(account_id,action,reason,expires_at,actor_id,actor_name)
    values(p_account_id,p_action,trim(p_reason),case when expiry='infinity'::timestamptz then null else expiry end,auth.uid(),name)
    returning id into event_id;
  insert into public.admin_action_log(actor_id,actor_name,action,target_id,details)
    values(auth.uid(),name,'account_'||p_action,p_account_id,jsonb_build_object('reason',trim(p_reason),'notice_id',event_id,'expires_at',case when expiry='infinity'::timestamptz then null else expiry end));
end;
$$;
revoke all on function public.admin_list_qq_accounts(text,integer,integer),public.admin_get_account_moderation(uuid),
  public.admin_moderate_account(uuid,text,text,integer,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_qq_accounts(text,integer,integer),public.admin_get_account_moderation(uuid),
  public.admin_moderate_account(uuid,text,text,integer,bigint) to authenticated;

create or replace function public.qq_account_status(p_app_id text,p_openid text,p_nickname text,p_avatar text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target_account_id uuid;
begin
  if p_app_id is null or p_app_id !~ '^[0-9]+$' or nullif(trim(p_openid),'') is null or length(p_openid)>128 then raise exception 'Invalid identity.'; end if;
  insert into public.qq_accounts(app_id,openid,nickname,avatar)
    values(p_app_id,p_openid,left(coalesce(p_nickname,'QQ 用户'),100),left(coalesce(p_avatar,''),2048))
    on conflict(app_id,openid) do update set nickname=excluded.nickname,avatar=excluded.avatar,updated_at=clock_timestamp() returning id into target_account_id;
  return jsonb_build_object('id',target_account_id,'moderation',public.qq_moderation_state(target_account_id),
    'unread_count',(select count(*) from public.account_moderation_actions a where a.account_id=target_account_id
      and not exists(select 1 from public.account_notice_reads r where r.account_id=a.account_id and r.action_id=a.id)),
    'notices',(select coalesce(jsonb_agg(to_jsonb(events)),'[]'::jsonb) from (
      select a.id,a.action,a.reason,a.expires_at,a.created_at,exists(select 1 from public.account_notice_reads r where r.account_id=a.account_id and r.action_id=a.id) is_read
      from public.account_moderation_actions a where a.account_id=target_account_id order by a.created_at desc,a.id limit 50
    ) events));
end;
$$;

create or replace function public.qq_read_account_notice(p_app_id text,p_openid text,p_notice_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
  select id into target from public.qq_accounts where app_id=p_app_id and openid=p_openid;
  if target is null then return jsonb_build_object('error','notice_not_found'); end if;
  if p_notice_id is not null and not exists(select 1 from public.account_moderation_actions where id=p_notice_id and account_id=target) then
    return jsonb_build_object('error','notice_not_found');
  end if;
  insert into public.account_notice_reads(account_id,action_id)
    select target,id from public.account_moderation_actions where account_id=target and (p_notice_id is null or id=p_notice_id)
    on conflict do nothing;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.qq_account_status(text,text,text,text),public.qq_read_account_notice(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.qq_account_status(text,text,text,text),public.qq_read_account_notice(text,text,uuid) to service_role;

-- GUARDED_GATEWAY: based on supabase-qq-participation.sql, plus account checks.

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


-- END_GUARDED_GATEWAY

create or replace function public.qq_moderation_health()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('ok',position('assert_qq_account_allowed' in pg_get_functiondef(
    'public.qq_participate(text,text,text,text,text,uuid,uuid,text,text,text,text,uuid,text)'::regprocedure))>0,'version',1);
$$;
revoke all on function public.qq_moderation_health() from public,anon,authenticated,service_role;
grant execute on function public.qq_moderation_health() to service_role;

notify pgrst, 'reload schema';
commit;
