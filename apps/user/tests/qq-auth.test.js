import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { createQqServer, readConfig, parseQqResponse } from "../qq-auth/server.mjs";
import { checkQqLogin } from "../../../scripts/check-qq-login.mjs";

async function setup(t, { env = {}, fetchImpl, now } = {}) {
  const config = readConfig({ QQ_AUTH_MODE: "real", ...env });
  const server = createQqServer(config, { fetchImpl, now });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const jar = new Map();
  const request = async (path, { method = "GET", cookies = jar, origin, host = new URL(config.frontendOrigin).host, body, extraHeaders = {} } = {}) => {
    const headers = { host, cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join(";") };
    if (origin !== undefined) headers.origin = origin;
    Object.assign(headers, extraHeaders);
    if (body !== undefined) headers["content-type"] = "application/json";
    const url = new URL(path, config.frontendOrigin);
    // node:http preserves the explicit Host header for the same-origin proxy test.
    const response = await new Promise((resolve, reject) => {
      const outgoing = httpRequest({ hostname: "127.0.0.1", port: server.address().port, path: url.pathname + url.search, method, headers }, (incoming) => {
        const chunks = [];
        incoming.on("data", (chunk) => chunks.push(chunk));
        incoming.on("end", () => {
          const responseHeaders = new Headers();
          for (let index = 0; index < incoming.rawHeaders.length; index += 2) responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
          resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers: responseHeaders }));
        });
        incoming.on("error", reject);
      });
      outgoing.on("error", reject);
      outgoing.end(body === undefined ? undefined : JSON.stringify(body));
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [name, value] = cookie.split(";")[0].split("=");
      if (value) cookies.set(name, value); else cookies.delete(name);
    }
    return response;
  };
  const authorize = async (returnTo = "/#/playlist?song=kept") => {
    const response = await request(`/qq/authorize?return_to=${encodeURIComponent(returnTo)}`);
    assert.equal(response.status, 302);
    return new URL(response.headers.get("location"));
  };
  return { request, authorize, jar, config };
}

test("config defaults to real, enforces same-site callback, parses QQ formats without executing JS", () => {
  assert.equal(readConfig({}).mode, "real");
  assert.throws(() => readConfig({ QQ_AUTH_MODE: "automatic" }));
  assert.throws(() => readConfig({ QQ_REDIRECT_URI: "https://other.example/qq/callback" }));
  assert.throws(() => readConfig({ QQ_FRONTEND_ORIGIN: "https://user:pass@example.com" }));
  assert.deepEqual(parseQqResponse('callback( {"openid":"id"} );'), { openid: "id" });
  assert.deepEqual(parseQqResponse('{"ret":0}'), { ret: 0 });
  assert.deepEqual(parseQqResponse("access_token=secret&expires_in=60"), { access_token: "secret", expires_in: "60" });
  assert.throws(() => parseQqResponse('callback({});process.exit()'));
});

