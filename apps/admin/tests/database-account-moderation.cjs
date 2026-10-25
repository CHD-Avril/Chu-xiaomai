const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
  const db=new PGlite(),root=path.resolve(__dirname,'../../..');
  const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
  const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace('create extension if not exists pgcrypto;','');
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email',true),'') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',auth.email()) $$;
    grant usage on schema auth to anon,authenticated;`);
  for(const f of ['supabase-schema.sql','supabase-admin-workflow.sql','supabase-database-integrity.sql','supabase-test-mode.sql','supabase-qq-participation.sql','supabase-account-moderation.sql','supabase-account-moderation.sql'])await db.exec(read(f));
  const admin='11111111-1111-4111-8111-111111111111',ordinary='22222222-2222-4222-8222-222222222222';
  await db.query("insert into auth.users values($1,'admin@example.invalid'),($2,'ordinary@example.invalid')",[admin,ordinary]);
  await db.query("insert into admin_users(email,user_id) values('admin@example.invalid',$1)",[admin]);
  await db.exec('update security_settings set vote_cookie_per_minute=1000,vote_ip_per_minute=1000,submission_cookie_per_minute=1000,submission_ip_per_minute=1000');
  async function as(role,id='',email=''){
    await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)",[id,email]);await db.exec('set role '+role);
  }
  const asAdmin=()=>as('authenticated',admin,'admin@example.invalid');
  async function status(openid='QQ_A'){
    await as('service_role');return (await one("select qq_account_status('1905775107',$1,'同学','') result",[openid])).result;
  }
  const a=await status(),b=await status('QQ_B');
  assert.equal(a.unread_count,0);assert.equal(a.moderation.banned,false);
  await asAdmin();const period=(await one("select admin_create_playlist_period('处分验收',now()-interval '1 day',now()+interval '1 day') id")).id;
  const list=(await one("select admin_list_qq_accounts('',0,20) result")).result;assert.equal(list.total,2);assert(!JSON.stringify(list).includes('QQ_A'),'Do not expose OpenID in account directory');
  async function act(operation,extra={}){
    await as('service_role');const x={openid:'QQ_A',song:null,title:'账号投稿',action:'on',...extra};
    return (await one("select qq_participate('1905775107',$1,'同学','',$2,$3,$4,$5,'歌手',$6,'理由') result",[x.openid,operation,period,x.song,x.title,x.action])).result;
  }
  async function moderate(action,{hours=null,reason='处理原因',version}={}){
    await asAdmin();const current=(await one('select admin_get_account_moderation($1) result',[a.id])).result;
    return db.query('select admin_moderate_account($1,$2,$3,$4,$5)',[a.id,action,reason,hours,version??current.moderation.version]);
  }
  for(const [role,id,email] of [['anon','',''],['authenticated',ordinary,'ordinary@example.invalid']]){
    await as(role,id,email);
    await assert.rejects(db.query("select admin_moderate_account($1,'ban','伪造',null,0)",[a.id]),/Admin permission|permission denied/);
    await assert.rejects(db.query("select admin_list_qq_accounts('',0,20)"),/Admin permission|permission denied/);
    await assert.rejects(db.query("select qq_account_status('1905775107','QQ_A','伪造','')"),/permission denied/);
    await assert.rejects(db.query("insert into account_moderation(account_id,ban_until) values($1,'infinity')",[a.id]),/permission denied/);
  }
  await moderate('warn');let s=await status();assert.equal(s.unread_count,1);assert.equal(s.notices[0].reason,'处理原因');assert(!JSON.stringify(s).includes('admin@example.invalid'));
  const warning=s.notices[0].id;
  const song=(await act('submit')).id;assert(song,'Warning must not block participation');
  await moderate('restrict_vote',{hours:24});
  assert.equal((await act('like',{song})).error,'voting_restricted');
  assert((await act('submit',{title:'仅限投票仍可投稿'})).id);
  assert.deepEqual((await act('votes')).likes,[]);
  assert.equal((await act('like',{song,openid:'QQ_B'})).liked,true,'Restrictions must target only one site account');
  await moderate('restrict_submission',{hours:72});assert.equal((await act('submit',{title:'禁止新增'})).error,'submission_restricted');
  await moderate('lift_vote');assert.equal((await act('like',{song})).liked,true);assert.equal((await act('submit',{title:'投稿限制仍存在'})).error,'submission_restricted');
  await moderate('ban',{hours:24});
  assert.equal((await act('like',{song,action:'off'})).error,'account_banned');assert.equal((await act('submit',{title:'封禁新增'})).error,'account_banned');
  assert((await act('votes')).likes.includes(song),'Banned users can still inspect their own state');
  await moderate('unban');assert.equal((await act('like',{song,action:'off'})).liked,false);assert.equal((await act('submit',{title:'解除封禁保留独立限制'})).error,'submission_restricted');
  await moderate('lift_submission');assert((await act('submit',{title:'恢复投稿'})).id);
  await moderate('ban');assert.equal((await status()).moderation.ban_until,null,'Permanent ban uses an explicit active flag with no expiry');
  await db.exec('reset role');await db.query("update account_moderation set ban_until=clock_timestamp()-interval '1 second' where account_id=$1",[a.id]);
  assert.equal((await status()).moderation.banned,false,'Expiry uses database time without a scheduled job');
  assert.equal((await act('like',{song})).liked,true);
  await as('service_role');assert.equal((await one("select qq_read_account_notice('1905775107','QQ_B',$1) result",[warning])).result.error,'notice_not_found');
  assert.equal((await one("select qq_read_account_notice('1905775107','QQ_A',$1) result",[warning])).result.ok,true);
  s=await status();assert(s.notices.find(n=>n.id===warning).is_read);assert.equal(s.id,a.id);
  await as('service_role');await db.exec("select qq_read_account_notice('1905775107','QQ_A',null)");assert.equal((await status()).unread_count,0);
  await assert.rejects(moderate('warn',{reason:'  '}),/处理原因/);
  await assert.rejects(moderate('ban',{hours:0}),/时长/);
  await assert.rejects(moderate('warn',{version:0}),/其他管理员修改/);
  await asAdmin();const detail=(await one('select admin_get_account_moderation($1) result',[a.id])).result;
  assert(detail.actions.every(x=>x.actor_name==='admin@example.invalid'));assert.equal(detail.actions.length,8);
  await assert.rejects(db.query("update account_moderation_actions set reason='篡改' where account_id=$1",[a.id]),/permission denied/);
  await db.exec('reset role');assert.equal((await one("select count(*)::int n from admin_action_log where action like 'account_%'")).n,detail.actions.length);
  await db.exec(read('supabase-account-moderation.sql'));await as('service_role');assert.equal((await one('select qq_moderation_health() result')).result.ok,true);
  await db.exec('reset role');await db.exec(read('supabase-qq-participation.sql'));await as('service_role');assert.equal((await one('select qq_moderation_health() result')).result.ok,false,'Reapplying the unguarded migration must make readiness fail');
  await db.exec('reset role');await db.exec(read('supabase-account-moderation.sql'));assert.equal((await status()).id,a.id);
  await db.close();console.log('ALL ACCOUNT MODERATION CHECKS PASSED: administrator-only actions; immutable reason/actor audit; independent restrictions; bans/unbans; expiry; own-only notices; stale-admin protection; persistent identity and guarded readiness');
})().catch(e=>{console.error(e);process.exitCode=1;});
