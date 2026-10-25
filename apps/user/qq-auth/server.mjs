import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

const FLOW_TTL = 10 * 60 * 1000;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const STATE_COOKIE = "chu_qq_state";
const SESSION_COOKIE = "chu_qq_session";
const randomId = () => randomBytes(32).toString("hex");
const mockProfiles = [
  { openid: "MOCK_OPENID_AVRIL_0001", nickname: "小麦君测试号", avatar: "" },
  { openid: "MOCK_OPENID_STU_0002", nickname: "长大同学A", avatar: "" },
  { openid: "MOCK_OPENID_STU_0003", nickname: "长大同学B", avatar: "" },
];

export function readConfig(env = process.env) {
  const mode = env.QQ_AUTH_MODE || "real";
  if (!["real", "mock"].includes(mode)) throw new Error("QQ_AUTH_MODE 只能是 real 或 mock。");
  const frontend = new URL(env.QQ_FRONTEND_ORIGIN || "http://localhost:5173");
  const callback = new URL(env.QQ_REDIRECT_URI || `${frontend.origin}/qq/callback`);
  if (![frontend, callback].every((url) => ["http:", "https:"].includes(url.protocol) && !url.username && !url.password)) {
    throw new Error("QQ 前端和回调地址必须是 HTTP(S) 地址。");
  }
  if (frontend.pathname !== "/" || frontend.search || frontend.hash) throw new Error("QQ_FRONTEND_ORIGIN 只填写协议、域名和端口。");
  if (callback.origin !== frontend.origin || callback.pathname !== "/qq/callback" || callback.search || callback.hash) {
    throw new Error("QQ_REDIRECT_URI 必须是 QQ_FRONTEND_ORIGIN 下的 /qq/callback，以绑定同站 Cookie。");
  }
  const port = Number(env.QQ_AUTH_PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("QQ_AUTH_PORT 无效。");
  const appId = (env.QQ_APP_ID || "").trim(), appKey = (env.QQ_APP_KEY || "").trim();
  const databaseUrl = (env.SUPABASE_URL || "").trim();
  const databaseKey = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (databaseUrl) {
    const url = new URL(databaseUrl);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      !(url.protocol === "https:" || (env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
      throw new Error("SUPABASE_URL 必须是数据库服务的 HTTPS 源地址，本地开发可使用回环 HTTP 地址。");
    }
  }
  if (databaseKey && !databaseKey.startsWith("sb_secret_")) {
    let role;
    try { role = JSON.parse(Buffer.from(databaseKey.split(".")[1], "base64url")).role; } catch { /* Reject public keys. */ }
    if (role !== "service_role") throw new Error("QQ 投稿和投票后端需要 Supabase Secret key 或 service_role key，不能使用公开的 anon key。");
  }
  if (appId && !/^\d+$/.test(appId)) throw new Error("QQ_APP_ID 必须是 QQ 互联分配的数字 AppID。");
  if (env.NODE_ENV === "production" && (mode !== "real" || !appId || !appKey || frontend.protocol !== "https:")) {
    throw new Error("生产 QQ 登录必须配置真实 AppID、AppKey 和 HTTPS 前端/回调地址，禁止使用模拟模式。");
  }
  return {
    mode, port, frontendOrigin: frontend.origin, redirectUri: callback.href,
    appId, appKey, databaseUrl: databaseUrl ? new URL(databaseUrl).origin : "", databaseKey,
    revision: env.QQ_AUTH_REVISION || "local",
    secure: frontend.protocol === "https:",
  };
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map((part) => {
    const index = part.indexOf("=");
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
}

function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookie(name, value, maxAge, secure) {
  return `${name}=${value}; Path=/qq; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function safeReturnTo(value, origin) {
  const url = new URL(value || "/", origin);
  if (url.origin !== origin || url.username || url.password || url.pathname.startsWith("/qq") || /[\r\n\\]/.test(value || "")) {
    throw new Error("invalid_return_to");
  }
  url.searchParams.delete("qq_error");
  return url.href;
}

// QQ historically returns JSON, JSONP or form encoding. Never execute JSONP.
export function parseQqResponse(text) {
  const value = text.trim();
  if (value.startsWith("{")) return JSON.parse(value);
  const jsonp = /^callback\s*\(\s*(\{[\s\S]*\})\s*\)\s*;?$/.exec(value);
  if (jsonp) return JSON.parse(jsonp[1]);
  if (value.includes("=")) return Object.fromEntries(new URLSearchParams(value));
  throw new Error("invalid_qq_response");
}

function safeAvatar(profile) {
  for (const value of [profile.figureurl_qq_2, profile.figureurl_qq_1, profile.figureurl_2, profile.figureurl]) {
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol) && (url.hostname === "qlogo.cn" || url.hostname.endsWith(".qlogo.cn"))) {
        url.protocol = "https:";
        return url.href;
      }
    } catch { /* Try the next avatar size. */ }
  }
  return "";
}

function participationError(code, status = 400) {
  return Object.assign(new Error(code), { participationCode: code, status });
}

async function readJsonBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) throw participationError("invalid_request");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw participationError("invalid_request", 413);
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw participationError("invalid_request"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw participationError("invalid_request");
  return body;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function participationParams(body) {
  if (body.operation === "account") return { p_operation: "account" };
  if (body.operation === "read_notice") {
    if (body.noticeId != null && !uuidPattern.test(body.noticeId)) throw participationError("invalid_request");
    return { p_operation: "read_notice", p_notice_id: body.noticeId || null };
  }
  if (!["votes", "submit", "like", "dislike"].includes(body.operation) || !uuidPattern.test(body.periodId || "")) throw participationError("invalid_request");
  const params = { p_operation: body.operation, p_period_id: body.periodId };
  if (body.operation === "submit") {
    for (const field of ["title", "artist"]) {
      if (typeof body[field] !== "string" || !body[field].trim() || [...body[field].trim()].length > 80) throw participationError("invalid_request");
      params[`p_${field}`] = body[field].trim();
    }
  } else if (["like", "dislike"].includes(body.operation)) {
    if (!uuidPattern.test(body.songId || "") || !["on", "off"].includes(body.action)) throw participationError("invalid_request");
    params.p_song_id = body.songId;
    params.p_action = body.action;
    if (body.operation === "dislike" && body.action === "on") {
      if (typeof body.reason !== "string" || !body.reason.trim() || [...body.reason.trim()].length > 20) throw participationError("invalid_request");
      params.p_reason = body.reason.trim();
    }
  }
  // No client-provided OpenID, voter cookie, user ID or test-account ID is trusted.
  return params;
}

export function createQqServer(config, { fetchImpl = fetch, now = Date.now } = {}) {
  const flows = new Map();
  const sessions = new Map();
  const mockCodes = new Map();
  const configured = config.mode === "mock" || Boolean(config.appId && config.appKey);
  const setCookie = (name, value, maxAge) => cookie(name, value, maxAge, config.secure);
  const allowedHosts = new Set([new URL(config.frontendOrigin).host, `127.0.0.1:${config.port}`, `localhost:${config.port}`]);

  async function qqRequest(path, params) {
    const url = new URL(path, "https://graph.qq.com");
    url.search = new URLSearchParams(params).toString();
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!response.ok) throw new Error("qq_unavailable");
    const data = parseQqResponse(await response.text());
    if (data.error !== undefined || (data.ret !== undefined && Number(data.ret) !== 0)) throw new Error("qq_rejected");
    return data;
  }

  async function getProfile(code) {
    if (config.mode === "mock") {
      const record = mockCodes.get(code);
      mockCodes.delete(code);
      if (!record || record.expiresAt <= now()) throw new Error("invalid_code");
      return { user: record.user, ttl: SESSION_TTL };
    }
    const token = await qqRequest("/oauth2.0/token", {
      grant_type: "authorization_code", client_id: config.appId, client_secret: config.appKey,
      code, redirect_uri: config.redirectUri, fmt: "json",
    });
    const expiresIn = Number(token.expires_in);
    if (!token.access_token || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("invalid_token");
    const identity = await qqRequest("/oauth2.0/me", { access_token: token.access_token, fmt: "json" });
    if (!identity.openid || String(identity.client_id) !== config.appId) throw new Error("invalid_openid");
    const profile = await qqRequest("/user/get_user_info", {
      access_token: token.access_token, oauth_consumer_key: config.appId, openid: identity.openid,
    });
    return {
      user: { openid: identity.openid, nickname: String(profile.nickname || "QQ 用户").slice(0, 100), avatar: safeAvatar(profile) },
      ttl: Math.min(expiresIn * 1000, SESSION_TTL),
    };
  }

  async function participate(user, body, req) {
    const params = participationParams(body);
    // Mock QQ accounts must never write to the production database.
    if (config.mode !== "real" || !config.databaseUrl || !config.databaseKey) throw participationError("participation_unavailable", 503);
    const headers = { apikey: config.databaseKey, "Content-Type": "application/json" };
    // New Secret keys are sent as apikey only; legacy service_role keys are JWTs.
    if (!config.databaseKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${config.databaseKey}`;
    if (["account", "read_notice"].includes(body.operation)) {
      const isAccount = body.operation === "account";
      const response = await fetchImpl(new URL(`/rest/v1/rpc/${isAccount ? "qq_account_status" : "qq_read_account_notice"}`, config.databaseUrl), {
        method: "POST", headers, signal: AbortSignal.timeout(10000), redirect: "error",
        body: JSON.stringify({ p_app_id: config.appId, p_openid: user.openid,
          ...(isAccount ? { p_nickname: user.nickname, p_avatar: user.avatar } : { p_notice_id: params.p_notice_id }) }),
      });
      if (!response.ok) throw participationError("participation_unavailable", 503);
      return response.json();
    }
    let testUserId = null;
    if (req.headers.authorization) {
      if (!/^Bearer [A-Za-z0-9_.-]{20,4096}$/.test(req.headers.authorization)) throw participationError("test_login_required", 403);
      const response = await fetchImpl(new URL("/auth/v1/user", config.databaseUrl), {
        headers: { apikey: config.databaseKey, Authorization: req.headers.authorization },
        signal: AbortSignal.timeout(10000), redirect: "error",
      });
      if (!response.ok) throw participationError("test_login_required", 403);
      const account = await response.json();
      if (!uuidPattern.test(account.id || "")) throw participationError("test_login_required", 403);
      testUserId = account.id;
    }
    const response = await fetchImpl(new URL("/rest/v1/rpc/qq_participate", config.databaseUrl), {
      method: "POST", headers, signal: AbortSignal.timeout(10000), redirect: "error",
      body: JSON.stringify({ ...params, p_app_id: config.appId, p_openid: user.openid,
        p_nickname: user.nickname, p_avatar: user.avatar, p_test_user_id: testUserId,
        p_client_ip: ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) && isIP(req.headers["x-real-ip"] || "")
          ? req.headers["x-real-ip"] : null }),
    });
    // Never forward raw database errors or credentials to the browser.
    if (!response.ok) throw participationError("participation_unavailable", 503);
    const result = await response.json();
    return result;
  }

  // A null period exits the database gateway before creating an account or
  // recording any attempts. This checks server credentials and RPC permission.
  let readiness;
  async function participationReady() {
    if (config.mode !== "real" || !config.databaseUrl || !config.databaseKey) return false;
    if (!readiness || readiness.expiresAt <= now()) {
      const headers = { apikey: config.databaseKey, "Content-Type": "application/json" };
      if (!config.databaseKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${config.databaseKey}`;
      readiness = { expiresAt: now() + 10000, result: (async () => {
        try {
          const response = await fetchImpl(new URL("/rest/v1/rpc/qq_participate", config.databaseUrl), {
            method: "POST", headers, signal: AbortSignal.timeout(10000), redirect: "error",
            body: JSON.stringify({ p_app_id: config.appId, p_openid: "_health_probe_", p_nickname: "", p_avatar: "", p_operation: "votes", p_period_id: null }),
          });
          if (!response.ok || (await response.json()).error !== "period_unavailable") return false;
          const moderation = await fetchImpl(new URL("/rest/v1/rpc/qq_moderation_health", config.databaseUrl), {
            method: "POST", headers, signal: AbortSignal.timeout(10000), redirect: "error", body: "{}",
          });
          return moderation.ok && (await moderation.json()).ok === true;
        } catch { return false; }
      })() };
    }
    return readiness.result;
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      if (!allowedHosts.has(req.headers.host)) return json(res, 403, { error: "invalid_host" });
      // No CORS: access these routes through the same-origin Vite proxy.
      if (req.headers.origin && req.headers.origin !== config.frontendOrigin) return json(res, 403, { error: "invalid_origin" });
      const url = new URL(req.url, config.frontendOrigin);
      for (const map of [flows, sessions, mockCodes]) {
        for (const [key, value] of map) if (value.expiresAt <= now()) map.delete(key);
      }
      const requestCookies = cookies(req);
      if (req.method === "GET" && url.pathname === "/qq/health") {
        return json(res, configured ? 200 : 503, { ok: configured, mode: config.mode, configured, revision: config.revision });
      }
      if (req.method === "GET" && url.pathname === "/qq/participation-health") {
        const ok = await participationReady();
        return json(res, ok ? 200 : 503, { ok });
      }
      if (req.method === "GET" && url.pathname === "/qq/session") {
        const session = sessions.get(requestCookies[SESSION_COOKIE]);
        if (!session && requestCookies[SESSION_COOKIE]) res.setHeader("Set-Cookie", setCookie(SESSION_COOKIE, "", 0));
        return json(res, 200, { user: session?.user || null, mode: config.mode, configured });
      }
      if (req.method === "POST" && url.pathname === "/qq/logout") {
        if (req.headers.origin !== config.frontendOrigin) return json(res, 403, { error: "invalid_origin" });
        sessions.delete(requestCookies[SESSION_COOKIE]);
        flows.delete(requestCookies[STATE_COOKIE]);
        res.setHeader("Set-Cookie", [setCookie(SESSION_COOKIE, "", 0), setCookie(STATE_COOKIE, "", 0)]);
        return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/qq/participate") {
        if (req.headers.origin !== config.frontendOrigin) return json(res, 403, { error: "invalid_origin" });
        const session = sessions.get(requestCookies[SESSION_COOKIE]);
        if (!session) {
          res.setHeader("Set-Cookie", setCookie(SESSION_COOKIE, "", 0));
          return json(res, 401, { error: "qq_login_required" });
        }
        try {
          const body = await readJsonBody(req);
          const result = await participate(session.user, body, req);
          return json(res, 200, result);
        } catch (error) {
          return json(res, error.status || 503, { error: error.participationCode || "participation_unavailable" });
        }
      }
      if (req.method === "GET" && url.pathname === "/qq/authorize") {
        let returnTo;
        try { returnTo = safeReturnTo(url.searchParams.get("return_to"), config.frontendOrigin); }
        catch { return json(res, 400, { error: "invalid_return_to" }); }
        if (!configured) {
          const target = new URL(returnTo);
          target.searchParams.set("qq_error", "config_missing");
          return redirect(res, target.href);
        }
        // Bound memory and replace a browser's unfinished flow.
        if (flows.size >= 1000) return json(res, 429, { error: "too_many_logins" });
        flows.delete(requestCookies[STATE_COOKIE]);
        const state = randomId();
        flows.set(state, { returnTo, expiresAt: now() + FLOW_TTL });
        res.setHeader("Set-Cookie", setCookie(STATE_COOKIE, state, FLOW_TTL / 1000));
        const target = new URL(config.mode === "mock" ? "/qq/mock" : "https://graph.qq.com/oauth2.0/authorize", config.frontendOrigin);
        target.search = new URLSearchParams({ response_type: "code", client_id: config.appId, redirect_uri: config.redirectUri, state, scope: "get_user_info" }).toString();
        if (url.searchParams.get("display") === "mobile") target.searchParams.set("display", "mobile");
        return redirect(res, target.href);
      }
      if (req.method === "GET" && url.pathname === "/qq/callback") {
        const state = url.searchParams.get("state");
        const flow = flows.get(state);
        // Validate both the server record and the initiating browser's cookie, before any QQ request.
        if (!flow || !sameSecret(state, requestCookies[STATE_COOKIE])) {
          const target = new URL(config.frontendOrigin);
          target.searchParams.set("qq_error", "invalid_state");
          return redirect(res, target.href);
        }
        flows.delete(state); // Every callback is single use, including failures.
        res.setHeader("Set-Cookie", setCookie(STATE_COOKIE, "", 0));
        const target = new URL(flow.returnTo);
        if (url.searchParams.has("error") || !url.searchParams.get("code")) {
          target.searchParams.set("qq_error", "cancelled");
          return redirect(res, target.href);
        }
        try {
          const { user, ttl } = await getProfile(url.searchParams.get("code"));
          if (sessions.size >= 10000) throw new Error("too_many_sessions");
          sessions.delete(requestCookies[SESSION_COOKIE]);
          const id = randomId();
          const maxAge = Math.floor(ttl / 1000);
          sessions.set(id, { user, expiresAt: now() + maxAge * 1000 });
          res.setHeader("Set-Cookie", [setCookie(STATE_COOKIE, "", 0), setCookie(SESSION_COOKIE, id, maxAge)]);
        } catch {
          // Do not expose provider errors: they may contain codes, tokens or AppKey.
          target.searchParams.set("qq_error", "provider_failed");
        }
        return redirect(res, target.href);
      }
      if (config.mode === "mock" && req.method === "GET" && url.pathname === "/qq/mock") {
        const state = url.searchParams.get("state");
        if (!flows.has(state) || !sameSecret(state, requestCookies[STATE_COOKIE])) return json(res, 400, { error: "invalid_state" });
        const links = mockProfiles.map((profile, index) => `<a href="/qq/mock/confirm?state=${state}&amp;account=${index}">${profile.nickname}</a>`).join("");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QQ 登录 · 本地模拟</title><style>body{background:#f4f7fb;color:#12325b;font:16px system-ui;display:grid;place-items:center;min-height:95vh}main{background:white;padding:32px;border-radius:20px;max-width:360px}h1{font-size:22px}p{line-height:1.7;color:#63738a}a{display:block;padding:16px;margin-top:12px;border:1px solid #d7e1ef;border-radius:12px;color:#1558cf;text-decoration:none}</style><main><h1>QQ 登录（本地模拟）</h1><p>此页面仅验证登录流程，选择的是模拟账号。真实 QQ 登录需要配置 AppID、AppKey 和登记的回调地址。</p>${links}<a href="/qq/callback?state=${state}&amp;error=access_denied">取消登录</a></main></html>`);
      }
      if (config.mode === "mock" && req.method === "GET" && url.pathname === "/qq/mock/confirm") {
        const state = url.searchParams.get("state");
        const index = url.searchParams.get("account");
        if (!flows.has(state) || !sameSecret(state, requestCookies[STATE_COOKIE]) || !/^[0-2]$/.test(index || "")) return json(res, 400, { error: "invalid_mock_request" });
        if (mockCodes.size >= 1000) return json(res, 429, { error: "too_many_logins" });
        const code = randomId();
        mockCodes.set(code, { user: mockProfiles[Number(index)], expiresAt: now() + FLOW_TTL });
        const target = new URL(config.redirectUri);
        target.search = new URLSearchParams({ code, state }).toString();
        return redirect(res, target.href);
      }
      return json(res, 404, { error: "not_found" });
    } catch {
      return json(res, 500, { error: "auth_server_error" });
    }
  });
  server.requestTimeout = 15000;
  return server;
}
