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

alter table public.songs enable row level security;
alter table public.song_likes enable row level security;

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
with check (true);

drop policy if exists "songs_update_all" on public.songs;
create policy "songs_update_all"
on public.songs
for update
to anon
using (true)
with check (true);

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
with check (true);

drop policy if exists "likes_delete_all" on public.song_likes;
create policy "likes_delete_all"
on public.song_likes
for delete
to anon
using (true);
