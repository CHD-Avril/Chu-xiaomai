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
switched=false
rollback() {
  local result=$?
  trap - ERR
  if [[ "$switched" == true ]]; then
    ln -s "$previous" "$web_root/.rollback-$release_id"
    mv -Tf "$web_root/.rollback-$release_id" "$web_root/current"
    echo "Health check failed; restored $previous" >&2
  fi
  exit "$result"
}
trap rollback ERR

mkdir "$release"
tar -xzf "$archive" -C "$release" --no-same-owner --no-same-permissions
test -s "$release/user/index.html"
test -s "$release/admin/index.html"
test "$(cat "$release/REVISION")" = "${release_id:0:40}"
cp "$release/REVISION" "$release/user/REVISION"
cp "$release/REVISION" "$release/admin/REVISION"
chmod -R a+rX "$release"

ln -s "releases/$release_id" "$web_root/.current-$release_id"
switched=true
mv -Tf "$web_root/.current-$release_id" "$web_root/current"

curl_options=(--fail --silent --show-error --connect-timeout 5 --max-time 20
  --retry 2 --resolve "$domain:443:127.0.0.1")
for app_path in '' admin/; do
  curl "${curl_options[@]}" "https://$domain/${app_path}?deployment=$release_id" > /dev/null
  served_revision="$(curl "${curl_options[@]}" "https://$domain/${app_path}REVISION?deployment=$release_id")"
  test "$served_revision" = "${release_id:0:40}"
done

trap - ERR
rm -f -- "$archive" "$web_root/incoming/$release_id.sh"
echo "Published $release_id (previous: $previous)"
