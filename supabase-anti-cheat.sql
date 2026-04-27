-- Anti-cheat voting guard for Chu Xiaomai.
-- Run this in the Supabase SQL editor after the base schema.

alter table public.song_likes
  add column if not exists voter_cookie text,
  add column if not exists voter_ip text;

update public.song_likes
set voter_cookie = coalesce(voter_cookie, user_id)
where voter_cookie is null;

create index if not exists song_likes_cookie_playlist_idx
on public.song_likes (voter_cookie, playlist_date);

create unique index if not exists song_likes_song_cookie_unique
on public.song_likes (song_id, playlist_date, voter_cookie)
where voter_cookie is not null;

create unique index if not exists song_likes_song_ip_unique
on public.song_likes (song_id, playlist_date, voter_ip)
where voter_ip is not null;

drop policy if exists "songs_insert_all" on public.songs;
create policy "songs_insert_all"
on public.songs
for insert
to anon
with check (
  public.songs.likes_count = 0
  and exists (
    select 1
    from public.playlist_periods period
    where period.id::text = public.songs.playlist_date
      and period.status = 'active'
      and now() between period.starts_at and period.ends_at
  )
);

create or replace function public.request_client_ip()
returns text
language plpgsql
stable
as $$
declare
  headers jsonb := '{}'::jsonb;
  header_text text;
  raw_ip text;
begin
  header_text := current_setting('request.headers', true);

  if header_text is not null and header_text <> '' then
    begin
      headers := header_text::jsonb;
    exception when others then
      headers := '{}'::jsonb;
    end;
  end if;

  raw_ip := coalesce(
    headers ->> 'cf-connecting-ip',
    headers ->> 'x-real-ip',
    split_part(headers ->> 'x-forwarded-for', ',', 1)
  );

  raw_ip := nullif(btrim(raw_ip), '');
  if raw_ip is null then
    return null;
  end if;

  return left(raw_ip, 128);
end;
$$;

create or replace function public.toggle_song_like(
  p_song_id uuid,
  p_playlist_date text,
  p_voter_cookie text,
  p_action text
)
returns table (liked boolean, likes_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  client_ip text;
  next_likes_count integer;
begin
  if p_voter_cookie is null
    or length(p_voter_cookie) < 8
    or length(p_voter_cookie) > 128
    or p_voter_cookie !~ '^[A-Za-z0-9_-]+$'
  then
    raise exception '浏览器必须提供有效 Cookie 后才能投票。';
  end if;

  client_ip := public.request_client_ip();
  if client_ip is null then
    raise exception '无法识别客户端 IP，暂时不能投票。';
  end if;

  if not exists (
    select 1
    from public.songs song
    join public.playlist_periods period on period.id::text = song.playlist_date
    where song.id = p_song_id
      and song.playlist_date = p_playlist_date
      and period.status = 'active'
      and now() between period.starts_at and period.ends_at
  ) then
    raise exception '当前歌曲不在开放投票期内。';
  end if;

  if p_action = 'like' then
    if exists (
      select 1
      from public.song_likes
      where song_id = p_song_id
        and playlist_date = p_playlist_date
        and (voter_cookie = p_voter_cookie or voter_ip = client_ip)
    ) then
      raise exception '这个浏览器或网络已经给这首歌投过票了。';
    end if;

    insert into public.song_likes (song_id, user_id, playlist_date, voter_cookie, voter_ip)
    values (p_song_id, p_voter_cookie, p_playlist_date, p_voter_cookie, client_ip);
  elsif p_action = 'unlike' then
    delete from public.song_likes
    where song_id = p_song_id
      and playlist_date = p_playlist_date
      and voter_cookie = p_voter_cookie;
  else
    raise exception '未知的投票操作。';
  end if;

  update public.songs
  set likes_count = (
    select count(*)::integer
    from public.song_likes
    where song_id = p_song_id
      and playlist_date = p_playlist_date
  )
  where id = p_song_id
  returning public.songs.likes_count into next_likes_count;

  return query select p_action = 'like', coalesce(next_likes_count, 0);
end;
$$;

grant execute on function public.toggle_song_like(uuid, text, text, text) to anon;

drop policy if exists "songs_update_all" on public.songs;
drop policy if exists "songs_update_policy" on public.songs;
create policy "songs_update_block_direct_votes"
on public.songs
for update
to anon
using (false)
with check (false);

drop policy if exists "likes_insert_all" on public.song_likes;
drop policy if exists "likes_insert_policy" on public.song_likes;
create policy "likes_insert_block_direct_votes"
on public.song_likes
for insert
to anon
with check (false);

drop policy if exists "likes_delete_all" on public.song_likes;
drop policy if exists "likes_delete_policy" on public.song_likes;
create policy "likes_delete_block_direct_votes"
on public.song_likes
for delete
to anon
using (false);
