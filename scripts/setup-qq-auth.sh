#!/usr/bin/env bash
set -euo pipefail

# One-time production setup. Does not edit any existing Nginx server block.
[[ "$EUID" -eq 0 ]] || { echo 'Run as root on ECS after approval.' >&2; exit 1; }
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
web_root=/var/www/chu-xiaomai
for program in node systemctl nginx visudo install; do command -v "$program" > /dev/null; done
test -x /usr/bin/node
test -x /usr/bin/systemctl
/usr/bin/node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'
test -L "$web_root/current"
test -s "$web_root/current/user/index.html"
id chu-deploy > /dev/null

install -d -m 700 /etc/chu-xiaomai
if [[ ! -f /etc/chu-xiaomai/qq-auth.env ]]; then
  install -m 600 "$repo_root/deploy/qq-auth/qq-auth.env.example" /etc/chu-xiaomai/qq-auth.env
  echo 'Fill QQ_APP_KEY in /etc/chu-xiaomai/qq-auth.env, then rerun this script. Do not send the key in chat.'
  exit 1
fi
chown root:root /etc/chu-xiaomai/qq-auth.env
chmod 600 /etc/chu-xiaomai/qq-auth.env
# Validate without printing credentials or contacting QQ.
NODE_ENV=production /usr/bin/node --env-file=/etc/chu-xiaomai/qq-auth.env --input-type=module - "$repo_root" <<'NODE'
import { pathToFileURL } from 'node:url';
const { readConfig } = await import(pathToFileURL(`${process.argv[2]}/apps/user/qq-auth/server.mjs`));
readConfig(process.env);
NODE

if ! id chu-qq-auth > /dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin chu-qq-auth
fi
# Bootstrap the backend for the currently deployed static-only release, so rollback
# after the first combined release also restores an installed backend.
if [[ ! -d "$web_root/current/qq-auth" ]]; then
  install -d -m 755 "$web_root/current/qq-auth"
  install -m 644 "$repo_root/apps/user/qq-auth/index.mjs" "$repo_root/apps/user/qq-auth/server.mjs" "$web_root/current/qq-auth/"
  if [[ -s "$web_root/current/REVISION" ]]; then
    install -m 644 "$web_root/current/REVISION" "$web_root/current/qq-auth/REVISION"
  else
    printf 'bootstrap\n' > "$web_root/current/qq-auth/REVISION"
  fi
fi
install -m 644 "$repo_root/deploy/qq-auth/chu-qq-auth.service" /etc/systemd/system/chu-qq-auth.service
install -d -m 755 /etc/nginx/snippets
install -m 644 "$repo_root/deploy/qq-auth/nginx.conf" /etc/nginx/snippets/chu-qq-auth.conf

# Only this unit can be restarted by the existing deploy account.
sudoers_file="$(mktemp)"
trap 'rm -f -- "$sudoers_file"' EXIT
printf 'chu-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart chu-qq-auth.service\n' > "$sudoers_file"
visudo -cf "$sudoers_file"
install -m 440 "$sudoers_file" /etc/sudoers.d/chu-qq-auth
systemctl daemon-reload
systemctl enable chu-qq-auth.service
systemctl restart chu-qq-auth.service
systemctl is-active --quiet chu-qq-auth.service
echo 'Backend installed. Add this line inside the EXISTING HTTPS server block for chuxiaomai.cyou:'
echo '    include /etc/nginx/snippets/chu-qq-auth.conf;'
echo 'Then run: nginx -t && systemctl reload nginx'
echo 'Finally run: node scripts/check-qq-login.mjs https://chuxiaomai.cyou'
