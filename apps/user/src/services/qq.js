// QQ 登录配置
// Mock 模式：VITE_QQ_AUTH_BASE=http://localhost:3000（指向 mock-qq/server.mjs）
// 真实模式：VITE_QQ_AUTH_BASE=https://graph.qq.com，且 token 交换需由后端完成
export const qqAuthBase = import.meta.env.VITE_QQ_AUTH_BASE || "";
export const qqEnabled = Boolean(qqAuthBase);
export const QQ_USER_STORAGE_KEY = "chu_xiaomai_qq_user";
