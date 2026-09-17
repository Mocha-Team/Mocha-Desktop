#!/bin/bash
# Package a Wails macOS .app into a styled, DMG-only installer via dmgbuild.
# Layout: Mocha.app left, /Applications drop link right, dark custom background.
# Asset: build/darwin/dmg-background.png (1320x800, 2x of the 660x400 window).
# Requires: dmgbuild (`pip install dmgbuild`).
# Usage: bash build/darwin/package-dmg.sh [path/to/app.app]
set -euo pipefail

APP_PATH="${1:-build/bin/Mocha.app}"
# Display name (bundle) differs from the binary Wails emits.
BIN_NAME="${BIN_NAME:-mocha-desktop}"
APP_NAME="$(basename "$APP_PATH" .app)"
BIN_DIR="$(dirname "$APP_PATH")"
BIN_PATH="$APP_PATH/Contents/MacOS/$BIN_NAME"
DMG_PATH="$BIN_DIR/$APP_NAME.dmg"

if [ ! -d "$APP_PATH" ]; then
  echo "error: .app not found at $APP_PATH (run 'wails build' first)" >&2
  exit 1
fi
if [ ! -f "$BIN_PATH" ]; then
  echo "error: binary not found at $BIN_PATH" >&2
  exit 1
fi
if [ ! -f "build/darwin/dmg-background.png" ]; then
  echo "error: background not found at build/darwin/dmg-background.png" >&2
  exit 1
fi
if ! python3 -c "import dmgbuild" >/dev/null 2>&1; then
  echo "error: dmgbuild not found (run 'pip install dmgbuild')" >&2
  exit 1
fi

# Executable bit is lost by some upload/extract flows; restore it.
chmod +x "$BIN_PATH"
# Strip quarantine flags inherited from CI checkouts/downloads.
xattr -cr "$APP_PATH" || true
# Ad-hoc sign so Gatekeeper treats the bundle as one unit. Replace `-`
# with a Developer ID identity + notarization for public distribution.
codesign --sign - --force --deep "$APP_PATH"
codesign --verify --strict "$APP_PATH"

rm -f "$DMG_PATH"
python3 -m dmgbuild \
  -s build/darwin/dmg-settings.py \
  -D "app=$APP_PATH" \
  -D "out=$DMG_PATH" \
  "Mocha" "$DMG_PATH"

echo "app: $APP_PATH"
echo "dmg: $DMG_PATH"
