#!/usr/bin/env bash
# Release 9agent to npm.
#
# Why this exists rather than plain `npm publish`: npm runs `prepack` to build
# dist/, but a user-level `ignore-scripts=true` in ~/.npmrc silently skips it.
# The result is a tarball with no dist/ and a bin/ that immediately crashes —
# and npm reports success. This script builds explicitly, then refuses to
# publish a tarball that does not contain a working CLI.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
TARBALL="/tmp/9agent-${VERSION}.tgz"
echo "9agent release ${VERSION}"

echo "==> working tree"
# Publishing from a dirty tree ships code that exists on no commit, so the
# published artifact can never be reproduced from git.
git diff --quiet && git diff --cached --quiet \
  || { echo "FAIL: uncommitted changes — commit or stash before releasing."; exit 1; }

echo "==> gate"
bash scripts/checks.sh

echo "==> build (explicit: never trust the prepack lifecycle here)"
rm -rf dist
npm run build

echo "==> pack"
rm -f "$TARBALL"
npm pack --pack-destination /tmp >/dev/null

echo "==> verify the tarball actually ships a CLI"
tar tzf "$TARBALL" | grep -q "package/dist/index.js" \
  || { echo "FAIL: dist/index.js missing from ${TARBALL}"; exit 1; }
tar tzf "$TARBALL" | grep -q "package/bin/9agent.js" \
  || { echo "FAIL: bin/9agent.js missing from ${TARBALL}"; exit 1; }

echo "==> smoke-test the packed artifact, not the working tree"
SMOKE=$(mktemp -d)
trap 'rm -rf "$SMOKE"' EXIT
tar xzf "$TARBALL" -C "$SMOKE"
(cd "$SMOKE/package" && npm install --omit=dev --silent --ignore-scripts >/dev/null 2>&1)
OUT=$(cd "$SMOKE/package" && node bin/9agent.js --help 2>&1) \
  || { echo "FAIL: packed CLI does not run:"; echo "$OUT"; exit 1; }
grep -q -- "--sandbox" <<<"$OUT" \
  || { echo "FAIL: packed CLI is missing --sandbox; stale dist?"; exit 1; }

VOUT=$(cd "$SMOKE/package" && node bin/9agent.js --version 2>&1)
[ "$VOUT" = "$VERSION" ] \
  || { echo "FAIL: packed CLI reports version '${VOUT}', expected '${VERSION}'"; exit 1; }

# --help only loads the module graph. Drive a real launch far enough to reach
# discovery and an adapter, against a port nothing listens on, with a throwaway
# HOME so no cached model list can mask a failure. Deterministic, no gateway.
FAKE_HOME=$(mktemp -d)
DOUT=$(cd "$SMOKE/package" && HOME="$FAKE_HOME" node bin/9agent.js \
  --gateway http://127.0.0.1:59999/v1 -a claude -m x --yes safe --print-only 2>&1 || true)
rm -rf "$FAKE_HOME"
grep -q "Is 9Router running?" <<<"$DOUT" \
  || { echo "FAIL: offline path did not produce its usual error:"; echo "$DOUT"; exit 1; }
echo "    ok  packed CLI runs, reports ${VERSION}, and fails legibly offline"

echo "==> publish"
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "    DRY_RUN=1 — stopping before publish. Tarball: ${TARBALL}"
  exit 0
fi
npm publish "$TARBALL" --access public
echo "published 9agent@${VERSION}"
