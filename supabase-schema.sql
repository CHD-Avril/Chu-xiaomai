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
  playlist_date text not null,
  created_at timestamptz not null default now(),
  unique (song_id, user_id, playlist_date)
);

create index if not exists songs_playlist_date_idx on public.songs (playlist_date);
create index if not exists songs_title_lower_idx on public.songs (title_lower);
create index if not exists songs_artist_lower_idx on public.songs (artist_lower);
create index if not exists song_likes_user_playlist_idx on public.song_likes (user_id, playlist_date);

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
  exists (
    select 1
    from public.playlist_periods period
    where period.id::text = public.songs.playlist_date
      and period.status = 'active'
      and now() between period.starts_at and period.ends_at
  )
);

drop policy if exists "songs_update_all" on public.songs;
create policy "songs_update_all"
on public.songs
for update
to anon
using (
  exists (
    select 1
    from public.playlist_periods period
    where period.id::text = public.songs.playlist_date
      and period.status = 'active'
      and now() between period.starts_at and period.ends_at
  )
)
with check (
  exists (
    select 1
    from public.playlist_periods period
    where period.id::text = public.songs.playlist_date
      and period.status = 'active'
      and now() between period.starts_at and period.ends_at
  )
);

drop policy if exists "likes_select_all" on public.song_likes;
create policy "likes_select_all"
on public.song_likes
for select
to anon
using (true);

drop policy if exists "likes_insert_all" on public.song_likes;
create policy "likes_insert_all"
on public.song_likes
for insert
to anon
with check (
  exists (
    select 1
    from public.playlist_periods period
    where period.id::text = public.song_likes.playlist_date
      and period.status = 'active'
      and now() between period.starts_at and period.ends_at
  )
);

drop policy if exists "likes_delete_all" on public.song_likes;
create policy "likes_delete_all"
on public.song_likes
for delete
to anon
using (
  exists (
    select 1
    from public.playlist_periods period
    where period.id::text = public.song_likes.playlist_date
      and period.status = 'active'
      and now() between period.starts_at and period.ends_at
  )
);

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
