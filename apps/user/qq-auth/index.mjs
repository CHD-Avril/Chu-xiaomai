import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createQqServer, readConfig } from "./server.mjs";

const envPath = fileURLToPath(new URL(".env.local", import.meta.url));
// Environment variables (including --mock) take precedence over the local file.
const originalEnv = { ...process.env };
if (process.env.NODE_ENV !== "production" && existsSync(envPath)) process.loadEnvFile(envPath);
Object.assign(process.env, originalEnv);
if (process.argv.includes("--mock")) {
  if (process.env.NODE_ENV === "production") throw new Error("生产环境禁止使用 --mock。");
  process.env.QQ_AUTH_MODE = "mock";
  process.env.QQ_FRONTEND_ORIGIN = "http://localhost:5173";
  process.env.QQ_REDIRECT_URI = "http://localhost:5173/qq/callback";
}
const config = readConfig();
const revisionFile = new URL("REVISION", import.meta.url);
if (existsSync(revisionFile)) config.revision = readFileSync(revisionFile, "utf8").trim();
const server = createQqServer(config);
server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? `[qq-auth] 端口 ${config.port} 已被占用，请先关闭旧授权服务。` : "[qq-auth] 启动失败，请检查本地配置。");
  process.exitCode = 1;
});
server.listen(config.port, "127.0.0.1", () => {
  console.log(`[qq-auth] http://127.0.0.1:${config.port} · ${config.mode === "mock" ? "本地模拟（非真实 QQ）" : "真实 QQ 授权"}`);
  console.log(`[qq-auth] 前端：${config.frontendOrigin} · 回调：${config.redirectUri}`);
  if (config.mode === "real" && (!config.appId || !config.appKey)) console.log("[qq-auth] 尚未配置 AppID / AppKey，请填写 qq-auth/.env.local 后重启。");
});
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 35000).unref();
  });
}
