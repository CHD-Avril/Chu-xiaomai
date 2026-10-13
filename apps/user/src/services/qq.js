// QQ 登录配置
// Mock 模式：VITE_QQ_AUTH_BASE=http://localhost:3000（指向 mock-qq/server.mjs）
// 真实模式：VITE_QQ_AUTH_BASE 指向实现 /qq/authorize、/qq/token、/qq/me 的自有后端。
// 不能直接使用 graph.qq.com；AppKey 和腾讯 token 交换必须保留在后端。
export const qqAuthBase = import.meta.env.VITE_QQ_AUTH_BASE || "";
export const qqEnabled = Boolean(qqAuthBase);
export const QQ_USER_STORAGE_KEY = "chu_xiaomai_qq_user";
