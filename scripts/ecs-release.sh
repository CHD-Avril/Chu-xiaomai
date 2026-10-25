#!/usr/bin/env bash
set -euo pipefail

release_id="${1:-}"
[[ "$release_id" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || { echo 'Invalid release ID' >&2; exit 1; }
web_root="${CHU_DEPLOY_ROOT:-/var/www/chu-xiaomai}"
domain=chuxiaomai.cyou
archive="$web_root/incoming/$release_id.tar.gz"
release="$web_root/releases/$release_id"
test -d "$web_root/releases"
test -f "$archive"
test -L "$web_root/current"
exec 9> "$web_root/.deploy.lock"
flock -w 120 9

previous="$(readlink "$web_root/current")"
if [[ "$previous" != releases/* || "$previous" == *..* || ! -d "$web_root/$previous" ]]; then
  echo 'Invalid current release; initialize the server first' >&2
  exit 1
fi
test -s "$web_root/$previous/qq-auth/index.mjs" || {
  echo 'QQ backend is not installed; complete scripts/setup-qq-auth.sh and the Nginx include before publishing.' >&2
  exit 1
}
switched=false
rollback() {
  local result=$?
  trap - ERR
  if [[ "$switched" == true ]]; then
    ln -s "$previous" "$web_root/.rollback-$release_id"
    mv -Tf "$web_root/.rollback-$release_id" "$web_root/current"
    if ! sudo -n /usr/bin/systemctl restart chu-qq-auth.service; then
      echo 'Previous web release restored, but QQ backend restart failed; inspect chu-qq-auth.service.' >&2
    fi
    echo "Health check failed; restored $previous" >&2
  fi
  exit "$result"
}
trap rollback ERR

mkdir "$release"
tar -xzf "$archive" -C "$release" --no-same-owner --no-same-permissions
test -s "$release/user/index.html"
test -s "$release/admin/index.html"
test -s "$release/qq-auth/index.mjs"
test -s "$release/qq-auth/server.mjs"
node --check "$release/qq-auth/index.mjs"
node --check "$release/qq-auth/server.mjs"
test "$(cat "$release/REVISION")" = "${release_id:0:40}"
cp "$release/REVISION" "$release/user/REVISION"
cp "$release/REVISION" "$release/admin/REVISION"
cp "$release/REVISION" "$release/qq-auth/REVISION"
chmod -R a+rX "$release"

ln -s "releases/$release_id" "$web_root/.current-$release_id"
switched=true
mv -Tf "$web_root/.current-$release_id" "$web_root/current"
sudo -n /usr/bin/systemctl restart chu-qq-auth.service

curl_options=(--fail --silent --show-error --connect-timeout 5 --max-time 20
  --retry 2 --resolve "$domain:443:127.0.0.1")
for app_path in '' admin/; do
  curl "${curl_options[@]}" "https://$domain/${app_path}?deployment=$release_id" > /dev/null
  served_revision="$(curl "${curl_options[@]}" "https://$domain/${app_path}REVISION?deployment=$release_id")"
  test "$served_revision" = "${release_id:0:40}"
done

# Static HTML can succeed while /qq/* is missing or still serves the old backend.
auth_ready=false
for attempt in {1..20}; do
  if auth_health="$(curl "${curl_options[@]}" "https://$domain/qq/health" 2>/dev/null)" &&
    printf '%s' "$auth_health" | node -e '
      let text=""; process.stdin.on("data", chunk => text += chunk);
      process.stdin.on("end", () => { try {
        const data=JSON.parse(text);
        process.exit(data.ok === true && data.mode === "real" && data.configured === true && data.revision === process.argv[1] ? 0 : 1);
      } catch { process.exit(1); } });' "${release_id:0:40}"; then
    auth_ready=true
    break
  fi
  sleep 0.5
done
[[ "$auth_ready" == true ]] || { echo 'QQ backend health/revision check failed' >&2; false; }

# Credentials must be installed on ECS, and the non-destructive QQ migration
# must be applied. A null-period probe performs no account/vote writes.
curl "${curl_options[@]}" "https://$domain/qq/participation-health" | node -e '
  let text=""; process.stdin.on("data", chunk => text += chunk);
  process.stdin.on("end", () => { try { process.exit(JSON.parse(text).ok === true ? 0 : 1); } catch { process.exit(1); } });'

trap - ERR
rm -f -- "$archive" "$web_root/incoming/$release_id.sh"
echo "Published $release_id (previous: $previous)"
