import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "vite";

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