test("participation requires a verified QQ session, binds identity on server and rejects expired/logout/forged requests", async (t) => {
  let timestamp = 1000000;
  const databaseCalls = [];
  let databaseFailure = false;
  const secret = "sb_secret_test_backend_only";
  const { request, authorize, config } = await setup(t, {
    now: () => timestamp,
    env: { QQ_APP_ID: "1905775107", QQ_APP_KEY: "qq-test-private", SUPABASE_URL: "https://database.example", SUPABASE_SECRET_KEY: secret },
    fetchImpl: async (url, options) => {
      if (url.host === "graph.qq.com") {
        if (url.pathname.endsWith("/token")) return Response.json({ access_token: "provider-private", expires_in: 60 });
        if (url.pathname.endsWith("/me")) return Response.json({ client_id: "1905775107", openid: "VERIFIED_QQ_A" });
        return Response.json({ ret: 0, nickname: "QQ同学" });
      }
      assert.equal(url.origin, "https://database.example");
      assert.equal(options.headers.apikey, secret);
      if (url.pathname === "/auth/v1/user") {
        if (options.headers.Authorization === "Bearer valid-tester-token-123456789") return Response.json({ id: "22222222-2222-4222-8222-222222222222" });
        return Response.json({ message: "Invalid JWT" }, { status: 401 });
      }
      assert.equal(url.pathname, "/rest/v1/rpc/qq_participate");
      assert.equal(options.headers.Authorization, undefined, "Secret keys are not bearer JWTs");
      const body = JSON.parse(options.body);
      databaseCalls.push(body);
      if (databaseFailure) return Response.json({ message: `sensitive:${secret}` }, { status: 403 });
      return Response.json({ likes: [], dislikes: [] });
    },
  });
  const periodId = "11111111-1111-4111-8111-111111111111";
  const body = { operation: "votes", periodId, openid: "FORGED_QQ", voterCookie: "forged", p_test_user_id: periodId, clientIp: "203.0.113.66" };
  const post = (overrides = {}) => request("/qq/participate", { method: "POST", origin: config.frontendOrigin, body, ...overrides });
  assert.equal((await post()).status, 401);
  assert.equal((await post({ cookies: new Map([["chu_qq_session", "forged"]]) })).status, 401);
  assert.equal(databaseCalls.length, 0);
  const login = async () => {
    const target = await authorize();
    await request(`/qq/callback?state=${target.searchParams.get("state")}&code=test-code`);
  };
  await login();
  assert.equal((await post({ origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ origin: undefined })).status, 403);
  assert.equal((await post({ body: { ...body, operation: "anything" } })).status, 400);
  assert.equal((await post({ body: { ...body, periodId: "invalid" } })).status, 400);
  assert.equal(databaseCalls.length, 0);
  assert.equal((await post()).status, 200);
  assert.equal(databaseCalls[0].p_openid, "VERIFIED_QQ_A");
  assert.equal(databaseCalls[0].p_app_id, "1905775107");
  assert.equal(databaseCalls[0].p_test_user_id, null);
  assert.equal(databaseCalls[0].p_client_ip, null, "Browser JSON must not set the trusted peer IP");
  assert.equal((await post({ extraHeaders: { "x-real-ip": "192.0.2.5", authorization: "Bearer valid-tester-token-123456789" } })).status, 200);
  assert.equal(databaseCalls.at(-1).p_test_user_id, "22222222-2222-4222-8222-222222222222");
  assert.equal(databaseCalls.at(-1).p_client_ip, "192.0.2.5");
  assert.equal((await post({ extraHeaders: { authorization: "Bearer expired-tester-token-123456789" } })).status, 403);
  databaseFailure = true;
  const failure = await post();
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), { error: "participation_unavailable" });
  timestamp += 61000;
  assert.equal((await post()).status, 401);
  await login();
  await request("/qq/logout", { method: "POST", origin: config.frontendOrigin });
  assert.equal((await post()).status, 401);
});

test("participation never uses public database keys or allows Mock QQ to reach a database", async (t) => {
  const anonKey = `unused.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.unused`;
  assert.throws(() => readConfig({ SUPABASE_SECRET_KEY: anonKey }), /anon key/);
  assert.throws(() => readConfig({ NODE_ENV: "production", SUPABASE_URL: "http://database.example" }), /HTTPS/);
  const legacyKey = `unused.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.unused`;
  assert.equal(readConfig({ SUPABASE_SERVICE_ROLE_KEY: legacyKey }).databaseKey, legacyKey);
  const { request, authorize, config } = await setup(t, {
    env: { QQ_AUTH_MODE: "mock", SUPABASE_URL: "https://database.example", SUPABASE_SECRET_KEY: "sb_secret_never_used" },
    fetchImpl: async () => { throw new Error("Mock must never make a database call"); },
  });
  const target = await authorize();
  const confirm = await request(`/qq/mock/confirm?state=${target.searchParams.get("state")}&account=0`);
  await request(confirm.headers.get("location"));
  const response = await request("/qq/participate", { method: "POST", origin: config.frontendOrigin,
    body: { operation: "votes", periodId: "11111111-1111-4111-8111-111111111111" } });
  assert.equal(response.status, 503);
});

test("participation readiness checks server credentials with a non-writing null-period probe and hides upstream failures", async (t) => {
  let calls = 0;
  const { request } = await setup(t, { env: { QQ_APP_ID: "1905775107", QQ_APP_KEY: "qq-test", SUPABASE_URL: "https://database.example", SUPABASE_SECRET_KEY: "sb_secret_health_only" },
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url.pathname, "/rest/v1/rpc/qq_participate");
      assert.equal(JSON.parse(options.body).p_period_id, null);
      assert.equal(JSON.parse(options.body).p_operation, "votes");
      return Response.json({ error: "period_unavailable" });
    } });
  assert.equal((await request("/qq/participation-health")).status, 200);
  assert.deepEqual(await (await request("/qq/participation-health")).json(), { ok: true });
  assert.equal(calls, 1, "Cache probes briefly to avoid repeated provider requests");
  const unavailable = await setup(t);
  assert.equal((await unavailable.request("/qq/participation-health")).status, 503);
  const failed = await setup(t, { env: { QQ_APP_ID: "1905775107", QQ_APP_KEY: "qq-test", SUPABASE_URL: "https://database.example", SUPABASE_SECRET_KEY: "sb_secret_health_only" },
    fetchImpl: async () => Response.json({message:"sensitive-details"},{status:401}) });
  const response = await failed.request("/qq/participation-health");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {ok:false});
});

