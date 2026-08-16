#!/usr/bin/env bash
set -euo pipefail
trap 'docker compose -f docker-compose.test.yml down -v' EXIT
docker compose -f docker-compose.test.yml build

# The image seeds a 'stale/never-use-me' cache, so these services must reach the
# router for real: any cache fallback announces itself and fails the run here.
# (--model is passed explicitly, so the model id alone proves nothing.)
for svc in test-claude test-pi test-hermes; do
  out=$(docker compose -f docker-compose.test.yml up --exit-code-from "$svc" "$svc" 2>&1) || rc=$?
  echo "$out"
  [ "${rc:-0}" = "0" ] || { echo "FAIL: $svc exited ${rc}"; exit 1; }
  if grep -qE "serving [0-9]+ models from cache|stale/never-use-me" <<<"$out"; then
    echo "FAIL: $svc served the stale cache instead of reaching the router"; exit 1
  fi
done

# exit-code passthrough: stub agent exits 7, 9agent must too
docker compose -f docker-compose.test.yml up --exit-code-from test-exit-code test-exit-code

# --sandbox --print-only composes the docker argv without a daemon present
out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-sandbox-print test-sandbox-print 2>&1) || rc=$?
echo "$out"
[ "${rc:-0}" = "0" ] || { echo "FAIL: test-sandbox-print exited ${rc}"; exit 1; }
grep -q "host.docker.internal:host-gateway" <<<"$out" || { echo "FAIL: sandbox argv missing --add-host"; exit 1; }
# mock-router is not loopback, so it must pass through UNCHANGED. The
# loopback->host.docker.internal rewrite is covered by containerizeUrl unit tests.
grep -q "ANTHROPIC_BASE_URL=http://mock-router:20128/v1" <<<"$out" || { echo "FAIL: non-loopback gateway was rewritten"; exit 1; }
grep -q "ANTHROPIC_AUTH_TOKEN=…redacted" <<<"$out" || { echo "FAIL: auth token not redacted in --print-only"; exit 1; }

# --sandbox on an agent that cannot honour it must ERROR, never run unsandboxed
if out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-sandbox-refused test-sandbox-refused 2>&1); then
  echo "$out"; echo "FAIL: hermes --sandbox should have exited non-zero"; exit 1
fi
echo "$out"
grep -q "cannot sandbox hermes" <<<"$out" || { echo "FAIL: hermes --sandbox failed for the wrong reason"; exit 1; }

# expected to FAIL with a specific, readable message — not hang, not a build error
if out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-no-tty test-no-tty 2>&1); then
  echo "$out"; echo "FAIL: test-no-tty should have exited non-zero"; exit 1
fi
echo "$out"
grep -q "No TTY — pass --model" <<<"$out" || { echo "FAIL: test-no-tty exited non-zero for the wrong reason"; exit 1; }

echo "All docker tests passed."
