#!/usr/bin/env bash
set -euo pipefail
trap 'docker compose -f docker-compose.test.yml down -v' EXIT
docker compose -f docker-compose.test.yml build
docker compose -f docker-compose.test.yml up --exit-code-from test-claude test-claude
docker compose -f docker-compose.test.yml up --exit-code-from test-pi test-pi

# expected to FAIL (exit 1) with a readable message, not hang
if docker compose -f docker-compose.test.yml up --exit-code-from test-no-tty test-no-tty; then
  echo "FAIL: test-no-tty should have exited non-zero"; exit 1
fi
