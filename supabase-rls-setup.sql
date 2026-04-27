-- =========================================
-- 行级安全策略 (RLS) 配置脚本
-- 使用 anon key (可发布密钥) 访问
-- =========================================

-- =========================================
-- 0. 先创建所有必需的表
-- =========================================

-- 创建 songs 表（如果不存在）
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

-- 创建 song_likes 表（如果不存在）
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

-- 创建 announcements 表（如果不存在）
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  is_active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 创建索引
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
create index if not exists announcements_is_active_idx on public.announcements (is_active);
create index if not exists announcements_created_at_idx on public.announcements (created_at desc);


-- =========================================
-- 1. songs 表（歌曲表）的 RLS 策略
-- =========================================

-- 启用行级安全
alter table public.songs enable row level security;

-- 策略 1: 允许所有人读取歌曲
drop policy if exists "songs_select_policy" on public.songs;
create policy "songs_select_policy"
on public.songs
for select
to anon
using (true);

-- 策略 2: 允许所有人插入歌曲
drop policy if exists "songs_insert_policy" on public.songs;
create policy "songs_insert_policy"
on public.songs
for insert
to anon
with check (true);

-- 策略 3: 允许所有人更新歌曲（用于更新点赞数）
drop policy if exists "songs_update_policy" on public.songs;
drop policy if exists "songs_update_all" on public.songs;
create policy "songs_update_block_direct_votes"
on public.songs
for update
to anon
using (false)
with check (false);

-- 策略 4: 允许所有人删除歌曲（可选，根据需要开启）
-- drop policy if exists "songs_delete_policy" on public.songs;
-- create policy "songs_delete_policy"
-- on public.songs
-- for delete
-- to anon
-- using (true);


-- =========================================
-- 2. song_likes 表（点赞表）的 RLS 策略
-- =========================================

-- 启用行级安全
alter table public.song_likes enable row level security;

-- 策略 1: 允许所有人读取点赞记录
drop policy if exists "likes_select_policy" on public.song_likes;
create policy "likes_select_policy"
on public.song_likes
for select
to anon
using (true);

-- 策略 2: 允许所有人插入点赞记录
drop policy if exists "likes_insert_policy" on public.song_likes;
drop policy if exists "likes_insert_all" on public.song_likes;
create policy "likes_insert_block_direct_votes"
on public.song_likes
for insert
to anon
with check (false);

-- 策略 3: 允许所有人删除自己的点赞记录
drop policy if exists "likes_delete_policy" on public.song_likes;
drop policy if exists "likes_delete_all" on public.song_likes;
create policy "likes_delete_block_direct_votes"
on public.song_likes
for delete
to anon
using (false);

-- 策略 4: 不允许更新点赞记录（点赞记录创建后不应修改）
-- 不创建 update 策略


-- =========================================
-- 3. announcements 表（公告表）的 RLS 策略
-- =========================================

-- 启用行级安全
alter table public.announcements enable row level security;

-- 策略 1: 允许所有人读取公告
drop policy if exists "announcements_select_policy" on public.announcements;
create policy "announcements_select_policy"
on public.announcements
for select
to anon
using (true);

-- 策略 2: 允许所有人插入公告（管理员功能）
drop policy if exists "announcements_insert_policy" on public.announcements;
create policy "announcements_insert_policy"
on public.announcements
for insert
to anon
with check (true);

-- 策略 3: 允许所有人更新公告（管理员功能）
drop policy if exists "announcements_update_policy" on public.announcements;
create policy "announcements_update_policy"
on public.announcements
for update
to anon
using (true)
with check (true);

-- 策略 4: 允许所有人删除公告（管理员功能，可选）
-- drop policy if exists "announcements_delete_policy" on public.announcements;
-- create policy "announcements_delete_policy"
-- on public.announcements
-- for delete
-- to anon
-- using (true);


-- =========================================
-- 验证策略是否创建成功
-- =========================================

-- 查看 songs 表的策略
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where tablename in ('songs', 'song_likes', 'announcements')
order by tablename, policyname;


-- =========================================
-- 说明
-- =========================================
-- 
-- 权限说明：
-- - select: 读取数据
-- - insert: 插入数据
-- - update: 更新数据
-- - delete: 删除数据
--
-- 角色说明：
-- - anon: 匿名用户（使用 anon key）
-- - authenticated: 已认证用户
-- - service_role: 服务角色（使用 service_role key，绕过 RLS）
--
-- 安全建议：
-- 1. anon key 是公开的，可以放在前端代码中
-- 2. service_role key 是机密的，绝对不能暴露
-- 3. RLS 策略确保了即使 anon key 公开，数据也是安全的
-- 4. 如果需要更严格的控制，可以添加用户认证
--
-- 当前配置：
-- ✅ 所有表都允许 anon 用户完全访问
-- ✅ 适合全前端应用
-- ✅ 数据通过 RLS 保护
--
