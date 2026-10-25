#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
temp_root="$(cd -- "${TMPDIR:-/tmp}" && pwd -P)"
fixture="$(mktemp -d "$temp_root/chu-release-test.XXXXXX")"
[[ "$(dirname -- "$fixture")" == "$temp_root" && -d "$fixture" ]] || exit 1
trap 'rm -rf -- "$fixture"' EXIT
export CHU_DEPLOY_ROOT="$fixture/web"
mkdir -p "$CHU_DEPLOY_ROOT/releases/bootstrap" "$CHU_DEPLOY_ROOT/incoming" "$fixture/bin"
ln -s releases/bootstrap "$CHU_DEPLOY_ROOT/current"
mkdir -p "$CHU_DEPLOY_ROOT/releases/bootstrap/qq-auth"
echo '// bootstrap' > "$CHU_DEPLOY_ROOT/releases/bootstrap/qq-auth/index.mjs"
echo 'bootstrap' > "$CHU_DEPLOY_ROOT/releases/bootstrap/qq-auth/REVISION"
ln -s current/user "$CHU_DEPLOY_ROOT/user"
ln -s current/admin "$CHU_DEPLOY_ROOT/admin"

# The HTTP fixture resolves files through the same symlinks as production Nginx.
cat > "$fixture/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${FAIL_HEALTH:-false}" == true ]]; then exit 22; fi
url="${!#}"
if [[ "$url" == *'/qq/participation-health' ]]; then
  if [[ "${FAIL_PARTICIPATION_HEALTH:-false}" == true ]]; then echo '{"ok":false}'; else echo '{"ok":true}'; fi
  exit 0
fi
if [[ "$url" == *'/qq/health' ]]; then
  revision="$(cat "$CHU_DEPLOY_ROOT/current/qq-auth/REVISION")"
  if [[ "${FAIL_QQ_HEALTH:-false}" == true ]]; then revision=stale; fi
  echo "{\"ok\":true,\"mode\":\"real\",\"configured\":true,\"revision\":\"$revision\"}"
  exit 0
fi
app=user
if [[ "$url" == *'/admin/'* ]]; then app=admin; fi
file=index.html
if [[ "$url" == *'/REVISION?'* ]]; then file=REVISION; fi
cat "$CHU_DEPLOY_ROOT/$app/$file"
MOCK
chmod +x "$fixture/bin/curl"
cat > "$fixture/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == '-n /usr/bin/systemctl restart chu-qq-auth.service' ]]
cat "$CHU_DEPLOY_ROOT/current/qq-auth/REVISION" > "$CHU_DEPLOY_ROOT/started-backend"
MOCK
cat > "$fixture/bin/sleep" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
chmod +x "$fixture/bin/sudo" "$fixture/bin/sleep"
export PATH="$fixture/bin:$PATH"

make_archive() {
  local id="$1"
  local missing_admin="${2:-false}"
  local missing_auth="${3:-false}"
  local payload="$fixture/payload-$id"
  mkdir -p "$payload/user" "$payload/admin" "$payload/qq-auth"
  printf 'user-%s\n' "$id" > "$payload/user/index.html"
  if [[ "$missing_admin" != true ]]; then printf 'admin-%s\n' "$id" > "$payload/admin/index.html"; fi
  printf '%s\n' "${id:0:40}" > "$payload/REVISION"
  if [[ "$missing_auth" != true ]]; then
    echo '// fixture' > "$payload/qq-auth/index.mjs"
    echo '// fixture' > "$payload/qq-auth/server.mjs"
  fi
  tar -czf "$CHU_DEPLOY_ROOT/incoming/$id.tar.gz" -C "$payload" user admin qq-auth REVISION
}

first=1111111111111111111111111111111111111111-1-1
make_archive "$first"
bash "$script_dir/ecs-release.sh" "$first"
test "$(readlink "$CHU_DEPLOY_ROOT/current")" = "releases/$first"
test "$(cat "$CHU_DEPLOY_ROOT/user/REVISION")" = "${first:0:40}"
test "$(cat "$CHU_DEPLOY_ROOT/admin/REVISION")" = "${first:0:40}"

second=2222222222222222222222222222222222222222-2-1
test "$(cat "$CHU_DEPLOY_ROOT/started-backend")" = "${first:0:40}"
make_archive "$second"
if FAIL_HEALTH=true bash "$script_dir/ecs-release.sh" "$second"; then
  echo 'Expected failed health check to reject the release' >&2; exit 1
fi
test "$(readlink "$CHU_DEPLOY_ROOT/current")" = "releases/$first"

third=3333333333333333333333333333333333333333-3-1
test "$(cat "$CHU_DEPLOY_ROOT/started-backend")" = "${first:0:40}"
make_archive "$third" true
if bash "$script_dir/ecs-release.sh" "$third"; then
  echo 'Expected incomplete build to be rejected' >&2; exit 1
fi
test "$(readlink "$CHU_DEPLOY_ROOT/current")" = "releases/$first"

fourth=4444444444444444444444444444444444444444-4-1
make_archive "$fourth" false true
if bash "$script_dir/ecs-release.sh" "$fourth"; then
  echo 'Expected missing backend to be rejected' >&2; exit 1
fi
test "$(readlink "$CHU_DEPLOY_ROOT/current")" = "releases/$first"

fifth=5555555555555555555555555555555555555555-5-1
make_archive "$fifth"
if FAIL_QQ_HEALTH=true bash "$script_dir/ecs-release.sh" "$fifth"; then
  echo 'Expected old backend revision to reject the release' >&2; exit 1
fi
test "$(readlink "$CHU_DEPLOY_ROOT/current")" = "releases/$first"
test "$(cat "$CHU_DEPLOY_ROOT/started-backend")" = "${first:0:40}"

sixth=6666666666666666666666666666666666666666-6-1
make_archive "$sixth"
if FAIL_PARTICIPATION_HEALTH=true bash "$script_dir/ecs-release.sh" "$sixth"; then
  echo 'Expected missing QQ participation configuration to reject the release' >&2; exit 1
fi
test "$(readlink "$CHU_DEPLOY_ROOT/current")" = "releases/$first"
test "$(cat "$CHU_DEPLOY_ROOT/started-backend")" = "${first:0:40}"

if bash "$script_dir/ecs-release.sh" '../invalid'; then
  echo 'Expected invalid release ID to be rejected' >&2; exit 1
fi
echo 'PASS: combined publish, HTTP/backend/participation rollback, missing frontend/backend rejection, invalid ID rejection'
