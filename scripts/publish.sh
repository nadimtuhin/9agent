#!/bin/bash
set -euo pipefail

# Release: bump version, prepend a CHANGELOG stub, publish, then tag.
# `npm version` does the bump + commit + tag; we do not reimplement semver.

usage() {
  cat <<'EOF'
Usage: scripts/publish.sh [options]
  -M, --major    Bump major (1.2.3 -> 2.0.0)
  -m, --minor    Bump minor (1.2.3 -> 1.3.0)   [default]
  -p, --patch    Bump patch (1.2.3 -> 1.2.4)
  -f, --force    Publish with a dirty working tree
  -h, --help     This message
EOF
  exit 1
}

BUMP=minor
FORCE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    -M|--major) BUMP=major; shift ;;
    -m|--minor) BUMP=minor; shift ;;
    -p|--patch) BUMP=patch; shift ;;
    -f|--force) FORCE=true; shift ;;
    -h|--help)  usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

if ! $FORCE && ! git diff --quiet HEAD; then
  echo "Error: uncommitted changes. Commit, stash, or pass --force." >&2
  exit 1
fi

CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

npm run check

# --no-git-tag-version: we tag after npm publish succeeds, so a failed publish
# does not strand a tag. Prints the new version as "vX.Y.Z".
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
NEW_VERSION=${NEW_VERSION#v}
echo "New version: $NEW_VERSION"

# ponytail: insert a stub section directly under the "# Changelog" title (line 1),
# above the newest release. The human writes the real entry before committing.
# Anything smarter needs a changelog parser we do not have.
awk -v v="$NEW_VERSION" '
  NR == 1 { print; print ""; print "## " v; print ""; print "- TODO: describe this release"; print ""; next }
  NR == 2 && $0 == "" { next }
  { print }
' CHANGELOG.md > CHANGELOG.md.tmp
mv CHANGELOG.md.tmp CHANGELOG.md

git add package.json package-lock.json CHANGELOG.md
git commit -m "release: v$NEW_VERSION"

npm publish --access public

git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
git push origin HEAD "v$NEW_VERSION"

echo "Released v$NEW_VERSION"
