#!/usr/bin/env bash
set -euo pipefail
trap 'docker compose -f docker-compose.test.yml down -v' EXIT
docker compose -f docker-compose.test.yml build

# The image seeds a 'stale/never-use-me' cache, so these services must reach the
# router for real: any cache fallback announces itself and fails the run here.
# (--model is passed explicitly, so the model id alone proves nothing.)
for svc in test-claude test-pi test-hermes test-command-code-print \
           test-aider-print test-cline-print test-codex-print \
           test-jcode-print test-kilocode-print test-opencode-print \
           test-alias-c; do
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

# command-code sandbox --print-only prints image + shadow config path (custom dry-run format)
out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-command-code-sandbox test-command-code-sandbox 2>&1) || rc=$?
echo "$out"
[ "${rc:-0}" = "0" ] || { echo "FAIL: test-command-code-sandbox exited ${rc}"; exit 1; }
grep -q "command-code sandbox dry run" <<<"$out" || { echo "FAIL: command-code sandbox dry run header missing"; exit 1; }
grep -q "shadow config:" <<<"$out" || { echo "FAIL: command-code sandbox missing shadow config path"; exit 1; }

# aider sandbox --print-only: prints image + env with containerized URL
out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-aider-sandbox test-aider-sandbox 2>&1) || rc=$?
echo "$out"
[ "${rc:-0}" = "0" ] || { echo "FAIL: test-aider-sandbox exited ${rc}"; exit 1; }
grep -q "aider sandbox dry run" <<<"$out" || { echo "FAIL: aider sandbox dry run header missing"; exit 1; }
grep -q "9agent/aider:" <<<"$out" || { echo "FAIL: aider sandbox missing image tag"; exit 1; }

# cline sandbox --print-only: prints image + env with containerized URL
out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-cline-sandbox test-cline-sandbox 2>&1) || rc=$?
echo "$out"
[ "${rc:-0}" = "0" ] || { echo "FAIL: test-cline-sandbox exited ${rc}"; exit 1; }
grep -q "cline sandbox dry run" <<<"$out" || { echo "FAIL: cline sandbox dry run header missing"; exit 1; }
grep -q "9agent/cline:" <<<"$out" || { echo "FAIL: cline sandbox missing image tag"; exit 1; }

# kilocode sandbox --print-only: prints image + env with containerized URL
out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-kilocode-sandbox test-kilocode-sandbox 2>&1) || rc=$?
echo "$out"
[ "${rc:-0}" = "0" ] || { echo "FAIL: test-kilocode-sandbox exited ${rc}"; exit 1; }
grep -q "kilocode sandbox dry run" <<<"$out" || { echo "FAIL: kilocode sandbox dry run header missing"; exit 1; }
grep -q "9agent/kilocode:" <<<"$out" || { echo "FAIL: kilocode sandbox missing image tag"; exit 1; }

# opencode sandbox --print-only: prints image + shadow config path
out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-opencode-sandbox test-opencode-sandbox 2>&1) || rc=$?
echo "$out"
[ "${rc:-0}" = "0" ] || { echo "FAIL: test-opencode-sandbox exited ${rc}"; exit 1; }
grep -q "opencode sandbox dry run" <<<"$out" || { echo "FAIL: opencode sandbox dry run header missing"; exit 1; }
grep -q "9agent/opencode:" <<<"$out" || { echo "FAIL: opencode sandbox missing image tag"; exit 1; }

# --sandbox with a missing prerequisite must ERROR, never fall back to unsandboxed.
# hermes can only be built from its own checkout, which is absent in here.
if out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-sandbox-no-checkout test-sandbox-no-checkout 2>&1); then
  echo "$out"; echo "FAIL: hermes --sandbox should have exited non-zero"; exit 1
fi
echo "$out"
grep -q "needs hermes' own checkout" <<<"$out" || { echo "FAIL: hermes --sandbox failed for the wrong reason"; exit 1; }

# codex --sandbox must refuse with a specific message
if out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-codex-sandbox-refuse test-codex-sandbox-refuse 2>&1); then
  echo "$out"; echo "FAIL: codex --sandbox should have exited non-zero"; exit 1
fi
echo "$out"
grep -q "codex: --sandbox is not supported" <<<"$out" || { echo "FAIL: codex --sandbox refused for the wrong reason"; exit 1; }

# jcode --sandbox must refuse with a specific message
if out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-jcode-sandbox-refuse test-jcode-sandbox-refuse 2>&1); then
  echo "$out"; echo "FAIL: jcode --sandbox should have exited non-zero"; exit 1
fi
echo "$out"
grep -q "jcode: --sandbox is not supported" <<<"$out" || { echo "FAIL: jcode --sandbox refused for the wrong reason"; exit 1; }

# --agent with unknown name must fail with a readable message
if out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-unknown-agent test-unknown-agent 2>&1); then
  echo "$out"; echo "FAIL: test-unknown-agent should have exited non-zero"; exit 1
fi
echo "$out"
grep -q "Unknown agent 'foo'" <<<"$out" || { echo "FAIL: unknown agent exited non-zero for the wrong reason"; exit 1; }

# --yolo and --yes safe must contradict
if out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-yolo-yes-conflict test-yolo-yes-conflict 2>&1); then
  echo "$out"; echo "FAIL: test-yolo-yes-conflict should have exited non-zero"; exit 1
fi
echo "$out"
grep -q "contradict each other" <<<"$out" || { echo "FAIL: yolo/yes conflict exited non-zero for the wrong reason"; exit 1; }

# --yes with invalid value must fail
if out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-invalid-yes test-invalid-yes 2>&1); then
  echo "$out"; echo "FAIL: test-invalid-yes should have exited non-zero"; exit 1
fi
echo "$out"
grep -q "must be 'safe' or 'dangerous'" <<<"$out" || { echo "FAIL: invalid --yes exited non-zero for the wrong reason"; exit 1; }

# no --agent on non-TTY must fail fast with a readable message
if out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-no-tty-no-agent test-no-tty-no-agent 2>&1); then
  echo "$out"; echo "FAIL: test-no-tty-no-agent should have exited non-zero"; exit 1
fi
echo "$out"
grep -q "No TTY — pass --agent" <<<"$out" || { echo "FAIL: no-TTY no-agent exited non-zero for the wrong reason"; exit 1; }

# no --model on a non-TTY: must fail fast with a readable message, not hang
if out=$(docker compose -f docker-compose.test.yml up --exit-code-from test-no-tty test-no-tty 2>&1); then
  echo "$out"; echo "FAIL: test-no-tty should have exited non-zero"; exit 1
fi
echo "$out"
grep -q "No TTY — pass --model" <<<"$out" || { echo "FAIL: test-no-tty exited non-zero for the wrong reason"; exit 1; }

echo "All docker tests passed."
