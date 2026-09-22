// 访客身份标识（Cookie）管理 —— 从旧 app.js 迁移
// 后续 QQ 登录落地后，此模块升级为"登录 token 优先，Cookie 兜底"。

const VISITOR_COOKIE_NAME = "chu_xiaomai_voter_id";
const LEGACY_VISITOR_STORAGE_KEY = "chu_xiaomai_visitor_id";

export function getCookieValue(name) {
  return (
    document.cookie
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ""
  );
}

export function setVoterCookie(value) {
  const maxAge = 60 * 60 * 24 * 365;
  const secureFlag = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${VISITOR_COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secureFlag}`;
}

export function getOrCreateVisitorId() {
  const existingId = getCookieValue(VISITOR_COOKIE_NAME);
  if (existingId) return existingId;

  const legacyId = localStorage.getItem(LEGACY_VISITOR_STORAGE_KEY);
  const nextId =
    legacyId ||
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `visitor_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  setVoterCookie(nextId);
  if (getCookieValue(VISITOR_COOKIE_NAME) !== nextId) {
    throw new Error("浏览器必须允许本站 Cookie 后才能投票，请关闭无痕/禁用 Cookie 模式后重试。");
  }
  localStorage.setItem(LEGACY_VISITOR_STORAGE_KEY, nextId);
  return nextId;
}
