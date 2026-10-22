-- After supabase-schema.sql, supabase-admin-workflow.sql and supabase-database-integrity.sql.
-- Preserves all existing periods, songs and votes. Safe to run repeatedly.
begin;

do $prerequisites$
begin
  if to_regclass('public.admin_action_log') is null
    or to_regprocedure('public.consume_api_attempt(text,text,text)') is null
    or (select count(*) from information_schema.columns where table_schema='public'
      and table_name in ('songs','song_likes','song_dislikes','song_reports','vote_attempts')
      and column_name='period_id' and udt_name='uuid') <> 5 then
    raise exception '测试模式依赖的数据库升级尚未完成。保留数据：先执行 supabase-admin-workflow.sql、supabase-database-integrity.sql；舍弃旧业务数据：完整执行 supabase-reset-and-rebuild.sql。';
  end if;
end;
$prerequisites$;

alter table public.playlist_periods add column if not exists is_test boolean not null default false;
grant select (is_test) on public.playlist_periods to anon,authenticated;

create table if not exists public.test_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  granted_by uuid not null,
  updated_at timestamptz not null default now()
);
alter table public.test_accounts enable row level security;
revoke all on public.test_accounts from public, anon, authenticated;
grant select on public.test_accounts to authenticated;
drop policy if exists test_accounts_admin_read on public.test_accounts;
create policy test_accounts_admin_read on public.test_accounts for select to authenticated using (public.is_current_user_admin());

create or replace function public.is_current_user_tester()
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and exists(select 1 from public.test_accounts where user_id=auth.uid() and enabled);
$$;
revoke all on function public.is_current_user_tester() from public;
grant execute on function public.is_current_user_tester() to anon, authenticated;

create or replace function public.can_read_period(p_period_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.playlist_periods p where p.id=p_period_id
    and (not p.is_test or public.is_current_user_tester() or public.is_current_user_admin()));
$$;
revoke all on function public.can_read_period(uuid) from public;
grant execute on function public.can_read_period(uuid) to anon, authenticated;

-- Restrictive policies also constrain any pre-existing permissive SELECT policies.
drop policy if exists songs_test_access on public.songs;
create policy songs_test_access on public.songs as restrictive for select to anon, authenticated
  using (public.can_read_period(period_id));
drop policy if exists periods_test_access on public.playlist_periods;
create policy periods_test_access on public.playlist_periods as restrictive for select to anon, authenticated
  using (not is_test or status='active' or public.is_current_user_tester() or public.is_current_user_admin());

create or replace function public.assert_test_period_access(p_period text,p_cookie text,p_write boolean)
returns void language plpgsql security definer set search_path=public as $$
declare target uuid; test_period boolean;
begin
  begin target=p_period::uuid; exception when invalid_text_representation then return; end;
  -- Serializes mode changes with participation requests, including cancellation.
  select is_test into test_period from public.playlist_periods where id=target for share;
  if coalesce(test_period,false) then
    -- Let revocation wait for an already-authorized request to finish.
    perform 1 from public.test_accounts where user_id=auth.uid() and enabled for share;
    if public.is_current_user_tester() is not true then
      if p_write or public.is_current_user_admin() is not true then
        raise exception '当前为测试期，请使用已授权的测试账号登录。';
      end if;
    end if;
    if p_cookie is distinct from auth.uid()::text then
      raise exception '测试身份已变化，请重新登录。';
    end if;
  end if;
end;
$$;
revoke all on function public.assert_test_period_access(text,text,boolean) from public,anon,authenticated;

-- Every public submission/vote RPC calls this internal entry point before writing.
-- Test identities use the authenticated account UUID rather than a replaceable cookie.
create or replace function public.consume_api_attempt(p_type text,p_period text,p_cookie text)
returns void language plpgsql security definer set search_path=public as $rate$
declare cfg public.security_settings%rowtype; cookie_key text=md5(coalesce(left(btrim(p_cookie),128),'')); ip text; lock_key bigint; cookie_limit int; ip_limit int;
begin
  perform public.assert_test_period_access(p_period,p_cookie,true);
  select * into strict cfg from public.security_settings where id=true;
  ip=public.request_client_ip();
  -- Period mode lock -> sorted rate locks -> actor -> song -> report.
  for lock_key in select distinct key from unnest(array[
    hashtextextended('rate-cookie:'||p_type||':'||cookie_key,0),
    case when ip is null then null else hashtextextended('rate-ip:'||p_type||':'||ip,0) end
  ]) key where key is not null order by key loop perform pg_advisory_xact_lock(lock_key); end loop;
  if p_type='vote' then cookie_limit=cfg.vote_cookie_per_minute; ip_limit=cfg.vote_ip_per_minute;
  elsif p_type='submission' then cookie_limit=cfg.submission_cookie_per_minute; ip_limit=cfg.submission_ip_per_minute;
  else raise exception 'Invalid request type.'; end if;
  if (select count(*) from public.api_request_attempts where attempt_type=p_type and cookie_hash=cookie_key and created_at>=clock_timestamp()-interval '1 minute')>=cookie_limit
    or (ip is not null and (select count(*) from public.api_request_attempts where attempt_type=p_type and client_ip=ip and created_at>=clock_timestamp()-interval '1 minute')>=ip_limit) then
    raise exception '请求过于频繁，请稍后再试。' using errcode='P0001';
  end if;
  insert into public.api_request_attempts(attempt_type,cookie_hash,client_ip,requested_period) values(p_type,cookie_key,ip,left(p_period,64));
