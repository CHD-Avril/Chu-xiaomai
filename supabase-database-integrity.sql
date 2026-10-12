-- Database integrity migration. Run after supabase-schema.sql and supabase-admin-workflow.sql.
-- One transaction: preflight failures roll back all changes; originals of merged rows are archived.
begin;
lock table public.playlist_periods, public.songs, public.song_likes, public.song_dislikes, public.song_reports, public.vote_attempts in share row exclusive mode;
do $preflight$
declare tbl text; bad text;
begin
  if to_regclass('public.broadcast_playlists') is null then raise exception '请先执行 supabase-admin-workflow.sql。'; end if;
  if (select count(*) from public.playlist_periods where status='active')>1 then
    raise exception '检测到多个 active 征集期，请明确保留哪一期，归档其他期后重试；迁移不会自行关闭征集。';
  end if;
  foreach tbl in array array['songs','song_likes','song_dislikes','song_reports','vote_attempts'] loop
    execute format('select r.id::text from public.%I r left join public.playlist_periods p on p.id::text=r.playlist_date where p.id is null limit 1',tbl) into bad;
    if bad is not null then raise exception '孤立或非 UUID 征集期关联：表 %，记录 %。请先恢复其征集期或人工映射，迁移未提交。',tbl,bad; end if;
  end loop;
  foreach tbl in array array['song_likes','song_dislikes','song_reports'] loop
    execute format('select v.id::text from public.%I v join public.songs s on s.id=v.song_id where v.playlist_date<>s.playlist_date limit 1',tbl) into bad;
    if bad is not null then raise exception '歌曲与征集期错配：表 %，记录 %。请核实后修复，迁移未提交。',tbl,bad; end if;
  end loop;
  select id::text into bad from public.songs where length(trim(title)) not between 1 and 80 or length(trim(artist)) not between 1 and 80 limit 1;
  if bad is not null then raise exception '存在超过 80 字或空名称的歌曲 %。请先人工核实名称，迁移不会截断。',bad; end if;
end;
$preflight$;

-- Shared safe legacy merge; also embedded in supabase-schema.sql.
create table if not exists public.database_repair_archive (
  id uuid primary key default gen_random_uuid(),
  source_table text not null, source_id text not null, reason text not null,
  row_data jsonb not null, row_hash text not null, recorded_at timestamptz not null default now(),
  unique(source_table, source_id, reason, row_hash)
);
alter table public.database_repair_archive enable row level security;
revoke all on public.database_repair_archive from public, anon, authenticated;
grant select on public.database_repair_archive to authenticated;
drop policy if exists repair_archive_admin_read on public.database_repair_archive;
create policy repair_archive_admin_read on public.database_repair_archive for select to authenticated using(public.is_current_user_admin());