test("production refuses missing credentials, HTTP, invalid AppID and Mock", () => {
  const env = { NODE_ENV: "production", QQ_APP_ID: "123456", QQ_APP_KEY: "test-secret", QQ_FRONTEND_ORIGIN: "https://chuxiaomai.cyou" };
  assert.equal(readConfig(env).mode, "real");
  for (const overrides of [{ QQ_AUTH_MODE: "mock" }, { QQ_APP_ID: "" }, { QQ_APP_KEY: " " }, { QQ_APP_ID: "not-an-id" }, { QQ_FRONTEND_ORIGIN: "http://chuxiaomai.cyou" }]) {
    assert.throws(() => readConfig({ ...env, ...overrides }));
  }
});

test("deployment probe verifies real backend health, session and complete QQ authorization redirect", async (t) => {
  const { request, config } = await setup(t, { env: { QQ_APP_ID: "123456", QQ_APP_KEY: "test-secret", QQ_FRONTEND_ORIGIN: "https://chuxiaomai.cyou", QQ_AUTH_REVISION: "fixture-revision" } });
  const result = await checkQqLogin(config.frontendOrigin, (url) => request(url));
  assert.deepEqual(result, { revision: "fixture-revision", appId: "123456", callback: "https://chuxiaomai.cyou/qq/callback" });
  await assert.rejects(() => checkQqLogin(config.frontendOrigin, async () => new Response("<!doctype html>SPA fallback", { headers: { "Content-Type": "text/html" } })), /health/);
  const unconfigured = await setup(t);
  assert.equal((await unconfigured.request("/qq/health")).status, 503);
  await assert.rejects(() => checkQqLogin(config.frontendOrigin, (url) => unconfigured.request(url)), /health/);
});

test("unconfigured real mode never falls back to fake accounts; blocks open redirects and foreign origins", async (t) => {
  const { request } = await setup(t);
  assert.deepEqual(await (await request("/qq/session")).json(), { user: null, mode: "real", configured: false });
  assert.equal((await request("/qq/mock")).status, 404);
  for (const target of ["https://evil.example", "//evil.example", "/qq/callback", "https://user@localhost:5173/"]) {
    assert.equal((await request(`/qq/authorize?return_to=${encodeURIComponent(target)}`)).status, 400);
  }
  assert.equal((await request("/qq/session", { origin: "https://evil.example" })).status, 403);
  assert.equal((await request("/qq/session", { host: "evil.example" })).status, 403);
  const response = await request("/qq/authorize");
  assert.equal(new URL(response.headers.get("location")).searchParams.get("qq_error"), "config_missing");
});

test("mock goes through callback, restores a server session, preserves page, and invalidates logout", async (t) => {
  const { request, authorize, jar, config } = await setup(t, { env: { QQ_AUTH_MODE: "mock" } });
  const target = await authorize();
  const state = target.searchParams.get("state");
  const confirmation = await request(`/qq/mock/confirm?state=${state}&account=1`);
  const callback = confirmation.headers.get("location");
  const completed = await request(callback);
  assert.equal(completed.headers.get("location"), "http://localhost:5173/#/playlist?song=kept");
  assert.match(completed.headers.getSetCookie().join(";"), /HttpOnly/);
  assert.match(completed.headers.getSetCookie().join(";"), /SameSite=Lax/);
  const sessionCookie = new Map(jar);
  const profile = await (await request("/qq/session")).json();
  assert.equal(profile.user.nickname, "长大同学A");
  assert.equal(profile.mode, "mock");
  assert.equal((await request("/qq/logout", { method: "POST" })).status, 403);
  assert.equal((await request("/qq/logout", { method: "POST", origin: config.frontendOrigin })).status, 200);
  assert.equal((await (await request("/qq/session", { cookies: sessionCookie })).json()).user, null);
  assert.equal(new URL((await request(callback)).headers.get("location")).searchParams.get("qq_error"), "invalid_state");
});

