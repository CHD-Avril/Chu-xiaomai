const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite(), root = path.resolve(__dirname, '../../..');
  const read = file => fs.readFileSync(path.join(root,file),'utf8').replace('create extension if not exists pgcrypto;','');
  const one = async (sql,args=[]) => (await db.query(sql,args)).rows[0];
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email',true),'') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',auth.email()) $$;
    grant usage on schema auth to anon,authenticated;`);
  for (const file of ['supabase-schema.sql','supabase-admin-workflow.sql','supabase-database-integrity.sql','supabase-test-mode.sql']) await db.exec(read(file));
  const admin='11111111-1111-4111-8111-111111111111', tester='22222222-2222-4222-8222-222222222222';
  await db.query("insert into auth.users values($1,'admin@example.invalid'),($2,'tester@example.invalid')",[admin,tester]);
  await db.query("insert into admin_users(email,user_id) values('admin@example.invalid',$1)",[admin]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email','admin@example.invalid',false)",[admin]);
  const period=(await one("select admin_create_playlist_period('QQ参与验收',now()-interval '1 day',now()+interval '1 day') id")).id;
  const legacy=(await one("select * from submit_song('旧游客投稿','歌手',$1,'legacy-visitor')",[period])).id;
  await db.query("select * from toggle_song_like($1,$2,'legacy-visitor','like')",[legacy,period]);
  await db.exec(read('supabase-qq-participation.sql'));
  await db.exec(read('supabase-qq-participation.sql'));
  async function role(name) { await db.exec('reset role; set role '+name); }
  const args = { account:'QQ_A', app:'1905775107', operation:'votes', song:null, action:null, title:null, artist:null, reason:null, tester:null, ip:'192.0.2.20' };
  async function participate(overrides={}) {
    const a={...args,...overrides};
    return (await one("select qq_participate($1,$2,'昵称','',$3,$4,$5,$6,$7,$8,$9,$10,$11) result",
      [a.app,a.account,a.operation,period,a.song,a.title,a.artist,a.action,a.reason,a.tester,a.ip])).result;
  }
  for (const name of ['anon','authenticated']) {
    await role(name);
    assert.equal((await one('select count(*)::int n from songs')).n,1);
    if (name==='anon') await assert.rejects(db.query('select * from qq_accounts'),/permission denied/);
    else assert.equal((await one('select count(*)::int n from qq_accounts')).n,0);
    await assert.rejects(db.query("select * from submit_song('越权','歌手',$1,'forged-openid')",[period]),/permission denied/);
    for (const action of ['like','unlike']) await assert.rejects(db.query('select * from toggle_song_like($1,$2,$3,$4)',[legacy,period,'forged-openid',action]),/permission denied/);
    for (const action of ['dislike','undislike']) await assert.rejects(db.query("select * from toggle_song_dislike($1,$2,$3,$4,'理由')",[legacy,period,'forged-openid',action]),/permission denied/);
    await assert.rejects(db.query("select * from get_my_likes($1,'legacy-visitor')",[period]),/permission denied/);
    await assert.rejects(participate(),/permission denied/);
    await assert.rejects(db.query("insert into song_likes(song_id,user_id,voter_cookie,playlist_date) values($1,'forged','forged',$2)",[legacy,period]),/permission denied|row-level security/);
  }
  await role('service_role');
  assert.equal((await one("select qq_participate('1905775107','_health_probe_','','','votes',null) result")).result.error,'period_unavailable');
  await db.exec('reset role');assert.equal((await one('select count(*)::int n from qq_accounts')).n,0,'Readiness checks must not create users');
  await role('service_role');
  assert.deepEqual(await participate(),{likes:[],dislikes:[]},'Legacy browser votes must not be claimed by a QQ account');
  const created=await participate({operation:'submit',title:'QQ投稿',artist:'歌手'});assert(created.id);
  let r=await participate({operation:'like',song:created.id,action:'on'});assert.equal(r.liked,true);
  r=await participate({operation:'like',song:created.id,action:'on'});assert.equal(r.likes_count,1,'Repeated like must not add another vote');
  assert.deepEqual((await participate()).likes,[created.id]);
  assert.deepEqual((await participate({account:'QQ_B'})).likes,[]);
  assert.deepEqual((await participate({app:'1905775108'})).likes,[]);
  r=await participate({operation:'dislike',song:created.id,action:'on',reason:'不适合播出'});assert.equal(r.disliked,true);
  assert.deepEqual(await participate(),{likes:[],dislikes:[created.id]});
  r=await participate({operation:'dislike',song:created.id,action:'off'});assert.equal(r.disliked,false);
  await db.exec('reset role');
  const qqId=(await one("select id from qq_accounts where app_id='1905775107' and openid='QQ_A'")).id;
  assert.equal((await one('select count(*)::int n from song_likes where song_id=$1',[legacy])).n,1);
  assert.equal((await one('select created_by from songs where id=$1',[created.id])).created_by,(await one("select 'cookie:'||md5($1) actor",[qqId])).actor);
  assert.equal((await one('select reporter_cookie from song_reports where song_id=$1',[created.id])).reporter_cookie,qqId);
  assert.equal((await one('select reporter_ip from song_reports where song_id=$1',[created.id])).reporter_ip,'192.0.2.20');
  await db.query('update songs set is_locked=true where id=$1',[created.id]);
  await role('service_role');r=await participate({operation:'like',song:created.id,action:'on'});assert(r.error_message.includes('锁定'));
  await db.exec('reset role');
  assert.equal((await one('select count(*)::int n from api_request_attempts where cookie_hash=md5($1)',[qqId])).n,6,'Failed business writes must still count');
  await db.exec('update security_settings set vote_cookie_per_minute=1');
  await role('service_role');assert.equal((await participate({operation:'like',song:created.id,action:'on'})).error,'rate_limited');
  await db.exec('reset role; update security_settings set vote_cookie_per_minute=20');
  await db.query("select admin_set_test_account('tester@example.invalid',true)");
  await db.query('select admin_set_period_test_mode($1,true,false)',[period]);
  await role('service_role');
  assert.equal((await participate()).error,'test_login_required');
  assert.equal((await participate({tester:admin})).error,'test_login_required');
  const tested=await participate({operation:'submit',title:'QQ与测试双重授权',artist:'歌手',tester});assert(tested.id);
  assert.equal((await participate({operation:'like',song:tested.id,action:'on',tester})).liked,true);
  await db.exec('reset role');
  assert.equal((await one('select voter_cookie from song_likes where song_id=$1',[tested.id])).voter_cookie,tester);
  await db.query("select admin_set_test_account('tester@example.invalid',false)");
  await role('service_role');assert.equal((await participate({operation:'like',song:tested.id,action:'off',tester})).error,'test_login_required');
  await db.exec('reset role');await db.exec(read('supabase-qq-participation.sql'));
  assert.equal((await one("select id from qq_accounts where app_id='1905775107' and openid='QQ_A'")).id,qqId);
  await db.close();
  console.log('ALL QQ DATABASE CHECKS PASSED: anonymous bypass denied; public browsing; durable app/OpenID identity; vote isolation/mutual exclusion; legacy preservation; trusted IP; rate counter; locked songs; tester double authorization and revocation; repeat migration');
})().catch(error=>{console.error(error);process.exitCode=1;});
