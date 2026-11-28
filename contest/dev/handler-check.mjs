import assert from "node:assert/strict";

const UID = "33333333-3333-4333-8333-333333333333";
const PERIOD = "11111111-1111-4111-8111-111111111111";
const SONG = "22222222-2222-4222-8222-222222222222";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.demo-token-value-0123456789";
const OUTSIDER_TOKEN = "eyJhbGciOiJIUzI1NiJ9.outsider-token-value-0123456789";

let envMap = {};
let rpcStatus = 200;
const calls = [];
globalThis.Deno = { env: { get: (name) => envMap[name] } };
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ url, body, headers: options.headers });
  if (url.endsWith("/auth/v1/user")) {
    if (options.headers?.Authorization === `Bearer ${TOKEN}`) {
      return Response.json({ id: UID, email: "judge@chu.demo", user_metadata: { nickname: "评委同学" } });
    }
    if (options.headers?.Authorization === `Bearer ${OUTSIDER_TOKEN}`) {
      return Response.json({ id: UID, email: "outsider@example.com", user_metadata: { nickname: "外部账号" } });
    }
    return Response.json({ message: "invalid" }, { status: 401 });
  }
  if (url.endsWith("/rpc/qq_participate")) {
    if (rpcStatus !== 200) return Response.json({ message: "db down" }, { status: rpcStatus });
    if (body.p_period_id === null) return Response.json({ error: "period_unavailable" });
    return Response.json({ error_code: null, error_message: null, echo: body });
  }
  if (url.endsWith("/rpc/qq_account_status")) return Response.json({ id: SONG, unread_count: 0, notices: [] });
  if (url.endsWith("/rpc/qq_read_account_notice")) return Response.json({ ok: true });
  throw new Error(`unexpected fetch ${url}`);
};

const { handler } = await import("../functions/handler.ts");
const req = (path, { method = "GET", token, body, headers = {} } = {}) => handler(new Request(`https://demo.qoder.zone/functions/v1/app${path}`, {
  method,
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...headers,
  },
  body: body !== undefined ? JSON.stringify(body) : undefined,
}));

// 1. Unconfigured fails closed.
envMap = {};
assert.equal((await req("/health")).status, 503);
assert.equal((await req("/participate", { method: "POST", body: { operation: "votes", periodId: PERIOD } })).status, 503);
assert.deepEqual(await (await req("/session")).json(), { user: null, mode: "demo", configured: false });

// 2. Configured session mapping.
envMap = { CHU_DB_URL: "https://demo.supabase.co", CHU_DB_SECRET: "sb_secret_demo" };
assert.equal((await req("/health")).status, 200);
let data = await (await req("/session")).json();
assert.equal(data.user, null);
data = await (await req("/session", { token: TOKEN })).json();
assert.equal(data.user.openid, `DEMO_${UID}`);
assert.equal(data.user.nickname, "评委同学");
assert.equal((await (await req("/session", { token: "bad" })).json()).user, null);
assert.equal((await (await req("/session", { token: OUTSIDER_TOKEN })).json()).user, null, "confirmed non-demo accounts are rejected");

// 3. Participation requires a verified demo account.
assert.equal((await req("/participate", { method: "POST", body: { operation: "votes", periodId: PERIOD } })).status, 401);
assert.equal((await req("/participate", { method: "POST", token: OUTSIDER_TOKEN, body: { operation: "votes", periodId: PERIOD } })).status, 401);

// 4. Votes gateway params.
calls.length = 0;
let res = await req("/participate", { method: "POST", token: TOKEN, body: { operation: "votes", periodId: PERIOD, openid: "HACKED" } });
assert.equal(res.status, 200);
let echo = (await res.json()).echo;
assert.equal(echo.p_openid, `DEMO_${UID}`);
assert.equal(echo.p_test_user_id, UID);
assert.equal(echo.p_app_id, "9000000001");
assert.equal(echo.p_client_ip, null);
assert.equal(echo.p_operation, "votes");

// 5. Submit / like / dislike validation.
res = await req("/participate", { method: "POST", token: TOKEN, body: { operation: "submit", periodId: PERIOD, catalogId: SONG } });
assert.equal((await res.json()).echo.p_song_id, SONG);
assert.equal((await req("/participate", { method: "POST", token: TOKEN, body: { operation: "submit", periodId: PERIOD, catalogId: "nope" } })).status, 400);
res = await req("/participate", { method: "POST", token: TOKEN, body: { operation: "like", periodId: PERIOD, songId: SONG, action: "on" } });
assert.equal((await res.json()).echo.p_action, "on");
assert.equal((await req("/participate", { method: "POST", token: TOKEN, body: { operation: "dislike", periodId: PERIOD, songId: SONG, action: "on" } })).status, 400);
res = await req("/participate", { method: "POST", token: TOKEN, body: { operation: "dislike", periodId: PERIOD, songId: SONG, action: "on", reason: "不适合播出" } });
assert.equal((await res.json()).echo.p_reason, "不适合播出");
assert.equal((await req("/participate", { method: "POST", token: TOKEN, body: { operation: "votes", periodId: "x" } })).status, 400);

// 6. Account and notice operations.
calls.length = 0;
res = await req("/participate", { method: "POST", token: TOKEN, body: { operation: "account" } });
assert.equal(res.status, 200);
assert(calls.some(c => c.url.endsWith("/rpc/qq_account_status")));
assert.equal((await req("/participate", { method: "POST", token: TOKEN, body: { operation: "read_notice", noticeId: "bad" } })).status, 400);

// 7. Routing and methods.
assert.equal((await req("/participate")).status, 404);
assert.equal((await req("/nope")).status, 404);
assert.equal((await req("/session", { method: "OPTIONS" })).status, 404);
assert.equal((await handler(new Request(`https://demo.qoder.zone/functions/v1/physical123/session`))).status, 200);
assert.equal((await req("/logout", { method: "POST" })).status, 200);

// 8. Upstream failure, content type and oversized bodies.
assert.equal((await req("/participate", { method: "POST", token: TOKEN, body: { operation: "votes", periodId: PERIOD }, headers: { "Content-Type": "text/plain" } })).status, 400);
assert.equal((await req("/participate", { method: "POST", token: TOKEN, body: { operation: "votes", periodId: PERIOD }, headers: { "Content-Length": "9000" } })).status, 413);
rpcStatus = 500;
assert.equal((await req("/participate", { method: "POST", token: TOKEN, body: { operation: "votes", periodId: PERIOD } })).status, 503);
rpcStatus = 200;
assert.equal((await req("/participate", { method: "POST", token: TOKEN, body: { operation: "votes", periodId: PERIOD, pad: "x".repeat(9000) } })).status, 413);
const streamRequest = new Request("https://demo.qoder.zone/functions/v1/app/participate", {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  duplex: "half",
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ operation: "votes", periodId: PERIOD, pad: "x".repeat(9000) })));
      controller.close();
    },
  }),
});
streamRequest.headers.delete("content-length");
assert.equal((await handler(streamRequest)).status, 413);

// 9. Health probe.
assert.equal((await req("/participation-health")).status, 200);

console.log("handler checks passed");