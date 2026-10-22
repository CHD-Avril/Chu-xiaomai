// Default: isolated in-memory PostgreSQL. Optional: a disposable loopback PostgreSQL database.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const sql = file => fs.readFileSync(path.join(root, file), 'utf8').replace('create extension if not exists pgcrypto;', '');
const files = ['supabase-schema.sql', 'supabase-admin-workflow.sql', 'supabase-database-integrity.sql'];
const admin = '11111111-1111-4111-8111-111111111111';
const url = process.env.PG_LOCAL_TEST_URL;
let Client, db;
const role = async (connection, name) => connection.exec('reset role; set role ' + name);
const one = async (query, args = []) => (await db.query(query, args)).rows[0];

async function initialize() {
  if (url) {
    const parsed = new URL(url);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !/^\/chu_test_[a-z0-9_]+$/.test(parsed.pathname)) {
      throw new Error('PG_LOCAL_TEST_URL must use a disposable chu_test_* database on loopback.');
    }
    ({ Client } = require(process.env.PG_TEST_MODULE_PATH || 'pg'));
    db = new Client({ connectionString: url }); await db.connect(); db.exec = text => db.query(text);
  } else {
    const { PGlite } = require('@electric-sql/pglite'); db = new PGlite();
  }
}
async function bootstrap() {
  await db.exec(`reset role; drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;
    do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email',true),'') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',auth.email()) $$;
    grant usage on schema auth,public to anon,authenticated;`);
  for (const file of files.slice(0, 2)) await db.exec(sql(file));
  await db.query("insert into auth.users values($1,'admin@example.invalid');", [admin]);
  await db.query("insert into admin_users(email,user_id) values('admin@example.invalid',$1)", [admin]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email','admin@example.invalid',false)", [admin]);
}
async function createPeriod(title = '测试期') {
  await role(db, 'authenticated');
  const result = await one("select admin_create_playlist_period($1,now()-interval '1 day',now()+interval '1 day') id", [title]);
  await db.exec('reset role'); return result.id;
}
async function song(period, title = randomUUID()) {
  await db.exec('reset role');
  return (await one("insert into songs(title,artist,title_lower,artist_lower,playlist_date,created_by) values($1,'歌手',lower($1),'歌手',$2,'test') returning id", [title, period])).id;
}
const voteSQL = 'select * from toggle_song_like($1,$2,$3,$4)';
const dislikeSQL = 'select * from toggle_song_dislike($1,$2,$3,$4,$5)';
const submitSQL = 'select * from submit_song($1,$2,$3,$4)';
async function concurrent(jobs) {
  return Promise.all(jobs.map(async job => {
    const client = new Client({ connectionString: url }); await client.connect();
    try {
      await client.query("set statement_timeout='15s'; set role anon");
      return await job(client);
    } finally { await client.end(); }
  }));
}
async function checkConcurrency(period, songs) {
  await db.exec(`reset role; update security_settings set max_likes_per_period=3,submission_cookie_per_period=3,
    vote_cookie_per_minute=1000,vote_ip_per_minute=1000,submission_cookie_per_minute=1000,submission_ip_per_minute=1000;`);
  let result = await concurrent(songs.map(id => c => c.query(voteSQL, [id, period, 'concurrent-quota', 'like'])));
  assert.equal(result.filter(r => !r.rows[0].error_code).length, 3);
  assert.equal((await one("select count(*)::int n from song_likes where voter_cookie='concurrent-quota'")).n, 3);
  result = await concurrent(Array.from({ length: 20 }, (_, i) => c => i % 2
    ? c.query(voteSQL, [songs[0], period, 'concurrent-sentiment', 'like'])
    : c.query(dislikeSQL, [songs[0], period, 'concurrent-sentiment', 'dislike', '测试'])));
  assert.ok(result.every(r => !r.rows[0].error_code));
  assert.equal(Number((await one("select (select count(*) from song_likes where voter_cookie='concurrent-sentiment')+(select count(*) from song_dislikes where voter_cookie='concurrent-sentiment') n")).n), 1);
  await concurrent(Array.from({ length: 20 }, (_, i) => c => c.query(voteSQL, [songs[1], period, 'concurrent-counter-' + i, 'like'])));
  const counts = await one('select likes_count,(select count(*)::int from song_likes where song_id=$1) actual from songs where id=$1', [songs[1]]);
  assert.equal(counts.likes_count, counts.actual);
  result = await concurrent(Array.from({ length: 20 }, (_, i) => c => c.query(submitSQL, ['并发投稿' + i, '测试', period, 'concurrent-submit'])));
  assert.equal(result.filter(r => !r.rows[0].error_code).length, 3);
  await db.exec('update security_settings set vote_cookie_per_minute=3');
  result = await concurrent(Array.from({ length: 20 }, () => async c => {
    try { return await c.query(voteSQL, [randomUUID(), period, 'concurrent-failed', 'like']); }
    catch (e) { assert.match(e.message, /过于频繁/); return null; }
  }));
  assert.equal(result.filter(Boolean).length, 3);
  assert.equal((await one("select count(*)::int n from api_request_attempts where cookie_hash=md5('concurrent-failed')")).n, 3);
  await db.exec('update security_settings set vote_cookie_per_minute=1000,vote_ip_per_minute=3');
  result = await concurrent(Array.from({ length: 12 }, (_, i) => async c => {
    await c.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-forwarded-for': '192.0.2.19' })]);
    try { return await c.query(voteSQL, [randomUUID(), period, 'concurrent-ip-' + i, 'like']); }
    catch (e) { assert.match(e.message, /过于频繁/); return null; }
  }));
  assert.equal(result.filter(Boolean).length, 3);
  // Review and voting use the same song -> report lock order.
  await db.exec('update security_settings set vote_ip_per_minute=1000');
  const report = (await one("insert into song_reports(song_id,playlist_date,reporter_cookie,reason) values($1,$2,'review-race','测试') returning id", [songs[2], period])).id;
  await concurrent(Array.from({ length: 12 }, (_, i) => async c => {
    if (i) return c.query(dislikeSQL, [songs[2], period, 'review-race-' + i, 'dislike', '测试']);
    await c.query('reset role');
    await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email','admin@example.invalid',false)", [admin]);
    await c.query('set role authenticated');
    return c.query("select admin_review_song_report($1,false,'并发审核')", [report]);
  }));
  console.log('PASS real PostgreSQL: concurrent quota, opposite votes, counts, submissions, failed-attempt rate limit, shared-IP limit and review lock order');
}
async function main() {
  await initialize(); await bootstrap(); await db.exec(sql(files[2])); await db.exec(sql(files[2]));
  const period = await createPeriod(); const first = await song(period, '快照原名');
  await assert.rejects(db.query("insert into playlist_periods(title,starts_at,ends_at,created_by) values('第二活跃期',now(),now()+interval '1 day','test')"), /unique/);
  await role(db, 'authenticated');
  await assert.rejects(db.query("update playlist_periods set title='绕过RPC'"), /permission denied/);
  await assert.rejects(db.query('select review_song_report($1,false)', [randomUUID()]), /permission denied/);
  await db.query("select admin_update_playlist_period($1,'编辑成功',now()-interval '1 day',now()+interval '2 days')", [period]);
  await db.exec('reset role');
  assert.equal((await one('select period_id from songs where id=$1', [first])).period_id, period);
  await assert.rejects(db.query('delete from playlist_periods where id=$1', [period]), /foreign key/);
  await assert.rejects(db.query('update songs set period_id=$1,playlist_date=$2 where id=$3', [randomUUID(), period, first]), /foreign key|不一致/);
  await db.exec('update security_settings set vote_cookie_per_minute=1000,submission_cookie_per_minute=1000');
  await role(db, 'anon');
  let result = await one(submitSQL, ['歌'.repeat(80), '歌手', period, 'test-submit-cookie']); assert.equal(result.error_code, null);
  result = await one(submitSQL, ['歌'.repeat(81), '歌手', period, 'test-submit-cookie']); assert.ok(result.error_code);
  result = await one(voteSQL, [first, period, 'test-vote-cookie', 'like']); assert.equal(result.error_code, null); assert.equal(result.likes_count, 1);
  result = await one(dislikeSQL, [first, period, 'test-vote-cookie', 'dislike', '测试']); assert.equal(result.error_code, null); assert.equal(result.dislikes_count, 1);
  result = await one(dislikeSQL, [first, period, 'test-vote-cookie', 'undislike', null]); assert.equal(result.error_code, null);
  await db.exec('reset role');
  assert.equal((await one("select count(*)::int n from song_reports where reporter_cookie='test-vote-cookie' and status='pending'")).n, 1);
  await db.query("insert into song_likes(song_id,playlist_date,user_id,voter_cookie) values($1,$2,'direct-identity','direct-identity')", [first, period]);
  await assert.rejects(db.query("insert into song_dislikes(song_id,playlist_date,user_id,voter_cookie) values($1,$2,'direct-identity','direct-identity')", [first, period]), /不能同时/);
  await assert.rejects(db.query('delete from songs where id=$1', [first]), /foreign key/);
  await assert.rejects(db.query("insert into song_likes(song_id,period_id,user_id) values($1,$2,'wrong-period')", [first, randomUUID()]), /foreign key/);
  await db.exec('update security_settings set vote_cookie_per_minute=3');
  await role(db, 'anon');
  for (let i = 0; i < 3; i++) assert.ok((await one(voteSQL, [first, 'invalid-period', i % 2 ? '  failed-cookie  ' : 'failed-cookie', 'like'])).error_code);
  await assert.rejects(db.query(voteSQL, [first, period, 'failed-cookie', 'like']), /过于频繁/);
  await db.exec('reset role');
  assert.equal((await one("select count(*)::int n from api_request_attempts where cookie_hash=md5('failed-cookie')")).n, 3);
  await db.exec("create function test_fail_vote() returns trigger language plpgsql as $$ begin if new.voter_cookie='internal-failure' then raise exception 'private diagnostic' using errcode='XX000'; end if; return new; end $$; create trigger test_fail_vote before insert on song_likes for each row execute function test_fail_vote();");
  await role(db, 'anon'); result = await one(voteSQL, [first, period, 'internal-failure', 'like']);
  assert.equal(result.error_code, 'XX000'); assert.doesNotMatch(result.error_message, /private/);
  await db.exec('reset role');
  assert.equal((await one("select count(*)::int n from api_request_attempts where cookie_hash=md5('internal-failure')")).n, 1);
  assert.equal((await one("select count(*)::int n from song_likes where voter_cookie='internal-failure'")).n, 0);
  console.log('PASS UUID/FK and active-period constraints, old endpoint isolation, 80-character limits, failed-attempt persistence, nested rollback and mutual exclusion');
  await role(db, 'authenticated');
  await assert.rejects(db.query("select admin_update_song($1,$2,'歌手',false,'长度核验')", [first, '字'.repeat(81)]), /80/);
  const board = (status, forged = '伪造') => JSON.stringify([{ song_id: first, status, snapshot: { title: forged } }]);
  await db.query('select admin_save_broadcast_playlist($1,$2::jsonb,0)', [period, board('confirmed')]);
  assert.equal((await one('select items from broadcast_playlists where period_id=$1', [period])).items[0].snapshot.title, '快照原名');
  await db.query("select admin_update_song($1,'修改后的歌名','歌手',false,'核实修订')", [first]);
  await db.query('select admin_save_broadcast_playlist($1,$2::jsonb,1)', [period, board('confirmed')]);
  assert.equal((await one('select items from broadcast_playlists where period_id=$1', [period])).items[0].snapshot.title, '快照原名');
  await db.query('select admin_save_broadcast_playlist($1,$2::jsonb,2)', [period, board('candidate')]);
  await db.query('select admin_save_broadcast_playlist($1,$2::jsonb,3)', [period, board('confirmed')]);
  assert.equal((await one('select items from broadcast_playlists where period_id=$1', [period])).items[0].snapshot.title, '修改后的歌名');
  console.log('PASS server-owned confirmation snapshots, rename stability and explicit reconfirmation');
  if (url) {
    const songs = []; for (let i = 0; i < 20; i++) songs.push(await song(period));
    await checkConcurrency(period, songs);
  }
  // Simulate an old installation containing duplicates before the integrity upgrade.
  await bootstrap(); const oldPeriod = await createPeriod('历史迁移');
  await db.exec('drop index songs_period_title_artist_unique');
  const keeper = await song(oldPeriod, '重复歌'); const duplicate = await song(oldPeriod, '重复歌');
  await db.query("update songs set created_at=now()-interval '1 day' where id=$1", [keeper]);
  for (const [table, id, cookie, time] of [['song_likes', keeper, 'conflict-browser', '-2 days'], ['song_dislikes', duplicate, 'conflict-browser', '-1 day'], ['song_likes', duplicate, 'unique-like', '-1 day'], ['song_dislikes', duplicate, 'unique-dislike', '-1 day']]) {
    await db.query(`insert into ${table}(song_id,playlist_date,user_id,voter_cookie,created_at) values($1,$2,$3,$3,now()+$4::interval)`, [id, oldPeriod, cookie, time]);
  }
  for (const id of [keeper, duplicate]) await db.query("insert into song_reports(song_id,playlist_date,reporter_cookie,reason) values($1,$2,'same-reporter','原始举报')", [id, oldPeriod]);
  await db.query("insert into song_reports(song_id,playlist_date,reporter_cookie,reason,status) values($1,$2,'history-reporter','历史已审核','rejected')", [duplicate, oldPeriod]);
  await db.query("insert into broadcast_playlists(period_id,items,version,updated_by_name) values($1,$2,5,'legacy-admin')", [oldPeriod, JSON.stringify([{ song_id: keeper, status: 'candidate' }, { song_id: duplicate, status: 'confirmed' }])]);
  await db.exec(sql(files[2]));
  assert.equal((await one('select count(*)::int n from songs')).n, 1);
  const merged = await one('select * from songs where id=$1', [keeper]); assert.equal(merged.likes_count, 1); assert.equal(merged.dislikes_count, 2);
  assert.equal((await one("select count(*)::int n from song_reports where status='pending'")).n, 1);
  assert.equal((await one("select count(*)::int n from song_reports where status='rejected'")).n, 1);
  assert.equal((await one("select count(*)::int n from database_repair_archive where source_table='song_reports'")).n, 3);
  const repairedBoard = await one('select * from broadcast_playlists where period_id=$1', [oldPeriod]);
  assert.equal(repairedBoard.items.length, 1); assert.equal(repairedBoard.items[0].song_id, keeper); assert.equal(repairedBoard.items[0].status, 'confirmed');
  assert.equal(repairedBoard.items[0].snapshot.source, 'migration'); assert.ok(repairedBoard.version > 5);
  await db.exec(sql(files[2])); assert.deepEqual((await one('select * from broadcast_playlists where period_id=$1', [oldPeriod])).items, repairedBoard.items);
  assert.equal((await one('select version from broadcast_playlists where period_id=$1', [oldPeriod])).version, repairedBoard.version);
  for (const file of files) await db.exec(sql(file));
  assert.equal((await one('select version from broadcast_playlists where period_id=$1', [oldPeriod])).version, repairedBoard.version);
  await role(db, 'authenticated');
  await assert.rejects(db.query('select review_song_report($1,false)', [randomUUID()]), /permission denied/);
  await assert.rejects(db.query("update playlist_periods set title='绕过RPC'"), /permission denied/);
  await db.query('select admin_archive_playlist_period($1)', [oldPeriod]);
  assert.equal((await one('select status from playlist_periods where id=$1', [oldPeriod])).status, 'archived');
  await assert.rejects(db.query('select * from api_request_attempts'), /permission denied/);
  await assert.rejects(db.query('select purge_expired_request_attempts()'), /permission denied/);
  await db.exec('reset role');
  await db.exec("insert into api_request_attempts(attempt_type,cookie_hash,created_at) values('vote','old-test',now()-interval '8 days'),('vote','new-test',now()); select purge_expired_request_attempts();");
  assert.equal((await one('select count(*)::int n from api_request_attempts')).n, 1);
  assert.equal((await one('select count(*)::int n from songs')).n, 1);
  console.log('PASS legacy merge preserves dislikes/reports, archives originals, reconciles sentiments, remaps board and backfills provenance idempotently');
  // Exercise the single-statement conflict reconciliation independently of duplicate merging.
  await bootstrap(); const conflictPeriod = await createPeriod('跨表情绪修复'); const conflictSong = await song(conflictPeriod);
  for (const [cookie, likeTime, dislikeTime] of [['newer-like','-1 day','-2 days'],['newer-dislike','-2 days','-1 day']]) {
    await db.query("insert into song_likes(song_id,playlist_date,user_id,voter_cookie,created_at) values($1,$2,$3,$3,now()+$4::interval)",[conflictSong,conflictPeriod,cookie,likeTime]);
    await db.query("insert into song_dislikes(song_id,playlist_date,user_id,voter_cookie,created_at) values($1,$2,$3,$3,now()+$4::interval)",[conflictSong,conflictPeriod,cookie,dislikeTime]);
  }
  await db.exec(sql(files[2]));
  assert.equal((await one('select count(*)::int n from song_likes')).n,1);
  assert.equal((await one('select count(*)::int n from song_dislikes')).n,1);
  assert.equal((await one('select voter_cookie from song_likes')).voter_cookie,'newer-like');
  assert.equal((await one('select voter_cookie from song_dislikes')).voter_cookie,'newer-dislike');
  assert.equal((await one("select count(*)::int n from database_repair_archive where reason='sentiment_conflict'")).n,4);
  assert.deepEqual(await one('select likes_count,dislikes_count from songs where id=$1',[conflictSong]),{likes_count:1,dislikes_count:1});
  await db.exec(sql(files[2]));
  assert.equal((await one("select count(*)::int n from database_repair_archive where reason='sentiment_conflict'")).n,4);
  console.log('PASS single-statement conflict reconciliation keeps newest sentiments, archives all original votes and is repeatable without a temporary table');
  await bootstrap(); const preflightPeriod = await createPeriod(); await song(preflightPeriod);
  await db.query("insert into playlist_periods(title,starts_at,ends_at,created_by) values('冲突活跃期',now(),now()+interval '1 day','test')");
  await assert.rejects(db.exec(sql(files[2])), /多个 active/); await db.exec('rollback');
  assert.equal((await one("select count(*)::int n from playlist_periods where status='active'")).n, 2);
  assert.equal((await one('select count(*)::int n from songs')).n, 1);
  await db.query("update playlist_periods set status='archived' where id<>$1", [preflightPeriod]);
  await db.query('update songs set playlist_date=$1', [randomUUID()]);
  await assert.rejects(db.exec(sql(files[2])), /孤立或非 UUID/); await db.exec('rollback');
  assert.equal((await one('select count(*)::int n from songs')).n, 1);
  await db.query('update songs set playlist_date=$1', [preflightPeriod]);
  const foreignPeriod = (await one('select id from playlist_periods where id<>$1', [preflightPeriod])).id;
  const orphanSong = (await one('select id from songs')).id;
  await db.query("insert into song_likes(song_id,playlist_date,user_id,voter_cookie) values($1,$2,'wrong-period','wrong-period')", [orphanSong, foreignPeriod]);
  await assert.rejects(db.exec(sql(files[2])), /错配/); await db.exec('rollback');
  assert.equal((await one('select count(*)::int n from song_likes')).n, 1);
  console.log('PASS ambiguous legacy data stops migration without committing changes');
}
main().then(async () => { if (url) await db.end(); else await db.close(); }).catch(async e => {
  console.error(e); try { if (url) await db.end(); else await db.close(); } catch {} process.exitCode = 1;
});
