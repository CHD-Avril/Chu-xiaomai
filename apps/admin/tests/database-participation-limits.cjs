const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite(), root = path.resolve(__dirname, '../../..');
  const one = async (sql,args=[]) => (await db.query(sql,args)).rows[0];
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email',true),'') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',auth.email()) $$;
    grant usage on schema auth to anon,authenticated;`);
  for (const file of ['supabase-schema.sql','supabase-admin-workflow.sql','supabase-database-integrity.sql','supabase-test-mode.sql','supabase-qq-participation.sql']) {
    await db.exec(fs.readFileSync(path.join(root,file),'utf8').replace('create extension if not exists pgcrypto;',''));
  }
  const admin='11111111-1111-4111-8111-111111111111', ordinary='22222222-2222-4222-8222-222222222222';
  await db.query("insert into auth.users values($1,'admin@example.invalid'),($2,'ordinary@example.invalid')",[admin,ordinary]);
  await db.query("insert into admin_users(email,user_id) values('admin@example.invalid',$1)",[admin]);
  // Isolate account quotas from the independently tested one-minute rate limits.
  await db.exec('update security_settings set vote_cookie_per_minute=1000,vote_ip_per_minute=1000,submission_cookie_per_minute=1000,submission_ip_per_minute=1000');
  async function as(role,id='',email='') {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)",[id,email]);
    await db.exec('set role '+role);
  }
  const asAdmin=()=>as('authenticated',admin,'admin@example.invalid');
  await as('anon');await assert.rejects(db.query('select * from security_settings'),/permission denied/);
  await as('authenticated',ordinary,'ordinary@example.invalid');
  assert.equal((await db.query('select * from security_settings')).rows.length,0);
  assert.equal((await db.query('update security_settings set submission_cookie_per_period=999 where id=true returning id')).rows.length,0);
  await asAdmin();
  const original=await one('select submission_cookie_per_period posts,max_likes_per_period likes from security_settings where id=true');
  const updated=(await db.query('update security_settings set submission_cookie_per_period=2,max_likes_per_period=2 where id=true and submission_cookie_per_period=$1 and max_likes_per_period=$2 returning id',[original.posts,original.likes])).rows;
  assert.equal(updated.length,1);
  assert.equal((await db.query('update security_settings set submission_cookie_per_period=5,max_likes_per_period=5 where id=true and submission_cookie_per_period=$1 and max_likes_per_period=$2 returning id',[original.posts,original.likes])).rows.length,0,'Stale settings must not overwrite another admin');
  for (const field of ['submission_cookie_per_period','max_likes_per_period']) {
    for (const value of [0,-1]) await assert.rejects(db.query('update security_settings set '+field+'=$1 where id=true',[value]),/check constraint/);
  }
  const period=(await one("select admin_create_playlist_period('额度测试一期',now()-interval '1 day',now()+interval '1 day') id")).id;
  async function act(overrides={}) {
    await as('service_role');
    const a={account:'QQ_A',operation:'votes',period,song:null,title:null,action:null,...overrides};
    return (await one("select qq_participate('1905775107',$1,'同学','',$2,$3,$4,$5,'歌手',$6) result",[a.account,a.operation,a.period,a.song,a.title,a.action])).result;
  }
  const submit=(title,account='QQ_A',target=period)=>act({operation:'submit',title,account,period:target});
  const like=(song,action='on',account='QQ_A')=>act({operation:'like',song,action,account});
  const first=(await submit('甲的第一首')).id, second=(await submit('甲的第二首')).id;
  assert(first&&second);
  assert((await submit('甲超额的第三首')).error_message.includes('本账号已达到本期投稿数量上限'));
  const third=(await submit('乙的第一首','QQ_B')).id, fourth=(await submit('乙的第二首','QQ_B')).id;
  assert(third&&fourth,'Another QQ account must have its own submission allowance');
  assert.equal((await like(first)).liked,true);assert.equal((await like(second)).liked,true);
  assert((await like(third)).error_message.includes('本账号已达到本期喜欢数量上限'));
  assert.equal((await like(first)).liked,true,'Already-liked songs are idempotent even at quota');
  assert.equal((await like(first,'off')).liked,false);
  assert.equal((await like(third)).liked,true,'Unlike releases one allowance');
  await asAdmin();await db.exec('update security_settings set submission_cookie_per_period=1,max_likes_per_period=1 where id=true');
  await db.exec('reset role');
  assert.equal((await one('select count(*)::int n from songs where period_id=$1',[period])).n,4,'Lowering submission quota must preserve songs');
  assert.equal((await one('select count(*)::int n from song_likes where period_id=$1',[period])).n,2,'Lowering like quota must preserve votes');
  assert((await submit('降低额度后新增')).error_message);
  assert((await like(fourth)).error_message);
  assert.equal((await like(second,'off')).liked,false);
  assert((await like(fourth)).error_message,'At the new quota, another like is still blocked');
  assert.equal((await like(third,'off')).liked,false);
  assert.equal((await like(fourth)).liked,true);
  assert.equal((await like(first,'on','QQ_B')).liked,true,'Likes are isolated by QQ account');
  await asAdmin();await db.exec('update security_settings set submission_cookie_per_period=3 where id=true');
  assert((await submit('提高额度后的第三首')).id);
  assert((await submit('仍然超额的第四首')).error_message);
  await asAdmin();
  const next=(await one("select admin_create_playlist_period('额度测试二期',now()-interval '1 day',now()+interval '1 day') id")).id;
  assert((await submit('新一期重新计算','QQ_A',next)).id);
  await db.close();
  console.log('ALL PARTICIPATION LIMIT CHECKS PASSED: admin-only settings; stale-write and invalid-value protection; per-QQ submission/like quotas; unlike releases allowance; lowering preserves data; raising takes effect; independent periods');
})().catch(error=>{console.error(error);process.exitCode=1;});
