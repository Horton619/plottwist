#!/usr/bin/env bash
# Build all icon assets from build/icon.svg.
#   • build/icon.icns  — macOS (multi-resolution iconset)
#   • build/icon.ico   — Windows (multi-resolution ICO)
#   • build/dmg-bg.png — DMG installer background
#
# Requires: rsvg-convert, magick (ImageMagick), iconutil (Apple).

set -euo pipefail
cd "$(dirname "$0")/.."

SVG=build/icon.svg
test -f "$SVG" || { echo "missing $SVG"; exit 1; }

ICONSET=build/_iconset.iconset
rm -rf "$ICONSET" && mkdir -p "$ICONSET"

echo "Rasterizing SVG → PNG at the macOS iconset sizes…"
for s in 16 32 64 128 256 512 1024; do
  rsvg-convert -w "$s" -h "$s" -o "$ICONSET/icon_${s}.png" "$SVG"
done

# macOS .icns wants paired sizes (NxN + NxN@2x).
cp "$ICONSET/icon_16.png"   "$ICONSET/icon_16x16.png"
cp "$ICONSET/icon_32.png"   "$ICONSET/icon_16x16@2x.png"
cp "$ICONSET/icon_32.png"   "$ICONSET/icon_32x32.png"
cp "$ICONSET/icon_64.png"   "$ICONSET/icon_32x32@2x.png"
cp "$ICONSET/icon_128.png"  "$ICONSET/icon_128x128.png"
cp "$ICONSET/icon_256.png"  "$ICONSET/icon_128x128@2x.png"
cp "$ICONSET/icon_256.png"  "$ICONSET/icon_256x256.png"
cp "$ICONSET/icon_512.png"  "$ICONSET/icon_256x256@2x.png"
cp "$ICONSET/icon_512.png"  "$ICONSET/icon_512x512.png"
cp "$ICONSET/icon_1024.png" "$ICONSET/icon_512x512@2x.png"
# Strip the single-size copies — iconutil ignores them but they pad the iconset.
rm "$ICONSET/icon_16.png"  "$ICONSET/icon_32.png"   "$ICONSET/icon_64.png" \
   "$ICONSET/icon_128.png" "$ICONSET/icon_256.png"  "$ICONSET/icon_512.png" \
   "$ICONSET/icon_1024.png"

echo "Building build/icon.icns…"
iconutil -c icns -o build/icon.icns "$ICONSET"
rm -rf "$ICONSET"

echo "Building build/icon.ico (Windows, 16/32/48/64/128/256)…"
TMP=build/_ico
rm -rf "$TMP" && mkdir -p "$TMP"
for s in 16 32 48 64 128 256; do
  rsvg-convert -w "$s" -h "$s" -o "$TMP/icon_${s}.png" "$SVG"
done
magick "$TMP/icon_16.png" "$TMP/icon_32.png" "$TMP/icon_48.png" \
       "$TMP/icon_64.png" "$TMP/icon_128.png" "$TMP/icon_256.png" \
       build/icon.ico
rm -rf "$TMP"

echo "Building build/dmg-bg.png (540×380, navy with brand mark)…"
DMGBG=build/_dmgbg
mkdir -p "$DMGBG"
# Small ghosted mark in the top-left for branding; the app + Applications
# alias positions in package.json land below. No text — Finder shows the
# app name under the icon already.
rsvg-convert -w 96 -h 96 -o "$DMGBG/mark.png" "$SVG"
magick -size 540x380 xc:'#070910' \
       \( "$DMGBG/mark.png" -alpha set -channel A -evaluate multiply 0.6 +channel \) \
       -gravity NorthWest -geometry +24+24 -composite \
       build/dmg-bg.png
rm -rf "$DMGBG"

echo "Done."
echo "Outputs:"
ls -lh build/icon.icns build/icon.ico build/dmg-bg.png
