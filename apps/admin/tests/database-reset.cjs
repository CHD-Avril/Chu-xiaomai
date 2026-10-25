const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root,file),'utf8').replace('create extension if not exists pgcrypto;','');
const admin='11111111-1111-4111-8111-111111111111', tester='22222222-2222-4222-8222-222222222222';
async function bootstrap() {
  let db;
  if (process.env.PG_LOCAL_TEST_URL) {
    const url = new URL(process.env.PG_LOCAL_TEST_URL);
    if (!['127.0.0.1','localhost'].includes(url.hostname) || !/^\/chu_test_[a-z0-9_]+$/.test(url.pathname)) throw new Error('Use a disposable chu_test_* database on loopback only.');
    const { Client } = require(process.env.PG_TEST_MODULE_PATH || 'pg');
    db = new Client({ connectionString:url.href });await db.connect();
    db.exec = sql => db.query(sql);db.close = () => db.end();
    // Only the disposable test database may be reset by the test harness.
    await db.exec('drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists storage cascade; create schema public;');
  } else {
    const { PGlite } = require('@electric-sql/pglite');db = new PGlite();
  }
  await db.exec(`do $$ begin
    if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email',true),'') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',auth.email()) $$;
    grant usage on schema auth to anon,authenticated;
    create schema storage; create table storage.objects(id text); insert into storage.objects values('untouched-file');
    create table public.unrelated_data(value text); insert into public.unrelated_data values('keep-me');
    create function public.unrelated_function() returns int language sql as $$ select 7 $$;`);
  await db.query("insert into auth.users values($1,'admin@example.invalid'),($2,'tester@example.invalid')",[admin,tester]);
  return db;
}
async function one(db, sql, args=[]) { return (await db.query(sql,args)).rows[0]; }
async function identity(db, id, email) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)",[id||'',email||'']);
  await db.exec('set role '+(id?'authenticated':'anon'));
}
async function assertEmptyBusiness(db, adminExpected=1) {
  await db.exec('reset role');
  for(const table of ['songs','song_likes','song_dislikes','song_reports','playlist_periods','announcements','vote_attempts','api_request_attempts','admin_action_log','broadcast_playlists','database_repair_archive','test_accounts'])
    assert.equal((await one(db,'select count(*)::int n from '+table)).n,0,table+' was not cleared');
  assert.equal((await one(db,'select count(*)::int n from security_settings')).n,1);
  assert.equal((await one(db,'select count(*)::int n from auth.users')).n,2);
  assert.equal((await one(db,'select count(*)::int n from admin_users')).n,adminExpected);
  assert.equal((await one(db,'select value from unrelated_data')).value,'keep-me');
  assert.equal((await one(db,'select id from storage.objects')).id,'untouched-file');
  assert.equal((await one(db,'select unrelated_function() n')).n,7);
  assert.equal((await one(db,"select count(*)::int n from information_schema.columns where table_schema='public' and table_name in ('songs','song_likes','song_dislikes','song_reports','vote_attempts') and column_name='period_id' and udt_name='uuid'")).n,5);
}
async function assertMaintenanceConcurrency(db, reset) {
  if (!process.env.PG_LOCAL_TEST_URL) return;
  const { Client } = require(process.env.PG_TEST_MODULE_PATH || 'pg');
  const busy = new Client({ connectionString:process.env.PG_LOCAL_TEST_URL,statement_timeout:5000 });
  await busy.connect();
  try {
    const original = await one(db,"select 'public.songs'::regclass::oid id,count(*)::int n from songs");
    for (const [lock, expected] of [
      ['lock table public.admin_users in access share mode','public.admin_users'],
      ['lock table public.songs in access share mode','public.songs'],
      ['lock table auth.users in row exclusive mode','auth.users'],
      ["select pg_advisory_xact_lock(hashtextextended('chu:reset-and-rebuild',0))",'已有数据库重建任务']
    ]) {
      await busy.query('begin');
      await busy.query(lock);
      await assert.rejects(db.exec(reset),error => error.code==='55P03' && error.message.includes(expected));
      // A failed preflight must release earlier locks, so another reader can
      // still use the original tables even before the SQL Editor rolls back.
      await busy.query('select count(*) from public.songs');
      await db.exec('rollback');
      assert.deepEqual(await one(db,"select 'public.songs'::regclass::oid id,count(*)::int n from songs"),original);
      await busy.query('rollback');
    }
    await db.exec(reset);await assertEmptyBusiness(db);
    console.log('PASS real PostgreSQL concurrent admin/song readers, Auth writer and competing reset safely refused before deletion; reset succeeds after release');
  } finally {
    await busy.query('rollback');await busy.end();await db.exec('rollback');
  }
}
(async()=>{
  const { buildResetSql }=await import(pathToFileURL(path.join(root,'scripts/build-database-reset.mjs')).href);
  const source=fs.readFileSync(path.join(root,'supabase-reset-and-rebuild.sql'),'utf8');
  assert.equal(source,buildResetSql(),'Regenerate the combined reset SQL after changing a migration');
  assert.equal((source.match(/^begin;$/gm)||[]).length,1);assert.equal((source.match(/^commit;$/gm)||[]).length,1);
  assert(!/create temp table historical_vote_conflicts|pg_temp\.historical_vote_conflicts/.test(source),'Conflict reconciliation must not rely on a temporary relation');
  const reset=read('supabase-reset-and-rebuild.sql');
  const db=await bootstrap();
  await db.exec(read('supabase-schema.sql'));
  await db.query("insert into admin_users(email,user_id) values('admin@example.invalid',$1)",[admin]);
  const old=(await one(db,"insert into songs(title,artist,title_lower,artist_lower,playlist_date,created_by) values('旧歌曲','旧歌手','旧歌曲','旧歌手','legacy-non-uuid','visitor') returning id")).id;
  await db.query("insert into song_likes(song_id,user_id,voter_cookie,playlist_date) values($1,'old','old','legacy-non-uuid')",[old]);
  await db.exec("create function public.submit_song(text,text) returns text language sql as $$ select 'legacy' $$;");
  await assert.rejects(db.exec(read('supabase-test-mode.sql')),/数据库升级尚未完成/);await db.exec('rollback');
  assert.equal((await one(db,'select count(*)::int n from songs')).n,1);
  await db.exec(reset);await assertEmptyBusiness(db);
  assert.equal((await one(db,"select to_regprocedure('public.submit_song(text,text)') old")).old,null);
  await identity(db,admin,'admin@example.invalid');assert.equal((await one(db,'select is_current_user_admin() allowed')).allowed,true);
  const period=(await one(db,"select admin_create_playlist_period('全新测试期',now()-interval '1 day',now()+interval '1 day') id")).id;
  await db.query("select admin_set_test_account('tester@example.invalid',true)");await db.query('select admin_set_period_test_mode($1,true,false)',[period]);
  await identity(db,null,null);await assert.rejects(db.query("select * from submit_song('匿名越权','歌手',$1,$2)",[period,tester]),/permission denied/);
  await identity(db,tester,'tester@example.invalid');
  await assert.rejects(db.query("select * from submit_song('测试账号也须QQ登录','歌手',$1,$2)",[period,tester]),/permission denied/);
  await db.exec('reset role; set role service_role');
  const participate=async(operation,songId=null) => (await one(db,"select qq_participate('1905775107','RESET_QQ_ACCOUNT','测试员','',$1,$2,$3,'新测试歌曲','测试员','on',null,$4) result",[operation,period,songId,tester])).result;
  const song=await participate('submit');assert(song.id);assert.equal(song.error_code,null);
  assert.equal((await participate('like',song.id)).liked,true);
  await db.exec('reset role');
  const qqId=(await one(db,"select id from qq_accounts where openid='RESET_QQ_ACCOUNT'")).id;
  await identity(db,admin,'admin@example.invalid');
  await db.query("select admin_moderate_account($1,'ban','重建后仍应生效',null,0)",[qqId]);
  await identity(db,null,null);assert.equal((await one(db,'select count(*)::int n from songs')).n,0);
  await db.exec('reset role');await db.exec(reset);await assertEmptyBusiness(db);
  assert.equal((await one(db,"select id from qq_accounts where openid='RESET_QQ_ACCOUNT'")).id,qqId,'Reset must preserve durable QQ identity');
  assert.equal((await one(db,'select qq_moderation_state($1) state',[qqId])).state.banned,true,'Reset must not erase existing bans');
  assert.equal((await one(db,'select count(*)::int n from account_moderation_actions where account_id=$1',[qqId])).n,1);
  console.log('PASS one-file rebuild from legacy schema without period_id and non-UUID old data; latest populated schema reset; accounts/admins/Storage/unrelated objects preserved; test login/submission/votes and isolation work');

  // A dependency outside the named application tables must abort before losing data.
  const rollbackPeriod=(await one(db,"insert into playlist_periods(title,starts_at,ends_at,created_by) values('回滚保留期',now(),now()+interval '1 day','owner') returning id")).id;
  await db.query("insert into songs(title,artist,title_lower,artist_lower,playlist_date,created_by) values('回滚保留歌','歌手','回滚保留歌','歌手',$1,'visitor')",[rollbackPeriod]);
  await db.exec('create table external_dependency(song_id uuid references public.songs(id));');
  await assert.rejects(db.exec(reset),/depend|cannot drop/);await db.exec('rollback');
  assert.equal((await one(db,"select count(*)::int n from songs where title='回滚保留歌'")).n,1);
  assert.equal((await one(db,'select count(*)::int n from playlist_periods')).n,1);
  assert((await one(db,"select to_regclass('public.external_dependency') relation")).relation);
  await db.exec('drop table external_dependency');
  // A rebuild error after the DROP must restore old tables and data too.
  const failing=reset.replace('-- ===== supabase-schema.sql =====',"select missing_reset_test_function();\n-- ===== supabase-schema.sql =====");
  await assert.rejects(db.exec(failing),/missing_reset_test_function/);await db.exec('rollback');
  assert.equal((await one(db,"select count(*)::int n from songs where title='回滚保留歌'")).n,1);
  await assertMaintenanceConcurrency(db,reset);
  await db.close();
  const fresh=await bootstrap();await fresh.exec(reset);await assertEmptyBusiness(fresh,0);await fresh.close();
  console.log('ALL RESET DATABASE CHECKS PASSED: fresh database, foreign dependency rejection and rollback after deletion');
})().catch(error=>{console.error(error);process.exitCode=1;});