create or replace function public.repair_duplicate_songs()
returns void language plpgsql security definer set search_path = public as $repair$
declare source_name text;
begin
  lock table public.songs, public.song_likes, public.song_dislikes, public.song_reports in share row exclusive mode;
  drop table if exists pg_temp.song_merge_map;
  create temp table song_merge_map on commit drop as
    select id, first_value(id) over(partition by playlist_date,title_lower,artist_lower order by created_at,id) keeper
    from public.songs;
  delete from pg_temp.song_merge_map where id=keeper;
  if not exists(select 1 from pg_temp.song_merge_map) then return; end if;
  -- Save both duplicates and keepers, all votes and all reports before any transformation.
  insert into public.database_repair_archive(source_table,source_id,reason,row_data,row_hash)
    select 'songs',s.id::text,'duplicate_merge',to_jsonb(s),md5(to_jsonb(s)::text) from public.songs s
    where s.id in(select id from pg_temp.song_merge_map union select keeper from pg_temp.song_merge_map)
    on conflict do nothing;
  foreach source_name in array array['song_likes','song_dislikes','song_reports'] loop
    execute format('insert into public.database_repair_archive(source_table,source_id,reason,row_data,row_hash)
      select %L,v.id::text,''duplicate_merge'',to_jsonb(v),md5(to_jsonb(v)::text) from public.%I v
      where v.song_id in(select id from pg_temp.song_merge_map union select keeper from pg_temp.song_merge_map)
      on conflict do nothing',source_name,source_name);
  end loop;
  -- For votes on the merged song, the latest sentiment per browser wins.
  drop table if exists pg_temp.merged_vote_rank;
  create temp table merged_vote_rank on commit drop as
    select *,row_number() over(partition by target,identity order by created_at desc,id desc,kind) rank from (
      select l.id,coalesce(m.keeper,l.song_id) target,coalesce(l.voter_cookie,l.user_id) identity,l.created_at,'like' kind
        from public.song_likes l left join pg_temp.song_merge_map m on m.id=l.song_id
        where l.song_id in(select id from pg_temp.song_merge_map union select keeper from pg_temp.song_merge_map)
      union all
      select d.id,coalesce(m.keeper,d.song_id),coalesce(d.voter_cookie,d.user_id),d.created_at,'dislike'
        from public.song_dislikes d left join pg_temp.song_merge_map m on m.id=d.song_id
        where d.song_id in(select id from pg_temp.song_merge_map union select keeper from pg_temp.song_merge_map)
    ) votes;
  delete from public.song_likes v using pg_temp.merged_vote_rank r where r.kind='like' and r.rank>1 and v.id=r.id;
  delete from public.song_dislikes v using pg_temp.merged_vote_rank r where r.kind='dislike' and r.rank>1 and v.id=r.id;
  -- Historic user_id may differ from cookie. Retain newest row compatible with both old unique keys.
  foreach source_name in array array['song_likes','song_dislikes'] loop
    execute format('delete from public.%I where id in (
      select id from(select v.id,row_number() over(partition by coalesce(m.keeper,v.song_id),v.user_id order by v.created_at desc,v.id desc) rank
      from public.%I v left join pg_temp.song_merge_map m on m.id=v.song_id
      where v.song_id in(select id from pg_temp.song_merge_map union select keeper from pg_temp.song_merge_map)) r where rank>1)',source_name,source_name);
    execute format('update public.%I v set song_id=m.keeper from pg_temp.song_merge_map m where v.song_id=m.id',source_name);
  end loop;
  -- Duplicate pending reports are archived in full; retain newest active queue item. Reviewed history is all kept.
  delete from public.song_reports where id in (
    select id from(select r.id,row_number() over(partition by coalesce(m.keeper,r.song_id),r.reporter_cookie order by r.created_at desc,r.id desc) rank
      from public.song_reports r left join pg_temp.song_merge_map m on m.id=r.song_id where r.status='pending'
      and r.song_id in(select id from pg_temp.song_merge_map union select keeper from pg_temp.song_merge_map)) ranked where rank>1);
  update public.song_reports r set song_id=m.keeper from pg_temp.song_merge_map m where r.song_id=m.id;
  -- Preserve a previous moderation lock if any duplicate had been locked.
  update public.songs s set is_locked=true,locked_at=coalesce(s.locked_at,now())
    where s.id in(select m.keeper from pg_temp.song_merge_map m join public.songs d on d.id=m.id where d.is_locked);
  if to_regclass('public.broadcast_playlists') is not null then
    execute 'insert into public.database_repair_archive(source_table,source_id,reason,row_data,row_hash)
      select ''broadcast_playlists'',b.period_id::text,''duplicate_merge'',to_jsonb(b),md5(to_jsonb(b)::text) from public.broadcast_playlists b
      where exists(select 1 from jsonb_array_elements(b.items) item join pg_temp.song_merge_map m on m.id::text=item->>''song_id'')
      on conflict do nothing';
    execute 'update public.broadcast_playlists b set items=(
      select coalesce(jsonb_agg(item || jsonb_build_object(''song_id'',target) order by ord),''[]''::jsonb) from (
        select distinct on(target) item,target,ord from (
          select item,coalesce(m.keeper::text,item->>''song_id'') target,ord from jsonb_array_elements(b.items) with ordinality a(item,ord)
          left join pg_temp.song_merge_map m on m.id::text=item->>''song_id''
        ) mapped order by target,(item->>''status''=''confirmed'') desc,ord
      ) chosen),version=version+1,updated_at=clock_timestamp() where exists(select 1 from jsonb_array_elements(b.items) item join pg_temp.song_merge_map m on m.id::text=item->>''song_id'')';
  end if;
  delete from public.songs s using pg_temp.song_merge_map m where s.id=m.id;
  update public.songs s set
    likes_count=(select count(*)::integer from public.song_likes l where l.song_id=s.id),
    dislikes_count=(select count(*)::integer from public.song_dislikes d where d.song_id=s.id)
    where s.id in(select keeper from pg_temp.song_merge_map);
