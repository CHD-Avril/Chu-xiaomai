#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
temp_root="$(cd -- "${TMPDIR:-/tmp}" && pwd -P)"
fixture="$(mktemp -d "$temp_root/chu-ssh-test.XXXXXX")"
[[ "$(dirname -- "$fixture")" == "$temp_root" && -d "$fixture" ]] || exit 1
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/scripts" "$fixture/.artifacts/build-user" "$fixture/.artifacts/build-admin"
cp "$script_dir/ecs-release.sh" "$fixture/scripts/"
mkdir -p "$fixture/apps/user/qq-auth"
for source in index.mjs server.mjs; do cp "$script_dir/../apps/user/qq-auth/$source" "$fixture/apps/user/qq-auth/$source"; done
echo 'QQ_APP_KEY=must-not-ship' > "$fixture/apps/user/qq-auth/.env.local"
for app in user admin; do printf 'fixture\n' > "$fixture/.artifacts/build-$app/index.html"; done
ssh-keygen -q -t ed25519 -N '' -f "$fixture/source-key"
ssh-keygen -q -t ed25519 -N 'test-only-passphrase' -f "$fixture/encrypted-key"

# Fake transport: the real key parser and packaging run, but no connection occurs.
cat > "$fixture/bin/ssh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'called\n' >> "$SSH_TEST_CALLS"
MOCK
cp "$fixture/bin/ssh" "$fixture/bin/scp"
cat > "$fixture/bin/scp" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
echo 'called' >> "$SSH_TEST_CALLS"
for file in "$@"; do
  if [[ "$file" == *.tar.gz ]]; then
    listing="$(tar -tzf "$file")"
    [[ "$listing" == *qq-auth/server.mjs* ]]
    [[ "$listing" == *qq-auth/index.mjs* ]]
    if [[ "$listing" == *'.env'* || "$listing" == *'.local'* ]]; then
      echo 'Backend credentials or local assets leaked into release' >&2; exit 1
    fi
  fi
done
MOCK
chmod +x "$fixture/bin/ssh" "$fixture/bin/scp"
export PATH="$fixture/bin:$PATH"
export SSH_TEST_CALLS="$fixture/calls"
export ECS_HOST=example.invalid ECS_USER=chu-deploy ECS_PORT=22
export GITHUB_SHA=1111111111111111111111111111111111111111 GITHUB_RUN_ID=1 GITHUB_RUN_ATTEMPT=1
export GITHUB_STEP_SUMMARY="$fixture/summary"
export ECS_KNOWN_HOSTS
ECS_KNOWN_HOSTS="example.invalid $(cat "$fixture/source-key.pub")"

run_case() {
  local name="$1"
  local expected="$2"
  : > "$SSH_TEST_CALLS"
  if (cd "$fixture"; bash "$script_dir/deploy-ecs.sh") > "$fixture/output" 2> "$fixture/error"; then
    [[ "$expected" == success ]] || { echo "Unexpected success: $name" >&2; exit 1; }
    test "$(wc -l < "$SSH_TEST_CALLS")" -eq 2
  else
    [[ "$expected" == failure ]] || { echo "Unexpected failure: $name" >&2; cat "$fixture/error" >&2; exit 1; }
    test ! -s "$SSH_TEST_CALLS"
    grep -q 'ECS_SSH_KEY' "$fixture/error"
  fi
  echo "PASS: $name"
}

export ECS_SSH_KEY
ECS_SSH_KEY="$(cat "$fixture/source-key")"
run_case 'LF private key without trailing newline' success
ECS_SSH_KEY="$(sed 's/$/\r/' "$fixture/source-key")"
ECS_KNOWN_HOSTS="${ECS_KNOWN_HOSTS}"$'\r'
run_case 'CRLF clipboard key and known_hosts' success
ECS_SSH_KEY="$(base64 < "$fixture/source-key" | tr -d '\n')"
run_case 'single-line base64 key' success
ECS_SSH_KEY="$(sed '$d' "$fixture/source-key")"
run_case 'truncated key rejected before transport' failure
ECS_SSH_KEY="$(cat "$fixture/source-key.pub")"
run_case 'public key rejected before transport' failure
ECS_SSH_KEY="$(cat "$fixture/encrypted-key")"
run_case 'encrypted key rejected without prompting' failure
