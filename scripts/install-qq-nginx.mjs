import { readFileSync, writeFileSync, copyFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const include = "include /etc/nginx/snippets/chu-qq-auth.conf;";

// Inspect only directives directly inside server {}, retaining original offsets.
export function addQqProxyInclude(source) {
  const stack = [], servers = [];
  let statement = "", quote = "", escaped = false, comment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (comment) { if (char === "\n") { comment = false; statement += " "; } continue; }
    if (escaped) { statement += char; escaped = false; continue; }
    if (char === "\\") { statement += char; escaped = true; continue; }
    if (quote) { statement += char; if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") { statement += char; quote = char; continue; }
    if (char === "#") { comment = true; continue; }
    if (char === "{") {
      const kind = statement.trim();
      const block = { kind, open: index, directives: [], children: [] };
      if (stack.at(-1)?.kind === "server") stack.at(-1).children.push(kind);
      stack.push(block);
      statement = "";
    } else if (char === ";") {
      if (stack.at(-1)?.kind === "server") stack.at(-1).directives.push(statement.trim());
      statement = "";
    } else if (char === "}") {
      const block = stack.pop();
      if (!block) throw new Error("Unbalanced Nginx config");
      if (block.kind === "server") servers.push(block);
      statement = "";
    } else statement += char;
  }
  if (stack.length || quote) throw new Error("Incomplete Nginx config");
  const matches = servers.filter((server) => {
    const domain = server.directives.some((value) => /^server_name\s/.test(value) && value.split(/\s+/).slice(1).includes("chuxiaomai.cyou"));
    const https = server.directives.some((value) => /^listen\s+(?:[^\s]*:)?443(?:\s|$)/.test(value));
    return domain && https;
  });
  if (!matches.length) return null;
  if (matches.length !== 1) throw new Error("Multiple HTTPS server blocks match chuxiaomai.cyou; inspect manually");
  const target = matches[0];
  if (target.directives.includes(include.slice(0, -1))) return source;
  if (target.children.some((value) => /^location\s/.test(value) && /\/qq(?:\/|\b)/.test(value))) throw new Error("An existing QQ location must be inspected before adding the proxy");
  return source.slice(0, target.open + 1) + `\n    ${include}\n` + source.slice(target.open + 1);
}

function command(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${program} failed; configuration was not accepted`);
  return result.stdout;
}

export function installQqNginx() {
  if (process.getuid?.() !== 0) throw new Error("Run as root on ECS");
  const dump = command("nginx", ["-T"]);
  const names = [...dump.matchAll(/^# configuration file (\/[^\r\n]+):$/gm)].map((value) => value[1]);
  const unique = [...new Set(names.map((name) => realpathSync(name)))];
  const matches = unique.map((file) => ({ file, source: readFileSync(file, "utf8") })).map((value) => ({ ...value, next: addQqProxyInclude(value.source) })).filter((value) => value.next !== null);
  if (matches.length !== 1) throw new Error("Cannot identify exactly one HTTPS config for chuxiaomai.cyou; no Nginx files were changed");
  const target = matches[0];
  if (target.next === target.source) { command("nginx", ["-t"]); command("systemctl", ["reload", "nginx"]); return; }
  const backup = `/etc/chu-xiaomai/nginx-before-qq-${Date.now()}.conf`;
  copyFileSync(target.file, backup);
  writeFileSync(target.file, target.next);
  try {
    command("nginx", ["-t"]);
    command("systemctl", ["reload", "nginx"]);
    console.log(`Nginx QQ proxy installed; original config backed up at ${backup}`);
  } catch (error) {
    writeFileSync(target.file, target.source);
    command("nginx", ["-t"]);
    command("systemctl", ["reload", "nginx"]);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { installQqNginx(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
