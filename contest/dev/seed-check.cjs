// 在 PGlite 中验证演示种子：重建 schema → 种子两遍（幂等）→ 游客/网关/管理员断言。
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { PGlite } = require("@electric-sql/pglite");

(async () => {
  const db = new PGlite();
  const root = path.resolve(__dirname, "../..");
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace("create extension if not exists pgcrypto;", "");
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email',true),'') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',auth.email()) $$;
    grant usage on schema auth to anon,authenticated;`);
  await db.exec(read("supabase-reset-and-rebuild.sql"));
  await db.exec(read("contest/demo-seed.sql"));
  await db.exec(read("contest/demo-seed.sql"));

  const PERIOD = "a0000000-0000-4000-8000-000000000001";
  const ARCHIVED = "a0000000-0000-4000-8000-000000000002";
  const role = async (name, id = "", email = "") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)", [id, email]);
    await db.exec("set role " + name);
  };

  // 游客可读：正式期 + 往期 + 曲库 + 公告（列与前端查询一致）。
  await role("anon");
  assert.equal((await db.query("select id,title,starts_at,ends_at,status,created_at,updated_at,archived_at,is_test from playlist_periods")).rows.length, 2);
  assert.equal((await db.query("select id,title,artist,title_lower,artist_lower,playlist_date,likes_count,dislikes_count,is_locked,created_at from songs where playlist_date=$1", [PERIOD])).rows.length, 8);
  assert.equal((await db.query("select id from songs where playlist_date=$1", [ARCHIVED])).rows.length, 3);
  assert.equal((await db.query("select * from get_song_catalog($1)", [PERIOD])).rows.length, 12);
  assert.equal((await db.query("select id,title,content,is_active,created_at,updated_at from announcements where is_active")).rows.length, 2);
  const top = await one("select title,likes_count,dislikes_count from songs where playlist_date=$1 order by likes_count desc limit 1", [PERIOD]);
  assert.deepEqual(top, { title: "晴天", likes_count: 5, dislikes_count: 0 });
  assert.equal((await one("select dislikes_count from songs where id='d0000000-0000-4000-8000-000000000006'")).dislikes_count, 1);
  assert.equal((await one("select is_admin_email_allowed('admin@chu.demo') ok")).ok, true);
  assert.equal((await one("select is_admin_email_allowed('judge@chu.demo') ok")).ok, false);

  // 网关身份（service_role + DEMO openid + null IP）：读票/点喜欢/投稿/重复投稿。
  const UID = "33333333-3333-4333-8333-333333333333";
  const participate = async (operation, songId = null, action = null, reason = null) =>
    (await one("select qq_participate('9000000001',$1,'评委同学','','' || $2,$3,$4,null,null,$5,$6,$7,null) result",
      ["DEMO_" + UID, operation, PERIOD, songId, action, reason, UID])).result;
  await role("service_role");
  let votes = await participate("votes");
  assert.deepEqual(votes, { likes: [], dislikes: [] });
  let like = await participate("like", "d0000000-0000-4000-8000-000000000001", "on");
  assert.equal(like.likes_count, 6, JSON.stringify(like));
  votes = await participate("votes");
  assert.deepEqual(votes.likes, ["d0000000-0000-4000-8000-000000000001"]);
  const submitted = await participate("submit", "c0000000-0000-4000-8000-000000000009");
  assert.equal(submitted.title, "同桌的你", JSON.stringify(submitted));
  assert.match((await participate("submit", "c0000000-0000-4000-8000-000000000009")).error_message, /已有/);
  const dislike = await participate("dislike", "d0000000-0000-4000-8000-000000000002", "on", "不适合播出");
  assert.equal(dislike.disliked, true, JSON.stringify(dislike));
  const account = (await one("select qq_account_status('9000000001',$1,'评委同学','') result", ["DEMO_" + UID])).result;
  assert(account.id && Array.isArray(account.notices) && account.moderation.banned === false);

  // 管理员邮箱授权生效。
  const ADMIN = "44444444-4444-4444-8444-444444444444";
  await db.exec("reset role");
  await db.query("insert into auth.users values($1,'admin@chu.demo')", [ADMIN]);
  await role("authenticated", ADMIN, "admin@chu.demo");
  assert.equal((await one("select is_current_user_admin() ok")).ok, true);
  assert.equal((await db.query("select * from song_catalog")).rows.length, 12);
  assert.equal((await one("select count(*)::int n from song_reports where status='pending'")).n, 2);

  console.log("demo seed checks passed");
})().catch((error) => { console.error(error); process.exit(1); });