test("real QQ exchanges code only on server, checks client id, normalizes profile and never leaks secrets", async (t) => {
  const calls = [];
  const appKey = "test-only-private-key";
  const { request, authorize } = await setup(t, {
    env: { QQ_APP_ID: "123456", QQ_APP_KEY: appKey, QQ_FRONTEND_ORIGIN: "https://chuxiaomai.cyou" },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.pathname.endsWith("/token")) {
        assert.equal(url.searchParams.get("client_secret"), appKey);
        assert.equal(url.searchParams.get("redirect_uri"), "https://chuxiaomai.cyou/qq/callback");
        return new Response("access_token=private-token&expires_in=60&refresh_token=private-refresh");
      }
      if (url.pathname.endsWith("/me")) return new Response('callback({"client_id":"123456","openid":"verified-id"});');
      assert.equal(url.searchParams.get("oauth_consumer_key"), "123456");
      assert.equal(url.searchParams.get("openid"), "verified-id");
      return Response.json({ ret: 0, nickname: "真实流程测试", figureurl_qq_2: "http://q.qlogo.cn/qqapp/test/100" });
    },
  });
  const target = await authorize();
  assert.equal(target.origin, "https://graph.qq.com");
  assert.equal(target.searchParams.get("scope"), "get_user_info");
  const state = target.searchParams.get("state");
  const callback = await request(`/qq/callback?code=one-use-code&state=${state}`);
  assert.equal(calls.length, 3);
  assert.match(callback.headers.getSetCookie().join(";"), /Secure/);
  const session = await (await request("/qq/session")).text();
  assert.equal(JSON.parse(session).user.avatar, "https://q.qlogo.cn/qqapp/test/100");
  for (const secret of [appKey, "private-token", "private-refresh", "one-use-code"]) {
    assert(!session.includes(secret));
    assert(!JSON.stringify([...callback.headers]).includes(secret));
  }
});

test("state must match initiating browser, expires, and is consumed on cancellation", async (t) => {
  let time = 1000;
  let qqCalls = 0;
  const { request, authorize } = await setup(t, {
    env: { QQ_APP_ID: "123", QQ_APP_KEY: "secret" }, now: () => time,
    fetchImpl: async () => { qqCalls++; throw new Error("Should not contact QQ"); },
  });
  const target = await authorize();
  const state = target.searchParams.get("state");
  const callback = `/qq/callback?code=forged&state=${state}`;
  assert.equal(new URL((await request(callback, { cookies: new Map() })).headers.get("location")).searchParams.get("qq_error"), "invalid_state");
  const cancel = await request(`/qq/callback?state=${state}&error=access_denied`);
  assert.equal(new URL(cancel.headers.get("location")).searchParams.get("qq_error"), "cancelled");
  assert.equal(new URL((await request(callback)).headers.get("location")).searchParams.get("qq_error"), "invalid_state");
  const next = await authorize();
  time += 10 * 60 * 1000 + 1;
  const expired = await request(`/qq/callback?code=old&state=${next.searchParams.get("state")}`);
  assert.equal(new URL(expired.headers.get("location")).searchParams.get("qq_error"), "invalid_state");
  assert.equal(qqCalls, 0);
});

test("expired sessions are cleared and logout cancels unfinished login", async (t) => {
  let time = 1000;
  const { request, authorize, config } = await setup(t, { env: { QQ_AUTH_MODE: "mock" }, now: () => time });
  const target = await authorize();
  const confirmation = await request(`/qq/mock/confirm?state=${target.searchParams.get("state")}&account=0`);
  await request(confirmation.headers.get("location"));
  time += 7 * 24 * 60 * 60 * 1000 + 1;
  const response = await request("/qq/session");
  assert.equal((await response.json()).user, null);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  const next = await authorize();
  await request("/qq/logout", { method: "POST", origin: config.frontendOrigin });
  assert.equal(new URL((await request(`/qq/callback?state=${next.searchParams.get("state")}&code=old`)).headers.get("location")).searchParams.get("qq_error"), "invalid_state");
});

test("QQ rejection, invalid client, transport errors and unsafe avatars never create a false session", async (t) => {
  for (const failure of ["rejected", "client", "network", "profile"]) {
    const { request, authorize } = await setup(t, {
      env: { QQ_APP_ID: "123", QQ_APP_KEY: "secret" },
      fetchImpl: async (url) => {
        if (failure === "network") throw new Error("secret-token-secret-key");
        if (failure === "rejected") return Response.json({ error: 100001, error_description: "private-error" });
        if (url.pathname.endsWith("/token")) return Response.json({ access_token: "secret-token", expires_in: 60 });
        if (url.pathname.endsWith("/me")) return Response.json({ client_id: failure === "client" ? "wrong" : "123", openid: "id" });
        return Response.json({ ret: 1002, msg: "not authorized" });
      },
    });
    const target = await authorize();
    const result = await request(`/qq/callback?state=${target.searchParams.get("state")}&code=test`);
    assert.equal(new URL(result.headers.get("location")).searchParams.get("qq_error"), "provider_failed");
    assert.equal((await (await request("/qq/session")).json()).user, null);
    assert(!result.headers.get("location").includes("secret"));
  }
});
