create extension if not exists pgcrypto;

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null,
  title_lower text not null,
  artist_lower text not null,
  playlist_date text not null,
  likes_count integer not null default 0,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.song_likes (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs(id) on delete cascade,
  user_id text not null,
  voter_cookie text,
  voter_ip text,
  playlist_date text not null,
  created_at timestamptz not null default now(),
  unique (song_id, user_id, playlist_date)
);

create index if not exists songs_playlist_date_idx on public.songs (playlist_date);
create index if not exists songs_title_lower_idx on public.songs (title_lower);
create index if not exists songs_artist_lower_idx on public.songs (artist_lower);
create index if not exists song_likes_user_playlist_idx on public.song_likes (user_id, playlist_date);
create index if not exists song_likes_cookie_playlist_idx on public.song_likes (voter_cookie, playlist_date);
create unique index if not exists song_likes_song_cookie_unique
on public.song_likes (song_id, playlist_date, voter_cookie)
where voter_cookie is not null;
create unique index if not exists song_likes_song_ip_unique
on public.song_likes (song_id, playlist_date, voter_ip)
where voter_ip is not null;

create table if not exists public.playlist_periods (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (ends_at > starts_at)
);

create index if not exists playlist_periods_status_idx on public.playlist_periods (status);
create index if not exists playlist_periods_created_at_idx on public.playlist_periods (created_at desc);
create index if not exists playlist_periods_starts_at_idx on public.playlist_periods (starts_at);

alter table public.songs enable row level security;
alter table public.song_likes enable row level security;
alter table public.playlist_periods enable row level security;

drop policy if exists "songs_select_all" on public.songs;
create policy "songs_select_all"
on public.songs
for select
to anon
using (true);

drop policy if exists "songs_insert_all" on public.songs;
create policy "songs_insert_all"
on public.songs
for insert
to anon
with check (
  public.songs.likes_count = 0
  and
  exists (
    select 1
    from public.playlist_periods period
    where period.id::text = public.songs.playlist_date
      and period.status = 'active'
      and now() between period.starts_at and period.ends_at
  )
);

drop policy if exists "songs_update_all" on public.songs;
drop policy if exists "songs_update_policy" on public.songs;
create policy "songs_update_block_direct_votes"
on public.songs
for update
to anon
using (false)
with check (false);

drop policy if exists "likes_select_all" on public.song_likes;
create policy "likes_select_all"
on public.song_likes
for select
to anon
using (true);

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

drop policy if exists "playlist_periods_select_all" on public.playlist_periods;
create policy "playlist_periods_select_all"
on public.playlist_periods
for select
to anon
using (true);

drop policy if exists "playlist_periods_insert_all" on public.playlist_periods;
create policy "playlist_periods_insert_all"
on public.playlist_periods
for insert
to anon
with check (true);

drop policy if exists "playlist_periods_update_all" on public.playlist_periods;
create policy "playlist_periods_update_all"
on public.playlist_periods
for update
to anon
using (true)
with check (true);

-- 公告表
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  is_active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists announcements_is_active_idx on public.announcements (is_active);
create index if not exists announcements_created_at_idx on public.announcements (created_at desc);

alter table public.announcements enable row level security;

drop policy if exists "announcements_select_all" on public.announcements;
create policy "announcements_select_all"
on public.announcements
for select
to anon
using (true);

drop policy if exists "announcements_insert_all" on public.announcements;
create policy "announcements_insert_all"
on public.announcements
for insert
to anon
with check (true);

drop policy if exists "announcements_update_all" on public.announcements;
create policy "announcements_update_all"
on public.announcements
for update
to anon
using (true)
with check (true);
