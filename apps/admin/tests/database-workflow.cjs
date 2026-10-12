const fs = require('node:fs');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  await db.exec([
    "create role anon; create role authenticated;",
    "create schema auth; create table auth.users(id uuid primary key, email text);",
    "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
    "create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email',true),'') $$;",
    "create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',auth.email()) $$;",
    "grant usage on schema auth to anon, authenticated;"
  ].join('\n'));
  const root = require('node:path').resolve(__dirname, '../../..') + '/';
  await db.exec(fs.readFileSync(root + 'supabase-schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
  const migration = fs.readFileSync(root + 'supabase-admin-workflow.sql','utf8');
  await db.exec(migration); await db.exec(migration);
  const integrity = fs.readFileSync(root + 'supabase-database-integrity.sql','utf8');
  await db.exec(integrity); await db.exec(integrity);
  const admin = '11111111-1111-4111-8111-111111111111';
  const stranger = '22222222-2222-4222-8222-222222222222';
  await db.query("insert into auth.users(id,email) values($1,'test-admin@example.invalid'),($2,'test-user@example.invalid')", [admin,stranger]);
  await db.query("insert into public.admin_users(email,user_id) values('test-admin@example.invalid',$1)",[admin]);
  async function identity(id, email) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)",[id,email]);
    await db.exec('set role authenticated');
  }
  await identity(admin,'test-admin@example.invalid');
  let period = (await db.query("select public.admin_create_playlist_period('本期',now()-interval '1 day',now()+interval '1 day') id")).rows[0].id;
  await db.exec('reset role');
  await db.exec("create function test_reject_period() returns trigger language plpgsql as $$ begin if new.title = '__fail__' then raise exception 'simulated insert failure'; end if; return new; end $$; create trigger test_reject_period before insert on playlist_periods for each row execute function test_reject_period();");
  await db.exec('set role authenticated');
  await assert.rejects(db.query("select public.admin_create_playlist_period('__fail__',now(),now()+interval '1 day')"),/simulated insert failure/);
  assert.equal((await db.query("select status from playlist_periods where id=$1",[period])).rows[0].status,'active');
  const next = (await db.query("select public.admin_create_playlist_period('下一期',now(),now()+interval '1 day') id")).rows[0].id;
  assert.equal((await db.query("select status,archived_at from playlist_periods where id=$1",[period])).rows[0].status,'archived');
  assert.equal((await db.query("select count(*)::int n from playlist_periods where status='active'")).rows[0].n,1);
  console.log('PASS schema + migration twice; atomic rollback and successful period switch');

  await db.exec('reset role');
  const song = (await db.query("insert into songs(title,artist,title_lower,artist_lower,playlist_date,created_by) values('晴天','歌手','晴天','歌手',$1,'visitor') returning id",[next])).rows[0].id;
  const song2 = (await db.query("insert into songs(title,artist,title_lower,artist_lower,playlist_date,created_by) values('旧歌','歌手','旧歌','歌手',$1,'visitor') returning id",[period])).rows[0].id;
  const report = (await db.query("insert into song_reports(song_id,playlist_date,reporter_cookie,reason) values($1,$2,'test-cookie','举报理由') returning id",[song,next])).rows[0].id;
  await db.exec('set role authenticated');
  await db.query("select admin_update_song($1,'晴天修订','歌手',true,'核对歌曲')",[song]);
  assert.equal((await db.query("select is_locked from songs where id=$1",[song])).rows[0].is_locked,true);
  await db.query("select admin_update_song($1,'晴天修订','歌手',false,'确认可以恢复')",[song]);
  assert.equal((await db.query("select count(*)::int n from admin_action_log where target_id=$1",[song])).rows[0].n,2);
  await db.query("select admin_review_song_report($1,true,'内容需要复核')",[report]);
  const reviewed = (await db.query("select status,review_reason,reviewed_by_name,reviewed_by from song_reports where id=$1",[report])).rows[0];
  assert.equal(reviewed.status,'approved'); assert.equal(reviewed.review_reason,'内容需要复核'); assert.equal(reviewed.reviewed_by,admin); assert.equal(reviewed.reviewed_by_name,'test-admin@example.invalid');
  await assert.rejects(db.query("select admin_review_song_report($1,false,'重复处理')",[report]),/Pending report not found/);
  await assert.rejects(db.query("select admin_update_song($1,'歌','人',false,'')",[song]),/操作原因/);
  console.log('PASS edit + lock + unlock audit; report reason, identity, time and duplicate-review rejection');

  const board = status => JSON.stringify([{song_id:song,status}]);
  await assert.rejects(db.query("select admin_save_broadcast_playlist($1,$2::jsonb,0)",[next,board('confirmed')]),/已锁定/);
  let version = (await db.query("select admin_save_broadcast_playlist($1,$2::jsonb,0) v",[next,board('candidate')])).rows[0].v;
  assert.equal(version,1);
  await assert.rejects(db.query("select admin_save_broadcast_playlist($1,$2::jsonb,0)",[next,'[]']),/其他管理员更新/);
  await db.query("select admin_update_song($1,'晴天修订','歌手',false,'恢复播放')",[song]);
  await db.query("select admin_set_song_lock($1,false,'仅恢复状态，保留歌名修订')",[song]);
  assert.equal((await db.query("select title from songs where id=$1",[song])).rows[0].title, '晴天修订');
  version = (await db.query("select admin_save_broadcast_playlist($1,$2::jsonb,1) v",[next,board('confirmed')])).rows[0].v;
  assert.equal(version,2);
  for (const invalid of [
    [{song_id:song,status:'confirmed'},{song_id:song,status:'candidate'}],
    [{song_id:song2,status:'candidate'}],
    [{song_id:song,status:'bad'}], [{song_id:song}], ['bad'],
    [{song_id:'33333333-3333-4333-8333-333333333333',status:'candidate'}]
  ]) await assert.rejects(db.query("select admin_save_broadcast_playlist($1,$2::jsonb,2)",[next,JSON.stringify(invalid)]));
  const saved = (await db.query("select * from broadcast_playlists where period_id=$1",[next])).rows[0];
  assert.equal(saved.version,2); assert.deepEqual(saved.items.map(({song_id,status})=>({song_id,status})),[{song_id:song,status:'confirmed'}]);
  assert.equal(saved.items[0].snapshot.title,'晴天修订');
  console.log('PASS persistent board, version conflicts, locked/foreign/missing/duplicate/invalid entries rejected');

  await identity(stranger,'test-user@example.invalid');
  for (const query of [
    ["select admin_create_playlist_period('攻击',now(),now()+interval '1 day')",[]],
    ["select admin_update_song($1,'攻击','攻击',false,'攻击')",[song]],
    ["select admin_set_song_lock($1,false,'攻击')",[song]],
    ["select admin_review_song_report($1,false,'攻击')",[report]],
    ["select admin_save_broadcast_playlist($1,'[]'::jsonb,2)",[next]]
  ]) await assert.rejects(db.query(...query),/Admin permission required/);
  assert.equal((await db.query('select * from broadcast_playlists')).rows.length,0);
  assert.equal((await db.query('select * from admin_action_log')).rows.length,0);
  await assert.rejects(db.query("update songs set title='攻击' where id=$1",[song]),/permission denied/);
  await assert.rejects(db.query("update broadcast_playlists set items='[]'"),/permission denied/);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query("select admin_create_playlist_period('攻击',now(),now()+interval '1 day')"),/permission denied/);
  console.log('PASS non-admin and anonymous access denied; audit/board RLS and direct mutation protection');
  await db.close();
  console.log('ALL LOCAL DATABASE CHECKS PASSED');
})().catch(e => { console.error(e); process.exitCode=1; });
