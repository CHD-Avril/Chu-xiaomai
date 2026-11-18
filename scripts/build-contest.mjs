// Builds the contest demo site: user app at /, admin app at /admin/, merged into contest/web.
import { execFileSync } from "node:child_process";
import { cpSync, rmSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const nodeBin = process.execPath;
const envFile = path.join(root, "contest", ".env.contest");
const fileEnv = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !line.trim().startsWith("#")) fileEnv[match[1]] = match[2];
  }
}
const supabaseUrl = process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || "";
const anonKey = process.env.VITE_ANON_KEY || fileEnv.VITE_ANON_KEY || "";
if (!supabaseUrl || !anonKey) {
  console.warn("警告：未配置演示库 VITE_SUPABASE_URL / VITE_ANON_KEY，使用占位值构建（仅验证编译，页面无法读数据）。");
}
const common = {
  ...process.env,
  VITE_SUPABASE_URL: supabaseUrl || "https://placeholder.supabase.co",
  VITE_ANON_KEY: anonKey || "placeholder-anon-key",
};

console.log("构建用户端…");
execFileSync(nodeBin, [path.join(root, "apps", "user", "node_modules", "vite", "bin", "vite.js"), "build"], {
  cwd: path.join(root, "apps", "user"),
  env: { ...common, VITE_QQ_AUTH_BASE: "/functions/v1/app", VITE_DEMO_LOGIN: "1", VITE_ADMIN_URL: "/admin/index.html" },
  stdio: "inherit",
});
console.log("构建运营端…");
execFileSync(nodeBin, [path.join(root, "apps", "admin", "node_modules", "vite", "bin", "vite.js"), "build", "--base=/admin/"], {
  cwd: path.join(root, "apps", "admin"),
  env: { ...common, VITE_USER_URL: "/" },
  stdio: "inherit",
});

const web = path.join(root, "contest", "web");
rmSync(web, { recursive: true, force: true });
cpSync(path.join(root, "apps", "user", "dist"), web, { recursive: true });
cpSync(path.join(root, "apps", "admin", "dist"), path.join(web, "admin"), { recursive: true });
console.log(`合并完成：${web}`);