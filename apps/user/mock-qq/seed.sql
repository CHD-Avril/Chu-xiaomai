-- ============================================================
-- 本地 Supabase 种子数据（联调用）
-- 使用方式：supabase start 启动本地库后，在 Supabase 面板 SQL Editor 中执行，
-- 或通过 psql 导入。注意仅用于本地开发库，勿在生产库执行。
-- ============================================================

-- 1) 管理员白名单（本地登录运营端用；密码在 Supabase Auth 面板为该邮箱创建）
INSERT INTO admin_users (email, user_id)
VALUES ('admin@example.com', gen_random_uuid())
ON CONFLICT (email) DO NOTHING;

-- 2) 一个进行中的征集期（昨天开始、一周后结束）
INSERT INTO playlist_periods (id, title, starts_at, ends_at, status, created_by)
VALUES (
  gen_random_uuid(),
  '本地联调征集期',
  now() - interval '1 day',
  now() + interval '7 days',
  'active',
  (SELECT user_id FROM admin_users WHERE email = 'admin@example.com')
)
ON CONFLICT DO NOTHING;

-- 3) 示例公告（验证弹窗与告示栏）
INSERT INTO announcements (title, content, is_active, created_by)
VALUES (
  '本地测试公告',
  '这是本地环境生成的公告，用于联调公告弹窗与首页告示栏。',
  true,
  (SELECT user_id FROM admin_users WHERE email = 'admin@example.com')
)
ON CONFLICT DO NOTHING;

-- 4) 示例歌曲（验证榜单渲染；likes_count 为冗余计数，真实数据来自 song_likes）
INSERT INTO songs (title, artist, title_lower, artist_lower, playlist_date, likes_count, created_by)
VALUES
  ('晴天', '周杰伦', 'qingtian', 'zhoujielun', (SELECT id FROM playlist_periods WHERE status = 'active' LIMIT 1), 12, (SELECT user_id FROM admin_users WHERE email = 'admin@example.com')),
  ('海阔天空', 'Beyond', 'haikuotiankong', 'beyond', (SELECT id FROM playlist_periods WHERE status = 'active' LIMIT 1), 9, (SELECT user_id FROM admin_users WHERE email = 'admin@example.com')),
  ('夜空中最亮的星', '逃跑计划', 'yekongzhongzuiliangdexing', 'taopaojihua', (SELECT id FROM playlist_periods WHERE status = 'active' LIMIT 1), 6, (SELECT user_id FROM admin_users WHERE email = 'admin@example.com'))
ON CONFLICT DO NOTHING;
