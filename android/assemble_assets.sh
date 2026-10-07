#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Assemble the offline web bundle that ships inside the APK
# (android/app/assets/www).  Run this after editing anything in
# public/static/game/ or public/static/style.css.
#
# The game JS + CSS are copied from the web project (single source of truth);
# fonts and Font Awesome are kept in-place under assets/www (bundled once).
# ---------------------------------------------------------------------------
set -euo pipefail

PROJ="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$PROJ/public/static"
A="$PROJ/android/app/assets/www"
PRELUDE="$PROJ/android/fonts_prelude.css"

[ -d "$A/game" ] || { echo "missing $A/game"; exit 1; }
[ -d "$A/fonts" ] || { echo "missing $A/fonts (bundled fonts)"; exit 1; }

# 1. game scripts (source of truth)
cp "$SRC/game/"*.js "$A/game/"

# 2. style.css = local @font-face prelude + the web stylesheet
cat "$PRELUDE" "$SRC/style.css" > "$A/style.css"

echo "assets assembled -> $A"
ls "$A/game" | sed 's/^/  game\//'
echo "  style.css ($(wc -l < "$A/style.css") lines)"
