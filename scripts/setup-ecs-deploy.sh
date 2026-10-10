#!/usr/bin/env bash
set -euo pipefail

[[ "$EUID" -eq 0 ]] || { echo 'Run this script as root on the ECS server' >&2; exit 1; }
public_key="${1:-}"
[[ "$public_key" == ssh-ed25519\ * && "$public_key" != *$'\n'* ]] || {
  echo 'Pass the deployment Ed25519 public key as the first argument' >&2
  exit 1
}
ssh-keygen -l -f /dev/stdin <<< "$public_key" > /dev/null
for program in curl flock tar nginx; do command -v "$program" > /dev/null; done
nginx -t

deploy_user=chu-deploy
web_root=/var/www/chu-xiaomai
if ! id "$deploy_user" > /dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$deploy_user"
fi
deploy_group="$(id -gn "$deploy_user")"
deploy_home="$(getent passwd "$deploy_user" | cut -d: -f6)"
install -d -m 700 -o "$deploy_user" -g "$deploy_group" "$deploy_home/.ssh"
touch "$deploy_home/.ssh/authorized_keys"
key_entry="restrict $public_key"
if ! grep -Fxq "$key_entry" "$deploy_home/.ssh/authorized_keys"; then
  printf '%s\n' "$key_entry" >> "$deploy_home/.ssh/authorized_keys"
fi
chown "$deploy_user:$deploy_group" "$deploy_home/.ssh/authorized_keys"
chmod 600 "$deploy_home/.ssh/authorized_keys"

test -d "$web_root"
mkdir -p "$web_root/releases" "$web_root/incoming"
stamp="$(date -u +%Y%m%dT%H%M%S)-$$"
declare -A moved=([user]=false [admin]=false)
created_current=false
restore_layout() {
  local result=$?
  trap - ERR
  for app in user admin; do
    if [[ "${moved[$app]}" == true ]]; then
      if [[ -L "$web_root/$app" ]]; then rm -- "$web_root/$app"; fi
      mv "$web_root/$app.before-actions-$stamp" "$web_root/$app"
    fi
  done
  if [[ "$created_current" == true && -L "$web_root/current" ]]; then
    rm -- "$web_root/current"
  fi
  echo 'Initialization failed; restored the original website directories' >&2
  exit "$result"
}
trap restore_layout ERR

if [[ -L "$web_root/current" ]]; then
  test "$(readlink "$web_root/user")" = current/user
  test "$(readlink "$web_root/admin")" = current/admin
else
  [[ ! -e "$web_root/current" ]]
  for app in user admin; do
    [[ -d "$web_root/$app" && ! -L "$web_root/$app" ]]
    test -s "$web_root/$app/index.html"
  done
  bootstrap="$web_root/releases/bootstrap-$stamp"
  mkdir "$bootstrap"
  cp -a "$web_root/user" "$web_root/admin" "$bootstrap/"
  ln -s "releases/bootstrap-$stamp" "$web_root/current"
  created_current=true
  mv "$web_root/user" "$web_root/user.before-actions-$stamp"
  moved[user]=true
  ln -s current/user "$web_root/user"
  mv "$web_root/admin" "$web_root/admin.before-actions-$stamp"
  moved[admin]=true
  ln -s current/admin "$web_root/admin"
  chown -R "$deploy_user:$deploy_group" "$bootstrap"
  chmod -R a+rX "$bootstrap"
fi

chown "$deploy_user:$deploy_group" "$web_root" "$web_root/releases" "$web_root/incoming"
chmod 755 "$web_root" "$web_root/releases" "$web_root/incoming"
touch "$web_root/.deploy.lock"
chown "$deploy_user:$deploy_group" "$web_root/.deploy.lock"
for app_path in '' admin/; do
  curl --fail --silent --show-error --connect-timeout 5 --max-time 20 \
    --resolve chuxiaomai.cyou:443:127.0.0.1 "https://chuxiaomai.cyou/$app_path" > /dev/null
done
trap - ERR
echo 'Ready: chu-deploy can publish through SSH without sudo.'
echo 'Existing Nginx configuration and HTTPS certificates were preserved.'
