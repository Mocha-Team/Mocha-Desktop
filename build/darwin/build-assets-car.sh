#!/bin/sh
# Build a true macOS liquid-glass icon (Tahoe+) from an Icon Composer .icon
# source and inject it into an already-built Wails .app.
#
# WHY THIS EXISTS: Wails v2 only ships a static appicon.png -> iconfile.icns.
# A live liquid-glass icon (blurs wallpaper, auto-switches light/dark) needs
# an asset catalog (Assets.car) + CFBundleIconName, compiled by Xcode's actool.
#
# REQUIREMENTS: macOS 26+, full Xcode (actool at /usr/bin/actool), existing
# build/appicon.icon source (create from build/appicon.glyph.svg in Icon
# Composer: glass background layer + glyph layer, light + dark variants).
#
# USAGE:
#   1. wails build
#   2. APP="build/bin/Mocha.app" ./build/darwin/build-assets-car.sh
#
# ponytail: static fallback stays build/appicon.png; run this only for live glass.
set -eu

APP="${1:-${APP:-}}"
if [ -z "$APP" ]; then
  echo "usage: APP=<path to .app> $0  (or pass .app as \$1)" >&2
  exit 1
fi
if [ ! -d "$APP" ]; then
  echo "no such .app bundle: $APP (run wails build first)" >&2
  exit 1
fi
if [ "$(uname)" != "Darwin" ]; then
  echo "mac asset generation is only supported on macOS" >&2
  exit 1
fi
if [ ! -x /usr/bin/actool ]; then
  echo "actool not found (install full Xcode 26+, CLT alone is not enough)" >&2
  exit 1
fi
if [ ! -e build/appicon.icon ]; then
  echo "missing build/appicon.icon (author it in Icon Composer first)" >&2
  exit 1
fi

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
/usr/bin/actool build/appicon.icon \
  --compile "$OUT" \
  --notices --warnings --errors \
  --output-partial-info-plist "$OUT/temp.plist" \
  --app-icon appicon \
  --enable-on-demand-resources NO \
  --development-region en \
  --target-device mac \
  --minimum-deployment-target 26.0 \
  --platform macosx
rm -f "$OUT/temp.plist"
mv "$OUT/Assets.car" "$APP/Contents/Resources/Assets.car"
if [ -f "$OUT/icons.icns" ]; then
  mv "$OUT/icons.icns" "$APP/Contents/Resources/iconfile.icns"
fi
/usr/libexec/PlistBuddy -c "Add :CFBundleIconName string appicon" "$APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleIconName appicon" "$APP/Contents/Info.plist"
/usr/bin/touch -c "$APP"
echo "injected Assets.car + CFBundleIconName=appicon into $APP"
