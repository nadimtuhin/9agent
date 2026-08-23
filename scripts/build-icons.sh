#!/usr/bin/env bash
# Build the favicon set into site/ from the same Menlo "9" used in the wordmark.
#
# Sizes follow the modern minimum: one .ico for legacy browsers, a 180px
# apple-touch-icon, and 192/512 PNGs for the web manifest. Anything more is
# dead weight no current browser asks for.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
site=$root/site

MONO=/System/Library/Fonts/Menlo.ttc
BG='#0c0d10'
ACCENT='#7dd3a0'

# Render one square "9" tile at the given edge length.
# The glyph is centred optically, not mathematically: a digit's ink sits above
# the baseline, so gravity centring alone leaves it looking low.
tile() {
  local size=$1 out=$2
  local radius=$((size / 5))
  magick -size "${size}x${size}" xc:none \
    -fill "$BG" -draw "roundrectangle 0,0 $((size - 1)),$((size - 1)) $radius,$radius" \
    -font "$MONO" -pointsize "$(python3 -c "print(round($size * 0.78))")" \
    -fill "$ACCENT" -gravity center -annotate "+0+$(python3 -c "print(round($size * 0.04))")" '9' \
    -strip "$out"
}

for s in 512 192 180 48 32 16; do
  tile "$s" "$site/icon-$s.png"
done

# .ico bundles the three legacy sizes in one file.
magick "$site/icon-16.png" "$site/icon-32.png" "$site/icon-48.png" "$site/favicon.ico"

# apple-touch-icon must be opaque — iOS renders transparency as black and the
# rounded corners get clipped again by the OS mask.
magick "$site/icon-180.png" -background "$BG" -alpha remove -alpha off "$site/apple-touch-icon.png"

mv "$site/icon-512.png" "$site/icon-512.tmp" && mv "$site/icon-512.tmp" "$site/icon-512.png"
rm -f "$site/icon-16.png" "$site/icon-32.png" "$site/icon-48.png" "$site/icon-180.png"

magick identify "$site/favicon.ico" "$site/apple-touch-icon.png" "$site/icon-192.png" "$site/icon-512.png"
