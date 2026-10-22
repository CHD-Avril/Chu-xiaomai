-- 管理台工作流增量迁移。新数据库先执行 supabase-schema.sql；随后必须执行 supabase-database-integrity.sql。
-- 整个迁移在事务中执行。不会修改既有歌曲、投票或征集期。
begin;

alter table public.song_reports
  add column if not exists review_reason text,
  add column if not exists reviewed_by_name text;

create table if not exists public.admin_action_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  actor_name text not null,
  action text not null,
  target_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_action_log_target_idx on public.admin_action_log(target_id, created_at desc);
alter table public.admin_action_log enable row level security;
revoke all on public.admin_action_log from anon, authenticated;
grant select on public.admin_action_log to authenticated;
drop policy if exists admin_action_log_read on public.admin_action_log;
create policy admin_action_log_read on public.admin_action_log for select to authenticated
  using (public.is_current_user_admin());

create table if not exists public.broadcast_playlists (
  period_id uuid primary key references public.playlist_periods(id) on delete restrict,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  version integer not null default 1,
  updated_by_name text not null,
  updated_at timestamptz not null default now()
);
alter table public.broadcast_playlists enable row level security;
revoke all on public.broadcast_playlists from anon, authenticated;
grant select on public.broadcast_playlists to authenticated;
drop policy if exists broadcast_playlists_read on public.broadcast_playlists;
create policy broadcast_playlists_read on public.broadcast_playlists for select to authenticated
  using (public.is_current_user_admin());

