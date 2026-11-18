// 本地预览：静态 contest/web + 同源 /functions/v1/app 网关（与线上路由一致）。
// 可选：在 contest/.env.contest.local 写 CHU_DB_URL / CHU_DB_SECRET（勿提交、勿外传）。
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const webRoot = join(root, "web");
const port = Number(process.env.PORT || 4173);

const localEnv = join(root, ".env.contest.local");
if (existsSync(localEnv)) {
  for (const line of readFileSync(localEnv, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
globalThis.Deno = { env: { get: (name) => process.env[name] } };
const { handler } = await import("../functions/handler.ts");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp", ".gif": "image/gif",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
};

async function serveFunction(req, res, pathname) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[key] = value;
  }
  delete headers.host; delete headers.connection;
  const request = new Request(`http://localhost:${port}${pathname}`, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
  });
  const response = await handler(request);
  const payload = Buffer.from(await response.arrayBuffer());
  const outHeaders = {};
  response.headers.forEach((value, key) => { outHeaders[key] = value; });
  res.writeHead(response.status, outHeaders);
  res.end(payload);
}

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
    if (pathname.startsWith("/functions/v1/")) return await serveFunction(req, res, pathname);
    let filePath = resolve(webRoot, "." + pathname);
    if (!filePath.startsWith(webRoot + sep) && filePath !== webRoot) { res.writeHead(403); return res.end("Forbidden"); }
    if (pathname === "/") filePath = join(webRoot, "index.html");
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("404 Not Found（目录索引已禁用，管理端请用 /admin/index.html）"); }
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(String(error?.message || error));
  }
});

server.listen(port, () => {
  console.log(`本地预览: http://localhost:${port}/`);
  console.log(`管理端:   http://localhost:${port}/admin/index.html`);
  console.log(`网关:     http://localhost:${port}/functions/v1/app/health`);
  console.log(process.env.CHU_DB_URL ? "已读取本地演示库配置。" : "未配置 CHU_DB_URL：投稿/登录网关返回 503，前端 Supabase 为占位值（等待演示库）。");
});