end;
$repair$;
revoke all on function public.repair_duplicate_songs() from public,anon,authenticated;
select public.repair_duplicate_songs();


-- Archive and reconcile historic sentiment conflicts in one statement.
-- Do not depend on a session-scoped temporary relation between SQL Editor statements.
with historical_vote_conflicts as materialized (
  select *,row_number() over(partition by song_id,identity order by created_at desc,id desc,kind) rank,
    count(*) over(partition by song_id,identity) copies from (
    select id,song_id,coalesce(voter_cookie,user_id) identity,created_at,'song_likes' kind from public.song_likes
    union all select id,song_id,coalesce(voter_cookie,user_id),created_at,'song_dislikes' from public.song_dislikes
  ) votes
), archived_conflicts as (
  insert into public.database_repair_archive(source_table,source_id,reason,row_data,row_hash)
  select c.kind,c.id::text,'sentiment_conflict',to_jsonb(v),md5(to_jsonb(v)::text) from public.song_likes v join historical_vote_conflicts c on c.kind='song_likes' and c.id=v.id where c.copies>1
  union all
  select c.kind,c.id::text,'sentiment_conflict',to_jsonb(v),md5(to_jsonb(v)::text) from public.song_dislikes v join historical_vote_conflicts c on c.kind='song_dislikes' and c.id=v.id where c.copies>1
  on conflict do nothing returning id
), removed_likes as (
  delete from public.song_likes v using historical_vote_conflicts c where c.kind='song_likes' and c.rank>1 and c.id=v.id returning v.id
), removed_dislikes as (
  delete from public.song_dislikes v using historical_vote_conflicts c where c.kind='song_dislikes' and c.rank>1 and c.id=v.id returning v.id
)
select count(*) as archived_vote_conflicts from archived_conflicts;
update public.songs s set likes_count=(select count(*)::int from public.song_likes l where l.song_id=s.id),
  dislikes_count=(select count(*)::int from public.song_dislikes d where d.song_id=s.id);

-- UUID ownership, retaining playlist_date only as a checked compatibility alias for older clients.
create or replace function public.sync_period_reference()
returns trigger language plpgsql set search_path=public as $sync$
begin
  if tg_op='UPDATE' then
    if new.playlist_date is distinct from old.playlist_date and new.period_id is not distinct from old.period_id then new.period_id=null; end if;
    if new.period_id is distinct from old.period_id and new.playlist_date is not distinct from old.playlist_date then new.playlist_date=null; end if;
  end if;
  if new.period_id is null then
    select id into new.period_id from public.playlist_periods where id::text=new.playlist_date;
  end if;
  if new.period_id is null then raise exception '征集期不存在或关联无效。'; end if;
  if new.playlist_date is null then new.playlist_date=new.period_id::text; end if;
  if new.playlist_date<>new.period_id::text then raise exception 'period_id 与 playlist_date 不一致。'; end if;
  return new;
end;
$sync$;
revoke all on function public.sync_period_reference() from public,anon,authenticated;
do $refs$
declare tbl text; constraint_record record;
begin
  foreach tbl in array array['songs','song_likes','song_dislikes','song_reports','vote_attempts'] loop
    execute format('alter table public.%I add column if not exists period_id uuid',tbl);
    execute format('update public.%I r set period_id=p.id from public.playlist_periods p where p.id::text=r.playlist_date and r.period_id is null',tbl);
    execute format('alter table public.%I alter column period_id set not null',tbl);
    if not exists(select 1 from pg_constraint where conname=tbl||'_period_fk' and conrelid=('public.'||tbl)::regclass) then
      execute format('alter table public.%I add constraint %I foreign key(period_id) references public.playlist_periods(id) on delete restrict',tbl,tbl||'_period_fk');
    end if;
    execute format('create index if not exists %I on public.%I(period_id)',tbl||'_period_id_idx',tbl);
    execute format('drop trigger if exists a_sync_period on public.%I',tbl);
    execute format('create trigger a_sync_period before insert or update of period_id,playlist_date on public.%I for each row execute function public.sync_period_reference()',tbl);
  end loop;
  if not exists(select 1 from pg_constraint where conname='songs_id_period_unique' and conrelid='public.songs'::regclass) then
    alter table public.songs add constraint songs_id_period_unique unique(id,period_id);
  end if;
  foreach tbl in array array['song_likes','song_dislikes','song_reports'] loop
    -- Remove old cascading FKs; otherwise their DELETE trigger could erase rows before RESTRICT runs.
    for constraint_record in select conname from pg_constraint where conrelid=('public.'||tbl)::regclass and contype='f' and confrelid='public.songs'::regclass and confdeltype='c' loop
      execute format('alter table public.%I drop constraint %I',tbl,constraint_record.conname);
    end loop;
    if not exists(select 1 from pg_constraint where conname=tbl||'_song_period_fk' and conrelid=('public.'||tbl)::regclass) then
      execute format('alter table public.%I add constraint %I foreign key(song_id,period_id) references public.songs(id,period_id) on delete restrict',tbl,tbl||'_song_period_fk');
    end if;
  end loop;