create or replace function public.admin_create_playlist_period(p_title text, p_starts_at timestamptz, p_ends_at timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  if p_title is null or length(trim(p_title)) not between 1 and 80 or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception '请填写标题和有效的征集时间。';
  end if;
  -- 同时串行化旧版直接写入和新版 RPC，归档与创建共同提交或回滚。
  lock table public.playlist_periods in share row exclusive mode;
  update public.playlist_periods set status = 'archived', archived_at = now(), updated_at = now() where status = 'active';
  insert into public.playlist_periods(title, starts_at, ends_at, status, created_by)
    values(trim(p_title), p_starts_at, p_ends_at, 'active', auth.uid()::text) returning id into new_id;
  insert into public.admin_action_log(actor_id, actor_name, action, target_id, details)
    values(auth.uid(), coalesce(auth.jwt()->>'email', auth.uid()::text), 'create_period', new_id, jsonb_build_object('title', trim(p_title)));
  return new_id;
end;
$$;

create or replace function public.admin_update_song(p_song_id uuid, p_title text, p_artist text, p_locked boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare previous public.songs%rowtype;
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  if p_title is null or length(trim(p_title)) not between 1 and 80 or p_artist is null or length(trim(p_artist)) not between 1 and 80
    or p_reason is null or length(trim(p_reason)) not between 1 and 500 or p_locked is null then
    raise exception '歌名和歌手须为 1–80 字，并填写 1–500 字操作原因。';
  end if;
  select * into previous from public.songs where id = p_song_id for update;
  if not found then raise exception '歌曲不存在，请刷新列表。'; end if;
  update public.songs set title = trim(p_title), artist = trim(p_artist), title_lower = lower(trim(p_title)), artist_lower = lower(trim(p_artist)),
    is_locked = p_locked,
    locked_at = case when p_locked and not previous.is_locked then now() when p_locked then previous.locked_at else null end,
    locked_by = case when p_locked and not previous.is_locked then auth.uid()::text when p_locked then previous.locked_by else null end
    where id = p_song_id;
  insert into public.admin_action_log(actor_id, actor_name, action, target_id, details)
    values(auth.uid(), coalesce(auth.jwt()->>'email', auth.uid()::text), 'update_song', p_song_id,
      jsonb_build_object('reason', trim(p_reason), 'before', jsonb_build_object('title', previous.title, 'artist', previous.artist, 'locked', previous.is_locked),
      'after', jsonb_build_object('title', trim(p_title), 'artist', trim(p_artist), 'locked', p_locked)));
end;
$$;

-- 审核历史中的恢复操作只改状态，避免旧界面中的名称覆盖后来的歌名修订。
create or replace function public.admin_set_song_lock(p_song_id uuid, p_locked boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare song_record public.songs%rowtype;
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  select * into song_record from public.songs where id = p_song_id for update;
  if not found then raise exception '歌曲不存在，请刷新列表。'; end if;
  perform public.admin_update_song(p_song_id, song_record.title, song_record.artist, p_locked, p_reason);
end;
$$;

create or replace function public.admin_review_song_report(p_report_id uuid, p_approve boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  if p_approve is null or p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception '请填写审核原因。'; end if;
  perform public.review_song_report(p_report_id, p_approve);
  update public.song_reports set review_reason = trim(p_reason), reviewed_by_name = coalesce(auth.jwt()->>'email', auth.uid()::text) where id = p_report_id;
  insert into public.admin_action_log(actor_id, actor_name, action, target_id, details)
    values(auth.uid(), coalesce(auth.jwt()->>'email', auth.uid()::text), 'review_report', p_report_id,
      jsonb_build_object('approved', p_approve, 'reason', trim(p_reason)));
end;
$$;

create or replace function public.admin_update_playlist_period(p_period_id uuid,p_title text,p_starts_at timestamptz,p_ends_at timestamptz)
returns void language plpgsql security definer set search_path=public as $edit$
declare previous public.playlist_periods%rowtype;
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  if p_title is null or length(trim(p_title)) not between 1 and 80 or p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at then raise exception '请填写标题和有效的征集时间。'; end if;
  select * into previous from public.playlist_periods where id=p_period_id for update;
  if not found or previous.status<>'active' then raise exception '当前征集期已变化，请刷新后重试。'; end if;
  update public.playlist_periods set title=trim(p_title),starts_at=p_starts_at,ends_at=p_ends_at,updated_at=clock_timestamp() where id=p_period_id;
  insert into public.admin_action_log(actor_id,actor_name,action,target_id,details) values(auth.uid(),coalesce(auth.jwt()->>'email',auth.uid()::text),'edit_period',p_period_id,
    jsonb_build_object('before',to_jsonb(previous),'title',trim(p_title),'starts_at',p_starts_at,'ends_at',p_ends_at));
end;
$edit$;
create or replace function public.admin_archive_playlist_period(p_period_id uuid)
returns void language plpgsql security definer set search_path=public as $archive$
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  update public.playlist_periods set status='archived',archived_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_period_id and status='active';
  if not found then raise exception '当前征集期已变化，请刷新后重试。'; end if;
  insert into public.admin_action_log(actor_id,actor_name,action,target_id) values(auth.uid(),coalesce(auth.jwt()->>'email',auth.uid()::text),'archive_period',p_period_id);
end;
$archive$;
revoke all on function public.admin_update_playlist_period(uuid,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.admin_archive_playlist_period(uuid) from public,anon,authenticated;
grant execute on function public.admin_update_playlist_period(uuid,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_archive_playlist_period(uuid) to authenticated;

create or replace function public.admin_save_broadcast_playlist(p_period_id uuid,p_items jsonb,p_version integer)
returns integer language plpgsql security definer set search_path=public as $board$
declare current_version int; next_version int; old_items jsonb; next_items jsonb='[]'::jsonb; item jsonb; old_item jsonb; canonical jsonb; song_record public.songs%rowtype;
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception '歌单格式无效。'; end if;
  if jsonb_array_length(p_items)>500 or p_version is null or p_version<0 then raise exception '歌单数量或版本无效。'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_period_id::text,0));
  perform 1 from public.playlist_periods where id=p_period_id for share;
  if not found then raise exception '征集期不存在。'; end if;
  select version,items into current_version,old_items from public.broadcast_playlists where period_id=p_period_id for update;
  if coalesce(current_version,0)<>p_version then raise exception '歌单已被其他管理员更新，请重新读取后再修改。'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) i where jsonb_typeof(i)<>'object' or i->>'song_id' is null or i->>'status' is null or i->>'status' not in('candidate','confirmed')) then raise exception '歌单条目格式无效。'; end if;
  if jsonb_array_length(p_items)<>(select count(distinct i->>'song_id') from jsonb_array_elements(p_items) i) then raise exception '歌单不能包含重复歌曲。'; end if;
  -- Deterministic song lock order shared with all playlist writers.
  perform 1 from public.songs s where s.id::text in(select i->>'song_id' from jsonb_array_elements(p_items) i) order by s.id for share;
  for item in select value from jsonb_array_elements(p_items) loop
    select * into song_record from public.songs where id::text=item->>'song_id' and playlist_date=p_period_id::text;
    if not found or (item->>'status'='confirmed' and song_record.is_locked) then raise exception '歌单包含不存在、其他征集期或已锁定的确认歌曲，请重新读取并调整。'; end if;
    canonical=jsonb_build_object('song_id',song_record.id,'status',item->>'status');
    if item->>'status'='confirmed' then
      select value into old_item from jsonb_array_elements(coalesce(old_items,'[]'::jsonb)) where value->>'song_id'=item->>'song_id' and value->>'status'='confirmed';
      if old_item->'snapshot' is not null and jsonb_typeof(old_item->'snapshot')='object' then
        canonical=canonical||jsonb_build_object('snapshot',old_item->'snapshot');
      else
        canonical=canonical||jsonb_build_object('snapshot',jsonb_build_object('title',song_record.title,'artist',song_record.artist,'likes_count',song_record.likes_count,'captured_at',clock_timestamp(),'source','confirmation'));
      end if;
    end if;
    next_items=next_items||jsonb_build_array(canonical);
  end loop;
  next_version=coalesce(current_version,0)+1;
  insert into public.broadcast_playlists(period_id,items,version,updated_by_name) values(p_period_id,next_items,next_version,coalesce(auth.jwt()->>'email',auth.uid()::text))
    on conflict(period_id) do update set items=excluded.items,version=excluded.version,updated_by_name=excluded.updated_by_name,updated_at=clock_timestamp();
  insert into public.admin_action_log(actor_id,actor_name,action,target_id,details) values(auth.uid(),coalesce(auth.jwt()->>'email',auth.uid()::text),'save_broadcast_playlist',p_period_id,jsonb_build_object('version',next_version,'items',next_items));
  return next_version;
end;
$board$;
revoke all on function public.admin_save_broadcast_playlist(uuid,jsonb,integer) from public;
grant execute on function public.admin_save_broadcast_playlist(uuid,jsonb,integer) to authenticated;


revoke all on function public.admin_create_playlist_period(text, timestamptz, timestamptz) from public;
revoke all on function public.admin_update_song(uuid, text, text, boolean, text) from public;
revoke all on function public.admin_set_song_lock(uuid, boolean, text) from public;
revoke all on function public.admin_review_song_report(uuid, boolean, text) from public;
revoke all on function public.admin_save_broadcast_playlist(uuid, jsonb, integer) from public;
grant execute on function public.admin_create_playlist_period(text, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_update_song(uuid, text, text, boolean, text) to authenticated;
grant execute on function public.admin_set_song_lock(uuid, boolean, text) to authenticated;
grant execute on function public.admin_review_song_report(uuid, boolean, text) to authenticated;
grant execute on function public.admin_save_broadcast_playlist(uuid, jsonb, integer) to authenticated;
commit;
