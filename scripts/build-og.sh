#!/usr/bin/env bash
# Compose site/og.png (1200x630) from an AI backdrop + real text.
#
# The backdrop comes from 9router (see the 9router-image skill); the text is
# drawn here with ImageMagick rather than generated, so the wordmark and the
# install command are pixel-exact instead of whatever the model hallucinates.
#
# Usage: scripts/build-og.sh [backdrop.png]
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
backdrop=${1:-$root/assets/og-backdrop.jpg}
out=$root/site/og.png

MONO=/System/Library/Fonts/Menlo.ttc
BG='#0c0d10'
FG='#e6e8ee'
MUTED='#969cab'
ACCENT='#7dd3a0'

# Menlo is monospace: every glyph advances the same fraction of the point size.
# That constant is what lets us place the two-tone wordmark by arithmetic
# instead of measuring rendered text.
MENLO_ADVANCE=0.6

pad=80
mark_pt=104
mark_y=300

# Backdrop: cover 1200x630, then pull it down hard so it reads as atmosphere
# behind the text rather than competing with it.
magick "$backdrop" \
  -resize '1200x630^' -gravity center -extent 1200x630 \
  -modulate 42,90,100 \
  -fill "$BG" -colorize 35% \
  "$out"

mark_x=$pad
nine_w=$(python3 -c "print(round($mark_pt * $MENLO_ADVANCE))")

magick "$out" \
  -font "$MONO" -pointsize "$mark_pt" \
  -fill "$ACCENT" -annotate "+${mark_x}+${mark_y}" '9' \
  -fill "$FG"     -annotate "+$((mark_x + nine_w))+${mark_y}" 'agent' \
  -fill '#23262e' -draw "rectangle $pad,$((mark_y + 42)) $((1200 - pad)),$((mark_y + 43))" \
  -font "$MONO" -pointsize 34 -fill "$FG" \
  -annotate "+${pad}+$((mark_y + 110))" 'One launcher for Claude Code, Pi, and Hermes.' \
  -font "$MONO" -pointsize 30 \
  -fill "$ACCENT" -annotate "+${pad}+$((mark_y + 190))" '$' \
  -fill "$MUTED"  -annotate "+$((pad + 36))+$((mark_y + 190))" 'npm i -g 9agent' \
  -font "$MONO" -pointsize 22 -fill "$MUTED" \
  -annotate "+${pad}+$((630 - 58))" 'MIT · github.com/nadimtuhin/9agent' \
  -strip "$out"

magick identify "$out"
