// Mock QQ 互联授权服务器（本地开发环境专用）
//
// 真实 QQ 登录需要：QQ 互联 appid/secret + 已备案公网域名（回调地址必须公网可访问），
// 本地开发无法直连，因此用本服务模拟完整授权流程：
//   1. GET  /qq/authorize?redirect_uri=...&state=...   → 模拟 QQ 登录页（选择测试账号）
//   2. GET  /qq/confirm?redirect_uri=...&state=...&account=0 → 302 跳回 redirect_uri?code=...&state=...
//   3. POST /qq/token  { code }                        → { access_token, expires_in }
//   4. GET  /qq/me?access_token=...                    → { openid, nickname, figureurl }
//
// 前端通过 VITE_QQ_AUTH_BASE=http://localhost:3000 指向本服务；
// 真实环境切换：VITE_QQ_AUTH_BASE 指向 QQ 互联接口，token 交换需由后端完成（见《开发计划.md》）。
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 3000);

const codes = new Map(); // code -> access_token
const tokens = new Map(); // access_token -> profile

const MOCK_PROFILES = [
  { openid: "MOCK_OPENID_AVRIL_0001", nickname: "小麦君测试号", figureurl: "" },
  { openid: "MOCK_OPENID_STU_0002", nickname: "长大同学A", figureurl: "" },
  { openid: "MOCK_OPENID_STU_0003", nickname: "长大同学B", figureurl: "" },
];

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}

function renderLoginPage(redirectUri, state) {
  const items = MOCK_PROFILES.map(
    (profile, index) => `
      <a class="account" href="/qq/confirm?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&account=${index}">
        <span class="avatar">${htmlEscape(profile.nickname.slice(0, 1))}</span>
        <span>
          <strong>${htmlEscape(profile.nickname)}</strong>
          <small>${htmlEscape(profile.openid)}</small>
        </span>
      </a>`,
  ).join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>QQ 登录（Mock）</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#fbfdff,#eef4fd);font-family:"Manrope","Noto Sans SC",sans-serif}
  .box{width:min(92vw,420px);background:#fff;border-radius:20px;box-shadow:0 24px 54px rgba(24,73,150,.14);padding:32px 28px}
  h1{font-size:1.3rem;margin:0 0 4px;color:#0a2b57}
  p.sub{color:#738198;font-size:.84rem;margin:0 0 20px}
  .account{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid rgba(18,81,175,.12);border-radius:14px;margin-bottom:10px;text-decoration:none;color:#0a2b57;transition:border-color .2s,transform .2s}
  .account:hover{border-color:#1558cf;transform:translateY(-1px)}
  .avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#1558cf,#4f86ec);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800}
  strong{display:block;font-size:.92rem}
  small{color:#738198;font-size:.72rem}
  .note{margin-top:16px;color:#738198;font-size:.76rem;line-height:1.6}
</style>
</head>
<body>
  <div class="box">
    <h1>QQ 登录（本地模拟）</h1>
    <p class="sub">选择任意一个测试账号，模拟 QQ 授权</p>
    ${items}
    <p class="note">这是 Mock QQ 互联服务器，用于本地联调登录流程。真实环境将跳转腾讯 QQ 互联授权页。</p>
  </div>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  if (method === "GET" && path === "/qq/authorize") {
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderLoginPage(redirectUri, state));
    return;
  }

  if (method === "GET" && path === "/qq/confirm") {
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const account = Number(url.searchParams.get("account")) || 0;
    const profile = MOCK_PROFILES[account] ?? MOCK_PROFILES[0];

    const code = `mock_${crypto.randomBytes(6).toString("hex")}`;
    const accessToken = `mock_token_${crypto.randomBytes(8).toString("hex")}`;
    codes.set(code, accessToken);
    tokens.set(accessToken, profile);

    const sep = redirectUri.includes("?") ? "&" : "?";
    const location = `${redirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    res.writeHead(302, { Location: location });
    res.end();
    return;
  }

  if (method === "POST" && path === "/qq/token") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { code } = JSON.parse(body || "{}");
        const accessToken = codes.get(code);
        if (!accessToken) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "invalid code" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ access_token: accessToken, expires_in: 7776000 }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "bad request" }));
      }
    });
    return;
  }

  if (method === "GET" && path === "/qq/me") {
    const accessToken = url.searchParams.get("access_token") ?? "";
    const profile = tokens.get(accessToken);
    if (!profile) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "invalid access_token" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(profile));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`[mock-qq] 本地 QQ 授权服务器已启动: http://localhost:${PORT}`);
  console.log(`[mock-qq] 授权入口示例: http://localhost:${PORT}/qq/authorize?redirect_uri=http://localhost:5173&state=demo`);
});
