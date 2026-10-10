#!/usr/bin/env bash
set -euo pipefail

for variable in ECS_HOST ECS_USER ECS_SSH_KEY ECS_KNOWN_HOSTS GITHUB_SHA GITHUB_RUN_ID GITHUB_RUN_ATTEMPT; do
  if [[ -z "${!variable:-}" ]]; then
    echo "Missing required configuration: $variable" >&2
    exit 1
  fi
done

port="${ECS_PORT:-22}"
[[ "$ECS_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Invalid ECS_HOST' >&2; exit 1; }
[[ "$ECS_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo 'Invalid ECS_USER' >&2; exit 1; }
if [[ ! "$port" =~ ^[0-9]{1,5}$ ]]; then echo 'Invalid ECS_PORT' >&2; exit 1; fi
if (( 10#$port < 1 || 10#$port > 65535 )); then echo 'Invalid ECS_PORT' >&2; exit 1; fi
release_id="$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
[[ "$release_id" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || { echo 'Invalid release ID' >&2; exit 1; }

work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT
chmod 700 "$work_dir"
printf '%s\n' "$ECS_SSH_KEY" > "$work_dir/key"
printf '%s\n' "$ECS_KNOWN_HOSTS" > "$work_dir/known_hosts"
chmod 600 "$work_dir/key" "$work_dir/known_hosts"
ssh-keygen -y -f "$work_dir/key" > /dev/null
known_host="$ECS_HOST"
if [[ "$port" != 22 ]]; then known_host="[$ECS_HOST]:$port"; fi
ssh-keygen -F "$known_host" -f "$work_dir/known_hosts" > /dev/null || {
  echo 'ECS_KNOWN_HOSTS does not contain the configured SSH host and port' >&2
  exit 1
}

mkdir -p "$work_dir/payload/user" "$work_dir/payload/admin"
for app in user admin; do
  test -s ".artifacts/build-$app/index.html"
  cp -a ".artifacts/build-$app/." "$work_dir/payload/$app/"
done
printf '%s\n' "$GITHUB_SHA" > "$work_dir/payload/REVISION"
tar -czf "$work_dir/$release_id.tar.gz" -C "$work_dir/payload" user admin REVISION
cp scripts/ecs-release.sh "$work_dir/$release_id.sh"

ssh_options=(
  -i "$work_dir/key"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$work_dir/known_hosts"
  -o ConnectTimeout=15
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=3
)
destination="$ECS_USER@$ECS_HOST"
scp "${ssh_options[@]}" -P "$port" \
  "$work_dir/$release_id.tar.gz" "$work_dir/$release_id.sh" \
  "$destination:/var/www/chu-xiaomai/incoming/"
ssh "${ssh_options[@]}" -p "$port" "$destination" \
  "bash /var/www/chu-xiaomai/incoming/$release_id.sh $release_id"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf 'Published %s to https://chuxiaomai.cyou/ and /admin/.\n' "$GITHUB_SHA" >> "$GITHUB_STEP_SUMMARY"
fi