end;
$refs$;
do $board_fk$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid='public.broadcast_playlists'::regclass and contype='f' and confrelid='public.playlist_periods'::regclass and confdeltype='c' loop
    execute format('alter table public.broadcast_playlists drop constraint %I',c.conname);
  end loop;
  if not exists(select 1 from pg_constraint where conname='broadcast_playlists_period_restrict' and conrelid='public.broadcast_playlists'::regclass) then
    alter table public.broadcast_playlists add constraint broadcast_playlists_period_restrict foreign key(period_id) references public.playlist_periods(id) on delete restrict;
  end if;
end;
$board_fk$;
alter table public.songs validate constraint songs_title_length_check;
alter table public.songs validate constraint songs_artist_length_check;
alter table public.songs validate constraint songs_likes_count_nonnegative;
alter table public.songs validate constraint songs_dislikes_count_nonnegative;
create unique index if not exists playlist_periods_one_active on public.playlist_periods(status) where status='active';
create index if not exists songs_submitter_period_idx on public.songs(period_id,created_by);
create index if not exists song_likes_identity_period_idx on public.song_likes(voter_cookie,period_id);
create index if not exists song_dislikes_identity_period_idx on public.song_dislikes(voter_cookie,period_id);
create unique index if not exists song_dislikes_song_cookie_unique on public.song_dislikes(song_id,period_id,voter_cookie) where voter_cookie is not null;
grant select(period_id) on public.songs to anon,authenticated;
revoke insert,update,delete on public.playlist_periods from authenticated;
-- Database functions continue to invoke this internal implementation as its owner.
revoke all on function public.review_song_report(uuid,boolean) from public,anon,authenticated;

