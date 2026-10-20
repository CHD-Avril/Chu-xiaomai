import test from "node:test";
import assert from "node:assert/strict";
import { addQqProxyInclude } from "../install-qq-nginx.mjs";

test("inserts QQ proxy only in the named HTTPS server and is idempotent", () => {
  const http = 'server { listen 80; server_name chuxiaomai.cyou; return 301 https://$host$request_uri; }';
  const other = 'server { listen 443 ssl; server_name example.com; location / { return 200 "{}"; } }';
  const https = 'server {\n listen [::]:443 ssl;\n server_name chuxiaomai.cyou www.chuxiaomai.cyou;\n location / { try_files $uri $uri/ /index.html; }\n}';
  const original = [http, other, https].join("\n");
  const result = addQqProxyInclude(original);
  assert(result.startsWith(`${http}\n${other}\nserver {\n    include /etc/nginx/snippets/chu-qq-auth.conf;`));
  assert(result.endsWith(https.slice(https.indexOf("{") + 1)));
  assert.equal(addQqProxyInclude(result), result);
});

test("ignores comments and quoted braces, rejects ambiguous or conflicting QQ locations", () => {
  const valid = 'server { # server { fake }\nlisten 443 ssl; server_name chuxiaomai.cyou; location / { return 200 "}\\\"{"; } }';
  assert(addQqProxyInclude(valid).includes("include /etc/nginx/snippets/chu-qq-auth.conf;"));
  assert.throws(() => addQqProxyInclude(`${valid}\n${valid}`), /Multiple/);
  assert.throws(() => addQqProxyInclude('server { listen 443 ssl; server_name chuxiaomai.cyou; location ^~ /qq/ { return 404; } }'), /existing QQ/);
  assert.equal(addQqProxyInclude('server { listen 443 ssl; server_name other.example; }'), null);
  assert.throws(() => addQqProxyInclude('server { listen 443;'), /Incomplete/);
});
