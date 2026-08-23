#!/usr/bin/env bash
# Stamp package.json's version into the landing page's JSON-LD.
#
# Runs as `predeploy`, so a release can never ship a page advertising the
# previous version. Rewrites one field in place rather than templating the
# page, which keeps site/index.html the real source instead of build output.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)

python3 - "$root" <<'PY'
import json, re, sys, pathlib

root = pathlib.Path(sys.argv[1])
version = json.loads((root / "package.json").read_text())["version"]
page = root / "site" / "index.html"
html = page.read_text()

field = re.compile(r'("softwareVersion":\s*")([^"]*)(")')
if not field.search(html):
    sys.exit("no softwareVersion field in the JSON-LD block — nothing to stamp")

updated, count = field.subn(rf'\g<1>{version}\g<3>', html)
if count != 1:
    sys.exit(f"expected exactly one softwareVersion field, found {count}")

# Re-parse the block so a bad substitution fails here rather than silently
# shipping invalid structured data.
block = re.search(r'<script type="application/ld\+json">(.*?)</script>', updated, re.S).group(1)
data = json.loads(block)
assert data["softwareVersion"] == version, "stamp did not take"

if updated != html:
    page.write_text(updated)
    print(f"stamped softwareVersion {version}")
else:
    print(f"softwareVersion already {version}")
PY
