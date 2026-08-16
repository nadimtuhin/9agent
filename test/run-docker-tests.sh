#!/usr/bin/env bash
set -euo pipefail
trap 'docker compose -f docker-compose.test.yml down -v' EXIT
docker compose -f docker-compose.test.yml build

# The image seeds a 'stale/never-use-me' cache, so these services must reach the
# router for real: any cache fallback announces itself and fails the run here.
# (--model is passed explicitly, so the model id alone proves nothing.)
for svc in test-claude test-pi; do
  out=$(docker compose -f docker-compose.test.yml up --exit-code-from "$svc" "$svc" 2>&1) || rc=$?
  echo "$out"
  [ "${rc:-0}" = "0" ] || { echo "FAIL: $svc exited ${rc}"; exit 1; }
  if grep -qE "serving [0-9]+ models from cache|stale/never-use-me" <<<"$out"; then
    echo "FAIL: $svc served the stale cache instead of reaching the router"; exit 1
  fi
done

# exit-code passthrough: stub agent exits 7, 9agent must too
docker compose -f docker-compose.test.yml up --exit-code-from test-exit-code test-exit-code

# expected to FAIL with a specific, readable message — not hang, not a build error
if out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-no-tty test-no-tty 2>&1); then
  echo "$out"; echo "FAIL: test-no-tty should have exited non-zero"; exit 1
fi
echo "$out"
grep -q "No TTY — pass --model" <<<"$out" || { echo "FAIL: test-no-tty exited non-zero for the wrong reason"; exit 1; }

echo "All docker tests passed."
