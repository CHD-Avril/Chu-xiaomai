// Loopback-only gateway for the isolated test browser. No DNS/hosts/cloud changes.
import https from "node:https";
import http from "node:http";
import net from "node:net";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readConfig } from "./server.mjs";

const envFile = fileURLToPath(new URL(".env.local", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const config = readConfig();
const origin = new URL(config.frontendOrigin);
if (origin.protocol !== "https:" || origin.port || origin.hostname !== "chuxiaomai.cyou") {
  throw new Error("本地 HTTPS 网关只用于 https://chuxiaomai.cyou；请核对 qq-auth/.env.local。");
}
const directory = fileURLToPath(new URL(".tls.local/", import.meta.url));
mkdirSync(directory, { recursive: true });
const keyPath = `${directory}/key.pem`, certPath = `${directory}/cert.pem`;
const openssl = [process.env.QQ_OPENSSL_PATH, "C:/Program Files/Git/usr/bin/openssl.exe", "C:/Program Files/Git/mingw64/bin/openssl.exe"].find((path) => path && existsSync(path));
let regenerate = !existsSync(keyPath) || !existsSync(certPath);
if (!regenerate) regenerate = Date.parse(new X509Certificate(readFileSync(certPath)).validTo) < Date.now() + 86400000;
if (regenerate) {
  if (!openssl) throw new Error("未找到 OpenSSL；请安装 Git for Windows 或配置 QQ_OPENSSL_PATH。");
  const result = spawnSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "7", "-subj", "/CN=chuxiaomai.cyou", "-addext", "subjectAltName=DNS:chuxiaomai.cyou", "-keyout", keyPath, "-out", certPath], { windowsHide: true, encoding: "utf8" });
  if (result.status !== 0) throw new Error("生成本地临时证书失败。");
}
const certificate = new X509Certificate(readFileSync(certPath));
const spki = createHash("sha256").update(certificate.publicKey.export({ type: "spki", format: "der" })).digest("base64");
writeFileSync(new URL("browser-cert.local", import.meta.url), spki);
const gateway = https.createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (req, res) => {
  if (req.headers.host !== origin.host) { res.writeHead(403); res.end(); return; }
  const upstream = http.request({ hostname: "127.0.0.1", port: 5173, method: req.method, path: req.url, headers: req.headers }, (incoming) => {
    res.writeHead(incoming.statusCode, { ...incoming.headers, "X-CHU-Preview": "local-only" });
    incoming.pipe(res);
  });
  upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end("Local preview is starting. Please refresh."); });
  req.on("error", () => upstream.destroy());
  res.on("close", () => upstream.destroy());
  req.pipe(upstream);
});
gateway.on("upgrade", (req, socket, head) => {
  if (req.headers.host !== origin.host) return socket.destroy();
  const upstream = net.connect(5173, "127.0.0.1", () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${req.rawHeaders.reduce((text, value, index) => text + value + (index % 2 ? "\r\n" : ": "), "")}\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
});
gateway.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? "[qq-local] 本机 443 端口已占用，请关闭冲突服务后重试。" : "[qq-local] 本地 HTTPS 网关启动失败。");
  process.exitCode = 1;
});
gateway.listen(443, "127.0.0.1", () => console.log("[qq-local] 本地 HTTPS 已就绪。仅在专用测试浏览器中将正式域名路由到本机。"));
