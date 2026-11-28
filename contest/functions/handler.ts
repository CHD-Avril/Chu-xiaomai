// Contest demo gateway: verifies Supabase Auth demo accounts, then forwards
// participation to the tested qq_participate RPC with a server-only key.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEMO_APP_ID = "9000000001";
const DEMO_EMAILS = new Set(["admin@chu.demo", "judge@chu.demo", "student@chu.demo"]);
const MAX_BODY_BYTES = 8192;

type DbEnv = { url: string; key: string };
type DemoUser = { id: string; nickname: string };
type GatewayError = Error & { participationCode?: string; status?: number };

function readEnv(): DbEnv | null {
  const url = (Deno.env.get("CHU_DB_URL") || "").trim().replace(/\/$/, "");
  const key = (Deno.env.get("CHU_DB_SECRET") || "").trim();
  if (!url || !key) return null;
  return { url, key };
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function gatewayError(code: string, status = 400): GatewayError {
  return Object.assign(new Error(code), { participationCode: code, status });
}

function dbHeaders(env: DbEnv): Record<string, string> {
  const headers: Record<string, string> = { apikey: env.key, "Content-Type": "application/json" };
  if (!env.key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${env.key}`;
  return headers;
}

async function verifyUser(env: DbEnv, authorization: string | null): Promise<DemoUser | null> {
  if (!authorization || !/^Bearer [A-Za-z0-9_.-]{20,4096}$/.test(authorization)) return null;
  const response = await fetch(`${env.url}/auth/v1/user`, {
    headers: { apikey: env.key, Authorization: authorization },
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!response.ok) return null;
  const account = await response.json();
  const email = String(account?.email || "").trim().toLowerCase();
  if (!UUID.test(account?.id || "") || !DEMO_EMAILS.has(email)) return null;
  const nickname = String(account.user_metadata?.nickname || email.split("@")[0] || "演示用户").slice(0, 100);
  return { id: account.id, nickname };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw gatewayError("invalid_request");
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw gatewayError("invalid_request", 413);
  const reader = request.body?.getReader();
  if (!reader) throw gatewayError("invalid_request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw gatewayError("invalid_request", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw gatewayError("invalid_request"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw gatewayError("invalid_request");
  return body as Record<string, unknown>;
}

function participationParams(body: Record<string, unknown>): Record<string, unknown> {
  if (body.operation === "account") return { p_operation: "account" };
  if (body.operation === "read_notice") {
    if (body.noticeId != null && !UUID.test(String(body.noticeId))) throw gatewayError("invalid_request");
    return { p_operation: "read_notice", p_notice_id: body.noticeId || null };
  }
  if (!["votes", "submit", "like", "dislike"].includes(String(body.operation)) || !UUID.test(String(body.periodId || ""))) throw gatewayError("invalid_request");
  const params: Record<string, unknown> = { p_operation: body.operation, p_period_id: body.periodId };
  if (body.operation === "submit") {
    if (!UUID.test(String(body.catalogId || ""))) throw gatewayError("invalid_request");
    params.p_song_id = body.catalogId;
  } else if (body.operation === "like" || body.operation === "dislike") {
    if (!UUID.test(String(body.songId || "")) || !["on", "off"].includes(String(body.action))) throw gatewayError("invalid_request");
    params.p_song_id = body.songId;
    params.p_action = body.action;
    if (body.operation === "dislike" && body.action === "on") {
      if (typeof body.reason !== "string" || !body.reason.trim() || [...body.reason.trim()].length > 20) throw gatewayError("invalid_request");
      params.p_reason = (body.reason as string).trim();
    }
  }
  return params;
}

async function participate(env: DbEnv, user: DemoUser, body: Record<string, unknown>, params: Record<string, unknown>): Promise<unknown> {
  const openid = `DEMO_${user.id}`;
  if (body.operation === "account" || body.operation === "read_notice") {
    const rpc = body.operation === "account" ? "qq_account_status" : "qq_read_account_notice";
    const response = await fetch(`${env.url}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: dbHeaders(env),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
      body: JSON.stringify({
        p_app_id: DEMO_APP_ID, p_openid: openid, p_nickname: user.nickname, p_avatar: "",
        ...(body.operation === "read_notice" ? { p_notice_id: params.p_notice_id } : {}),
      }),
    });
    if (!response.ok) throw gatewayError("participation_unavailable", 503);
    return response.json();
  }
  const response = await fetch(`${env.url}/rest/v1/rpc/qq_participate`, {
    method: "POST",
    headers: dbHeaders(env),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
    body: JSON.stringify({
      ...params, p_app_id: DEMO_APP_ID, p_openid: openid,
      p_nickname: user.nickname, p_avatar: "", p_test_user_id: user.id, p_client_ip: null,
    }),
  });
  if (!response.ok) throw gatewayError("participation_unavailable", 503);
  return response.json();
}

export async function handler(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  const env = readEnv();
  try {
    if (request.method === "GET" && path.endsWith("/participation-health")) {
      if (!env) return json(503, { ok: false });
      const response = await fetch(`${env.url}/rest/v1/rpc/qq_participate`, {
        method: "POST",
        headers: dbHeaders(env),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
        body: JSON.stringify({ p_app_id: DEMO_APP_ID, p_openid: "_health_probe_", p_nickname: "", p_avatar: "", p_operation: "votes", p_period_id: null }),
      });
      const ok = response.ok && (await response.json()).error === "period_unavailable";
      return json(ok ? 200 : 503, { ok });
    }
    if (request.method === "GET" && path.endsWith("/health")) {
      return json(env ? 200 : 503, { ok: Boolean(env), mode: "demo", configured: Boolean(env), revision: "contest" });
    }
    if (request.method === "GET" && path.endsWith("/session")) {
      const user = env ? await verifyUser(env, request.headers.get("authorization")) : null;
      return json(200, {
        user: user ? { openid: `DEMO_${user.id}`, nickname: user.nickname, avatar: "" } : null,
        mode: "demo", configured: Boolean(env),
      });
    }
    if (request.method === "POST" && path.endsWith("/logout")) return json(200, { ok: true });
    if (request.method === "POST" && path.endsWith("/participate")) {
      if (!env) return json(503, { error: "participation_unavailable" });
      const user = await verifyUser(env, request.headers.get("authorization"));
      if (!user) return json(401, { error: "qq_login_required" });
      const body = await readBody(request);
      const params = participationParams(body);
      return json(200, await participate(env, user, body, params));
    }
    return json(404, { error: "not_found" });
  } catch (error) {
    const gateway = error as GatewayError;
    return json(gateway.status || 503, { error: gateway.participationCode || "participation_unavailable" });
  }
}