#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
export CHU_DEPLOY_ROOT="$fixture/web"
mkdir -p "$CHU_DEPLOY_ROOT/releases/bootstrap" "$CHU_DEPLOY_ROOT/incoming" "$fixture/bin"
ln -s releases/bootstrap "$CHU_DEPLOY_ROOT/current"
ln -s current/user "$CHU_DEPLOY_ROOT/user"
ln -s current/admin "$CHU_DEPLOY_ROOT/admin"

# The HTTP fixture resolves files through the same symlinks as production Nginx.
cat > "$fixture/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${FAIL_HEALTH:-false}" == true ]]; then exit 22; fi
url="${!#}"
app=user
if [[ "$url" == *'/admin/'* ]]; then app=admin; fi
file=index.html
if [[ "$url" == *'/REVISION?'* ]]; then file=REVISION; fi
cat "$CHU_DEPLOY_ROOT/$app/$file"
MOCK
chmod +x "$fixture/bin/curl"
export PATH="$fixture/bin:$PATH"

make_archive() {
  local id="$1"
  local missing_admin="${2:-false}"
  local payload="$fixture/payload-$id"
  mkdir -p "$payload/user" "$payload/admin"
  printf 'user-%s\n' "$id" > "$payload/user/index.html"
  if [[ "$missing_admin" != true ]]; then printf 'admin-%s\n' "$id" > "$payload/admin/index.html"; fi
  printf '%s\n' "${id:0:40}" > "$payload/REVISION"
  tar -czf "$CHU_DEPLOY_ROOT/incoming/$id.tar.gz" -C "$payload" user admin REVISION
}

first=1111111111111111111111111111111111111111-1-1
make_archive "$first"
bash "$script_dir/ecs-release.sh" "$first"
test "$(readlink "$CHU_DEPLOY_ROOT/current")" = "releases/$first"
test "$(cat "$CHU_DEPLOY_ROOT/user/REVISION")" = "${first:0:40}"
test "$(cat "$CHU_DEPLOY_ROOT/admin/REVISION")" = "${first:0:40}"

second=2222222222222222222222222222222222222222-2-1
make_archive "$second"
if FAIL_HEALTH=true bash "$script_dir/ecs-release.sh" "$second"; then
  echo 'Expected failed health check to reject the release' >&2; exit 1
fi
test "$(readlink "$CHU_DEPLOY_ROOT/current")" = "releases/$first"

third=3333333333333333333333333333333333333333-3-1
make_archive "$third" true
if bash "$script_dir/ecs-release.sh" "$third"; then
  echo 'Expected incomplete build to be rejected' >&2; exit 1
fi
test "$(readlink "$CHU_DEPLOY_ROOT/current")" = "releases/$first"

if bash "$script_dir/ecs-release.sh" '../invalid'; then
  echo 'Expected invalid release ID to be rejected' >&2; exit 1
fi
echo 'PASS: successful publish, HTTP failure rollback, incomplete build rejection, invalid ID rejection'