-- Failed validation is a normal RPC result so its request record commits.
-- Raw requested_period deliberately has no FK: even an invalid period must count as a request.
create table if not exists public.api_request_attempts(
  id bigint generated always as identity primary key,
  attempt_type text not null check(attempt_type in('vote','submission')),
  cookie_hash text not null, client_ip text, requested_period text,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.api_request_attempts enable row level security;
revoke all on public.api_request_attempts from public,anon,authenticated;
create index if not exists api_attempt_cookie_time on public.api_request_attempts(attempt_type,cookie_hash,created_at desc);
create index if not exists api_attempt_ip_time on public.api_request_attempts(attempt_type,client_ip,created_at desc);
create index if not exists api_attempt_expiry on public.api_request_attempts(created_at);
create or replace function public.consume_api_attempt(p_type text,p_period text,p_cookie text)
returns void language plpgsql security definer set search_path=public as $rate$
declare cfg public.security_settings%rowtype; cookie_key text=md5(coalesce(left(btrim(p_cookie),128),'')); ip text; lock_key bigint; cookie_limit int; ip_limit int;
begin
  select * into strict cfg from public.security_settings where id=true;
  ip=public.request_client_ip();
  -- All RPCs use rate keys (sorted) -> actor/period -> period -> song -> report.
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
create or replace function public.purge_expired_request_attempts()
returns bigint language plpgsql security definer set search_path=public as $purge$
declare removed bigint;
begin
  delete from public.api_request_attempts where created_at<clock_timestamp()-interval '7 days'; get diagnostics removed=row_count;
  delete from public.vote_attempts where created_at<clock_timestamp()-interval '7 days';
  return removed;
end;
$purge$;
revoke all on function public.purge_expired_request_attempts() from public,anon,authenticated;

-- Request and vote RPCs are replaced below. Existing public argument names remain compatible.
create or replace function public.apply_song_vote(p_song_id uuid,p_period text,p_cookie text,p_action text,p_reason text)
returns table(liked boolean,disliked boolean,likes_count integer,dislikes_count integer)
language plpgsql security definer set search_path=public as $vote$
declare identity text; target uuid; period_record public.playlist_periods%rowtype; song_record public.songs%rowtype; maximum int; already boolean;
begin
  identity=public.assert_valid_voter_cookie(p_cookie);
  begin target=p_period::uuid; exception when invalid_text_representation then raise exception '征集期无效，请刷新页面。'; end;
  if target is null then raise exception '征集期无效，请刷新页面。'; end if;
  if p_action is null or p_action not in('like','unlike','dislike','undislike') then raise exception 'Unknown voting action.'; end if;
  if p_action='dislike' and length(trim(coalesce(p_reason,''))) not between 1 and 20 then raise exception '点踩理由须为 1–20 字。'; end if;
  perform pg_advisory_xact_lock(hashtextextended('actor:'||target::text||':'||identity,0));
  select * into period_record from public.playlist_periods where id=target for share;
  if not found or period_record.status<>'active' or clock_timestamp() not between period_record.starts_at and period_record.ends_at then
    raise exception '征集已结束或尚未开始，请刷新页面。';
  end if;
  select * into song_record from public.songs where id=p_song_id and period_id=target for update;
  if not found or song_record.is_locked then raise exception '歌曲已锁定或不存在，请刷新页面。'; end if;
  if p_action='like' then
    select exists(select 1 from public.song_likes l where l.song_id=p_song_id and l.voter_cookie=identity) into already;
    if not already then
      select max_likes_per_period into maximum from public.security_settings where id=true;
      if (select count(*) from public.song_likes l where l.period_id=target and l.voter_cookie=identity)>=maximum then
        raise exception '本浏览器已达到本期喜欢数量上限。';
      end if;
      delete from public.song_dislikes d where d.song_id=p_song_id and d.voter_cookie=identity;
      insert into public.song_likes(song_id,user_id,voter_cookie,voter_ip,playlist_date,period_id)
        values(p_song_id,identity,identity,public.request_client_ip(),target::text,target);
    end if;
  elsif p_action='unlike' then
    delete from public.song_likes l where l.song_id=p_song_id and l.voter_cookie=identity;
  elsif p_action='dislike' then
    select exists(select 1 from public.song_dislikes d where d.song_id=p_song_id and d.voter_cookie=identity) into already;
    if not already then
      delete from public.song_likes l where l.song_id=p_song_id and l.voter_cookie=identity;
      insert into public.song_dislikes(song_id,user_id,voter_cookie,voter_ip,playlist_date,period_id)
        values(p_song_id,identity,identity,public.request_client_ip(),target::text,target);
      insert into public.song_reports(song_id,playlist_date,period_id,reporter_cookie,reporter_ip,reason)
        values(p_song_id,target::text,target,identity,public.request_client_ip(),trim(p_reason))
        on conflict(song_id,reporter_cookie) where status='pending' do update set reason=excluded.reason;
    end if;
  else
    delete from public.song_dislikes d where d.song_id=p_song_id and d.voter_cookie=identity;
  end if;
  -- The song row was locked before reading/modifying either vote table.
  update public.songs s set likes_count=(select count(*)::int from public.song_likes l where l.song_id=p_song_id),
    dislikes_count=(select count(*)::int from public.song_dislikes d where d.song_id=p_song_id) where s.id=p_song_id;
  return query select exists(select 1 from public.song_likes l where l.song_id=p_song_id and l.voter_cookie=identity),
    exists(select 1 from public.song_dislikes d where d.song_id=p_song_id and d.voter_cookie=identity),s.likes_count,s.dislikes_count
    from public.songs s where s.id=p_song_id;
end;
$vote$;
revoke all on function public.apply_song_vote(uuid,text,text,text,text) from public,anon,authenticated;
drop function if exists public.toggle_song_like(uuid,text,text,text);
create function public.toggle_song_like(p_song_id uuid,p_playlist_date text,p_voter_cookie text,p_action text)
returns table(liked boolean,likes_count integer,error_code text,error_message text)
language plpgsql security definer set search_path=public as $like$
begin
  perform public.consume_api_attempt('vote',p_playlist_date,p_voter_cookie);
  begin
    if p_action is null or p_action not in('like','unlike') then raise exception 'Unknown voting action.'; end if;
    return query select r.liked,r.likes_count,null::text,null::text from public.apply_song_vote(p_song_id,p_playlist_date,p_voter_cookie,p_action,null) r;
  exception when others then
    -- Only this subtransaction is rolled back; consume_api_attempt remains committed.
    return query select false,0,sqlstate,case when sqlstate in('P0001','23505','23503','23514','22P02') then sqlerrm else '操作失败，请稍后重试。' end;
  end;
end;
$like$;
drop function if exists public.toggle_song_dislike(uuid,text,text,text);
drop function if exists public.toggle_song_dislike(uuid,text,text,text,text);
create function public.toggle_song_dislike(p_song_id uuid,p_playlist_date text,p_voter_cookie text,p_action text,p_reason text default null)
returns table(disliked boolean,dislikes_count integer,error_code text,error_message text)
language plpgsql security definer set search_path=public as $dislike$
begin
  perform public.consume_api_attempt('vote',p_playlist_date,p_voter_cookie);
  begin
    if p_action is null or p_action not in('dislike','undislike') then raise exception 'Unknown voting action.'; end if;
    return query select r.disliked,r.dislikes_count,null::text,null::text from public.apply_song_vote(p_song_id,p_playlist_date,p_voter_cookie,p_action,p_reason) r;
  exception when others then
    return query select false,0,sqlstate,case when sqlstate in('P0001','23505','23503','23514','22P02') then sqlerrm else '操作失败，请稍后重试。' end;
  end;
end;
$dislike$;

drop function if exists public.submit_song(text,text,text,text);
create function public.submit_song(p_title text,p_artist text,p_playlist_date text,p_voter_cookie text)
returns table(id uuid,title text,artist text,playlist_date text,likes_count integer,created_at timestamptz,error_code text,error_message text)
language plpgsql security definer set search_path=public as $submit$
declare identity text; target uuid; period_record public.playlist_periods%rowtype; maximum int;
begin
  perform public.consume_api_attempt('submission',p_playlist_date,p_voter_cookie);
  begin
    identity=public.assert_valid_voter_cookie(p_voter_cookie);
    if length(trim(coalesce(p_title,''))) not between 1 and 80 or length(trim(coalesce(p_artist,''))) not between 1 and 80 then
      raise exception '歌名和歌手须为 1–80 字。';
    end if;
    begin target=p_playlist_date::uuid; exception when invalid_text_representation then raise exception '征集期无效，请刷新页面。'; end;
    if target is null then raise exception '征集期无效，请刷新页面。'; end if;
    perform pg_advisory_xact_lock(hashtextextended('actor:'||target::text||':'||identity,0));
    select * into period_record from public.playlist_periods where public.playlist_periods.id=target for share;
    if not found or period_record.status<>'active' or clock_timestamp() not between period_record.starts_at and period_record.ends_at then
      raise exception '征集已结束或尚未开始，请刷新页面。';
    end if;
    select submission_cookie_per_period into maximum from public.security_settings where public.security_settings.id=true;
    if (select count(*) from public.songs s where s.period_id=target and s.created_by='cookie:'||md5(identity))>=maximum then
      raise exception '本浏览器已达到本期投稿数量上限。';
    end if;
    return query insert into public.songs as s(title,artist,title_lower,artist_lower,playlist_date,period_id,created_by)
      values(trim(p_title),trim(p_artist),lower(trim(p_title)),lower(trim(p_artist)),target::text,target,'cookie:'||md5(identity))
      returning s.id,s.title,s.artist,s.playlist_date,s.likes_count,s.created_at,null::text,null::text;
  exception when unique_violation then
    return query select null::uuid,null::text,null::text,null::text,0,null::timestamptz,'23505'::text,'本期已有同名、同歌手的歌曲。'::text;
  when others then
    return query select null::uuid,null::text,null::text,null::text,0,null::timestamptz,sqlstate,
      case when sqlstate in('P0001','23503','23514','22P02') then sqlerrm else '投稿失败，请稍后重试。' end;
  end;
end;
$submit$;
revoke all on function public.toggle_song_like(uuid,text,text,text) from public;
revoke all on function public.toggle_song_dislike(uuid,text,text,text,text) from public;
revoke all on function public.submit_song(text,text,text,text) from public;
grant execute on function public.toggle_song_like(uuid,text,text,text) to anon,authenticated;
grant execute on function public.toggle_song_dislike(uuid,text,text,text,text) to anon,authenticated;
grant execute on function public.submit_song(text,text,text,text) to anon,authenticated;

-- Internal moderation implementation follows the same song -> report lock order as voting.
create or replace function public.review_song_report(p_report_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path=public as $review$
declare report_record public.song_reports%rowtype; target uuid;
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  select song_id into target from public.song_reports where public.song_reports.id=p_report_id;
  if target is null then raise exception 'Pending report not found.'; end if;
  perform 1 from public.songs where public.songs.id=target for update;
  select * into report_record from public.song_reports where public.song_reports.id=p_report_id and status='pending' for update;
  if not found then raise exception 'Pending report not found.'; end if;
  update public.song_reports set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=auth.uid()::text,reviewed_at=clock_timestamp() where public.song_reports.id=p_report_id;
  if p_approve then update public.songs set is_locked=true,locked_at=clock_timestamp(),locked_by=auth.uid()::text where public.songs.id=target; end if;
end;
$review$;
revoke all on function public.review_song_report(uuid,boolean) from public,anon,authenticated;



-- Keep table-level mutual exclusion even for future trusted import scripts.
create or replace function public.guard_vote_sentiment()
returns trigger language plpgsql security definer set search_path=public as $guard$
declare opposite text; found_opposite boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('actor:'||new.period_id::text||':'||coalesce(new.voter_cookie,new.user_id),0));
  perform 1 from public.songs where id=new.song_id for update;
  opposite=case when tg_table_name='song_likes' then 'song_dislikes' else 'song_likes' end;
  execute format('select exists(select 1 from public.%I where song_id=$1 and coalesce(voter_cookie,user_id)=$2)',opposite)
    into found_opposite using new.song_id,coalesce(new.voter_cookie,new.user_id);
  if found_opposite then raise exception '同一访客不能同时喜欢和点踩同一首歌。'; end if;
  return new;
end;
$guard$;
revoke all on function public.guard_vote_sentiment() from public,anon,authenticated;
drop trigger if exists b_guard_sentiment on public.song_likes;
create trigger b_guard_sentiment before insert or update on public.song_likes for each row execute function public.guard_vote_sentiment();
drop trigger if exists b_guard_sentiment on public.song_dislikes;
create trigger b_guard_sentiment before insert or update on public.song_dislikes for each row execute function public.guard_vote_sentiment();

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

-- Existing confirmed lists get a one-time upgrade-time snapshot, not an invented past confirmation.
do $snapshot_preflight$
declare bad uuid;
begin
  select b.period_id into bad from public.broadcast_playlists b where exists(
    select 1 from jsonb_array_elements(b.items) i left join public.songs s on s.id::text=i->>'song_id'
    where s.id is null or s.period_id<>b.period_id or i->>'status' is null or i->>'status' not in('candidate','confirmed')) limit 1;
  if bad is not null then raise exception '播出歌单 % 含失效或错期条目，请先人工核实。',bad; end if;
end;
$snapshot_preflight$;
insert into public.database_repair_archive(source_table,source_id,reason,row_data,row_hash)
  select 'broadcast_playlists',b.period_id::text,'snapshot_upgrade',to_jsonb(b),md5(to_jsonb(b)::text) from public.broadcast_playlists b
  where exists(select 1 from jsonb_array_elements(b.items) i where i->>'status'='confirmed' and (i->'snapshot' is null or i->'snapshot'='null'::jsonb))
  on conflict do nothing;
update public.broadcast_playlists b set items=(
  select jsonb_agg(case when i->>'status'='confirmed' and (i->'snapshot' is null or i->'snapshot'='null'::jsonb)
    then i||jsonb_build_object('snapshot',jsonb_build_object('title',s.title,'artist',s.artist,'likes_count',s.likes_count,'captured_at',clock_timestamp(),'source','migration'))
    else i end order by ord) from jsonb_array_elements(b.items) with ordinality a(i,ord) join public.songs s on s.id::text=i->>'song_id'),
  version=version+1,updated_at=clock_timestamp()
  where exists(select 1 from jsonb_array_elements(b.items) i where i->>'status'='confirmed' and (i->'snapshot' is null or i->'snapshot'='null'::jsonb));


notify pgrst,'reload schema';
commit;
