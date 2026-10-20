// Read-only deployment check: does not submit QQ credentials or approve consent.
import { pathToFileURL } from "node:url";

export async function checkQqLogin(origin, fetchImpl = fetch) {
  const base = new URL(origin);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("只填写站点的协议、域名和端口。");
  const request = (path) => fetchImpl(new URL(path, base), { redirect: "manual", signal: AbortSignal.timeout(10000) });
  const health = await request("/qq/health");
  if (!health.ok || !health.headers.get("Content-Type")?.includes("application/json")) throw new Error("/qq/health 未返回健康 JSON：请安装授权后端及 Nginx /qq/ 代理。");
  const status = await health.json();
  if (!status.ok || status.mode !== "real" || !status.configured || !status.revision) throw new Error("授权服务必须使用已配置的真实模式。");
  const session = await request("/qq/session");
  if (!session.ok || !session.headers.get("Content-Type")?.includes("application/json")) throw new Error("/qq/session 未返回会话 JSON。");
  const sessionData = await session.json();
  if (sessionData.mode !== "real" || !sessionData.configured) throw new Error("会话接口尚未准备好。");
  const returnTo = `${base.origin}/#/playlist`;
  const authorize = await request(`/qq/authorize?return_to=${encodeURIComponent(returnTo)}`);
  if (authorize.status !== 302) throw new Error("QQ 授权入口没有返回 302 跳转。");
  const target = new URL(authorize.headers.get("location"));
  if (target.origin !== "https://graph.qq.com" || target.pathname !== "/oauth2.0/authorize" || target.searchParams.get("response_type") !== "code" || !/^\d+$/.test(target.searchParams.get("client_id") || "") || target.searchParams.get("redirect_uri") !== `${base.origin}/qq/callback` || !/^[0-9a-f]{64}$/.test(target.searchParams.get("state") || "") || target.searchParams.get("scope") !== "get_user_info") {
    throw new Error("授权地址的 AppID、回调、state 或 scope 配置不完整。");
  }
  const cookie = authorize.headers.getSetCookie().find((value) => value.startsWith("chu_qq_state="));
  if (!cookie || !cookie.includes("HttpOnly") || !cookie.includes("SameSite=Lax") || (base.protocol === "https:" && !cookie.includes("Secure"))) throw new Error("授权 state Cookie 设置不完整。");
  if (target.searchParams.has("client_secret") || target.searchParams.has("access_token")) throw new Error("授权链接不得包含密钥或令牌。");
  return { revision: status.revision, appId: target.searchParams.get("client_id"), callback: target.searchParams.get("redirect_uri") };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await checkQqLogin(process.argv[2] || "https://chuxiaomai.cyou");
    console.log(`QQ 授权入口已就绪：AppID ${result.appId}，版本 ${result.revision}，回调 ${result.callback}`);
    console.log("仍需使用允许的 QQ 账号人工验证扫码、回调、昵称展示和退出。");
  } catch (error) {
    console.error(`QQ 登录检查失败：${error.cause?.code || error.message}`);
    process.exitCode = 1;
  }
}
