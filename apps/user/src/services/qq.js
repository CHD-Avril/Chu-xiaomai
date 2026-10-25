// Same-origin backend only. AppKey and provider tokens never enter the browser.
export const qqAuthBase = (import.meta.env.VITE_QQ_AUTH_BASE || "").replace(/\/$/, "");
export const qqEnabled = Boolean(qqAuthBase);
export const QQ_USER_STORAGE_KEY = "chu_xiaomai_qq_user"; // Remove old, unverified Mock profiles.

export const qqErrorMessages = {
  config_missing: "QQ 登录服务尚未配置完成，请稍后再试。",
  invalid_state: "登录校验已失效，请从本站重新点击 QQ 登录，并允许本站 Cookie。",
  cancelled: "已取消 QQ 登录，可以随时重试。",
  provider_failed: "QQ 授权未完成，请重试；如仍失败，请检查应用审核状态、登录账号资格和回调地址。",
  qq_login_required: "请先 QQ 登录，再投稿、点喜欢或点踩。",
  test_login_required: "当前为测试期，请同时登录已授权的测试账号。",
  participation_unavailable: "投稿和投票服务暂不可用，请稍后重试。",
  period_unavailable: "征集期已变化，请刷新页面后重试。",
  invalid_request: "提交内容无效，请检查后重试。",
  invalid_origin: "请求校验失败，请从本站页面重试。",
  rate_limited: "操作过于频繁，请稍后再试。",
};

export function getQqAuthorizeUrl(returnTo, mobile = false) {
  if (!qqEnabled) throw new Error("QQ 登录暂未开放，请稍后再试。");
  const origin = new URL(returnTo).origin;
  const base = new URL(qqAuthBase, origin);
  if (base.origin !== origin || base.search || base.hash) throw new Error("QQ 登录需要配置本站的授权后端。");
  const target = new URL(`${base.href.replace(/\/$/, "")}/authorize`);
  target.searchParams.set("return_to", returnTo);
  if (mobile) target.searchParams.set("display", "mobile");
  return target.href;
}

export async function qqRequest(path, options = {}) {
  if (!qqEnabled) throw new Error("QQ 登录暂未开放，请稍后再试。");
  const base = new URL(qqAuthBase, location.origin);
  if (base.origin !== location.origin) throw new Error("QQ 登录需要配置本站的授权后端。");
  let response;
  try {
    response = await fetch(`${qqAuthBase}${path}`, {
      ...options, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("auth_unavailable");
    const data = await response.json();
    if (!response.ok || data.error) {
      throw Object.assign(new Error(qqErrorMessages[data.error] || "QQ 服务暂时不可用，请稍后重试。"), {
        code: data.error || "QQ_UNAVAILABLE", status: response.status,
      });
    }
    return data;
  } catch (error) {
    if (error.code && error.status) throw error;
    throw new Error(import.meta.env.DEV
      ? "暂时无法连接 QQ 登录服务，请确认本机授权服务已启动后重试。"
      : "QQ 登录服务暂时不可用，请稍后重试。");
  }
}
