#!/usr/bin/env bash
# The gate. Every check here must pass before work is called done.
# Fast checks only — the docker harness is separate (npm run test:docker).
set -uo pipefail
cd "$(dirname "$0")/.."

fails=0
check() {
  local name=$1; shift
  if "$@" >/tmp/9agent-check.log 2>&1; then
    echo "  ok    $name"
  else
    echo "  FAIL  $name"
    sed 's/^/        /' /tmp/9agent-check.log | tail -20
    fails=$((fails + 1))
  fi
}

echo "9agent checks"

check "typecheck (src + tests)" npx tsc --noEmit
# Must actually emit: with --noEmit this passed while dist/ was stale, which is
# the exact trap the build config exists to close.
check "build emits" npx tsc -p tsconfig.build.json
check "unit tests" npm test

# Regression guard: excluding __test__ from tsconfig.json once silently left the
# whole suite typechecked nowhere, because tsx strips types without checking them.
if [ "$(npx tsc --noEmit --explainFiles 2>/dev/null | grep -c __test__)" -gt 0 ]; then
  echo "  ok    tests are typechecked"
else
  echo "  FAIL  tests are typechecked (tsconfig.json is excluding __test__ again)"
  fails=$((fails + 1))
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "0 failures"
else
  echo "$fails failure(s)"
fi
exit "$fails"
