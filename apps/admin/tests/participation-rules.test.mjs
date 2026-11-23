import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "vite";

test('daily collection API sends date/time and exact version, and explains a missing migration', async () => {
  const originalFetch = globalThis.fetch;
  const calls = []; let server, missing = false;
  globalThis.fetch = async (input, options = {}) => {
    assert.equal(new URL(String(input)).pathname, '/rest/v1/rpc/admin_prepare_daily_period');
    calls.push(JSON.parse(options.body));
    return missing ? Response.json({ code: 'PGRST202', message: 'function missing' }, { status: 404 }) : Response.json({ id: 'new-id', created: true });
  };
  try {
    server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: { server: createHttpServer() } }, appType: 'custom' });
    const api = await server.ssrLoadModule('/src/services/api.js');
    const updatedAt = '2026-11-06T10:00:00.123456+00:00';
    const current = api.normalizePeriod({ id: 'old-id', updated_at: updatedAt });
    const draft = { date: '2026-11-07', title: ' 11月7日歌单征集 ', startTime: '00:00', endTime: '18:00' };
    assert.deepEqual(await api.prepareDailyPeriod(draft, current), { id: 'new-id', created: true });
    assert.deepEqual(calls[0], { p_target_date: '2026-11-07', p_title: '11月7日歌单征集', p_start_time: '00:00', p_end_time: '18:00', p_expected_current_id: 'old-id', p_expected_updated_at: updatedAt });
    await api.prepareDailyPeriod(draft, null);
    assert.equal(calls[1].p_expected_current_id, null); assert.equal(calls[1].p_expected_updated_at, null);
    missing = true;
    await assert.rejects(api.prepareDailyPeriod(draft, current), /supabase-daily-period.sql/);
  } finally { globalThis.fetch = originalFetch; await server?.close(); }
});

test("participation settings API reads actual values, updates only quotas, prevents stale writes and surfaces permission failures", async () => {
  const originalFetch=globalThis.fetch;
  let server, denied=false;
  let settings={submission_cookie_per_period:10,max_likes_per_period:20,vote_ip_per_minute:120};
  const calls=[];
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(String(input));
    assert.equal(url.pathname,"/rest/v1/security_settings");
    calls.push({url,options});
    if(denied)return Response.json({code:"42501",message:"permission denied"},{status:403});
    if(options.method==="PATCH") {
      const change=JSON.parse(options.body);
      assert.deepEqual(Object.keys(change).sort(),["max_likes_per_period","submission_cookie_per_period","updated_at"]);
      assert.equal(url.searchParams.get("id"),"eq.true");
      if(url.searchParams.get("submission_cookie_per_period")!==`eq.${settings.submission_cookie_per_period}` ||
        url.searchParams.get("max_likes_per_period")!==`eq.${settings.max_likes_per_period}`)return Response.json(null);
      settings={...settings,...change};
    }
    return Response.json({submission_cookie_per_period:settings.submission_cookie_per_period,max_likes_per_period:settings.max_likes_per_period});
  };
  try {
    server=await createServer({root:fileURLToPath(new URL("..",import.meta.url)),server:{middlewareMode:true,hmr:{server:createHttpServer()}},appType:"custom"});
    const api=await server.ssrLoadModule("/src/services/api.js");
    const original=await api.fetchParticipationLimits();assert.deepEqual(original,{submissions:10,likes:20});
    assert.deepEqual(await api.saveParticipationLimits({submissions:3,likes:5},original),{submissions:3,likes:5});
    assert.equal(settings.vote_ip_per_minute,120,"Other anti-cheat settings must be preserved");
    await assert.rejects(api.saveParticipationLimits({submissions:6,likes:7},original),/其他管理员修改/);
    const count=calls.length;
    for(const bad of [0,-1,1.5,NaN,2147483648,undefined])await assert.rejects(api.saveParticipationLimits({submissions:bad,likes:5},{submissions:3,likes:5}),/整数/);
    assert.equal(calls.length,count,"Invalid forms must not issue writes");
    denied=true;await assert.rejects(api.fetchParticipationLimits(),error=>error.code==="42501");
    await assert.rejects(api.saveParticipationLimits({submissions:4,likes:5},{submissions:3,likes:5}),error=>error.code==="42501");
  } finally {globalThis.fetch=originalFetch;await server?.close();}
});

test("account moderation API sends explicit target, reason and expected version without trusting client actor fields", async () => {
  const originalFetch=globalThis.fetch;
  const calls=[];let server;
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(String(input));const body=JSON.parse(options.body);calls.push({name:url.pathname.split('/').at(-1),body});
    if(url.pathname.endsWith('/admin_list_qq_accounts'))return Response.json({items:[],total:0});
    if(url.pathname.endsWith('/admin_get_account_moderation'))return Response.json({account:{id:body.p_account_id},moderation:{version:3},actions:[]});
    assert(url.pathname.endsWith('/admin_moderate_account'));
    return new Response(null,{status:204});
  };
  try {
    server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:{server:createHttpServer()}},appType:'custom'});
    const api=await server.ssrLoadModule('/src/services/api.js');
    await api.fetchQqAccounts(' 同学 ',2);assert.deepEqual(calls.at(-1).body,{p_search:'同学',p_offset:20,p_limit:20});
    const id='11111111-1111-4111-8111-111111111111';await api.fetchAccountModeration(id);assert.equal(calls.at(-1).body.p_account_id,id);
    await api.moderateAccount({accountId:id,action:'ban',reason:'  违规刷票  ',durationHours:24,expectedVersion:3,actorId:'forged'});
    assert.deepEqual(calls.at(-1).body,{p_account_id:id,p_action:'ban',p_reason:'违规刷票',p_duration_hours:24,p_expected_version:3});
  } finally {globalThis.fetch=originalFetch;await server?.close();}
});