end;
$rate$;
revoke all on function public.consume_api_attempt(text,text,text) from public,anon,authenticated;

create or replace function public.get_my_likes(p_playlist_date text,p_voter_cookie text)
returns table(song_id uuid) language plpgsql security definer set search_path=public as $$
declare normalized_cookie text;
begin
  perform public.assert_test_period_access(p_playlist_date,p_voter_cookie,false);
  normalized_cookie=public.assert_valid_voter_cookie(p_voter_cookie);
  return query select l.song_id from public.song_likes l where l.playlist_date=p_playlist_date and l.voter_cookie=normalized_cookie order by l.created_at desc limit 500;
end;
$$;
create or replace function public.get_my_dislikes(p_playlist_date text,p_voter_cookie text)
returns table(song_id uuid) language plpgsql security definer set search_path=public as $$
declare normalized_cookie text;
begin
  perform public.assert_test_period_access(p_playlist_date,p_voter_cookie,false);
  normalized_cookie=public.assert_valid_voter_cookie(p_voter_cookie);
  return query select d.song_id from public.song_dislikes d where d.playlist_date=p_playlist_date and d.voter_cookie=normalized_cookie order by d.created_at desc limit 500;
end;
$$;
revoke all on function public.get_my_likes(text,text),public.get_my_dislikes(text,text) from public;
grant execute on function public.get_my_likes(text,text),public.get_my_dislikes(text,text) to anon,authenticated;

create or replace function public.admin_list_test_accounts()
returns table(user_id uuid,email text,enabled boolean,updated_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  return query select t.user_id,u.email::text,t.enabled,t.updated_at from public.test_accounts t join auth.users u on u.id=t.user_id order by t.updated_at desc,t.user_id;
end;
$$;

create or replace function public.admin_set_test_account(p_email text,p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  if p_enabled is null or nullif(trim(p_email),'') is null then raise exception '请填写测试账号邮箱。'; end if;
  select id into target from auth.users where lower(email)=lower(trim(p_email));
  if target is null then raise exception '该账号尚未创建，请先在 Supabase Authentication 中创建邮箱账号并设置密码。'; end if;
  insert into public.test_accounts(user_id,enabled,granted_by,updated_at) values(target,p_enabled,auth.uid(),clock_timestamp())
    on conflict(user_id) do update set enabled=excluded.enabled,granted_by=excluded.granted_by,updated_at=excluded.updated_at;
  insert into public.admin_action_log(actor_id,actor_name,action,target_id,details)
    values(auth.uid(),coalesce(auth.jwt()->>'email',auth.uid()::text),case when p_enabled then 'grant_test_account' else 'revoke_test_account' end,target,jsonb_build_object('email',lower(trim(p_email))));
end;
$$;

create or replace function public.admin_set_period_test_mode(p_period_id uuid,p_enabled boolean,p_expected boolean)
returns void language plpgsql security definer set search_path=public as $$
declare previous public.playlist_periods%rowtype;
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  if p_enabled is null or p_expected is null then raise exception '测试模式参数无效。'; end if;
  select * into previous from public.playlist_periods where id=p_period_id for update;
  if not found or previous.status<>'active' then raise exception '当前征集期已变化，请刷新后重试。'; end if;
  if previous.is_test is distinct from p_expected then raise exception '测试模式已被其他运营人员修改，请刷新后重试。'; end if;
  if p_enabled and not exists(select 1 from public.test_accounts where enabled) then raise exception '请先授权至少一个测试账号。'; end if;
  update public.playlist_periods set is_test=p_enabled,updated_at=clock_timestamp() where id=p_period_id;
  insert into public.admin_action_log(actor_id,actor_name,action,target_id,details)
    values(auth.uid(),coalesce(auth.jwt()->>'email',auth.uid()::text),'set_test_mode',p_period_id,jsonb_build_object('before',previous.is_test,'after',p_enabled));
end;
$$;
revoke all on function public.admin_list_test_accounts(),public.admin_set_test_account(text,boolean),public.admin_set_period_test_mode(uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.admin_list_test_accounts(),public.admin_set_test_account(text,boolean),public.admin_set_period_test_mode(uuid,boolean,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
