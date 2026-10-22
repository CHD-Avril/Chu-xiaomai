import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

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
  if (appId && !/^\d+$/.test(appId)) throw new Error("QQ_APP_ID 必须是 QQ 互联分配的数字 AppID。");
  if (env.NODE_ENV === "production" && (mode !== "real" || !appId || !appKey || frontend.protocol !== "https:")) {
    throw new Error("生产 QQ 登录必须配置真实 AppID、AppKey 和 HTTPS 前端/回调地址，禁止使用模拟模式。");
  }
  return {
    mode, port, frontendOrigin: frontend.origin, redirectUri: callback.href,
    appId, appKey, revision: env.QQ_AUTH_REVISION || "local",
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
