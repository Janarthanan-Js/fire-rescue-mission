#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Fire Rescue Mission - APK build (Gradle-free, hand-rolled toolchain)
#
#   javac  -> compile the WebView activity against android.jar
#   d8     -> convert .class to DEX
#   aapt2  -> compile + link resources & assets into a base APK
#   zip    -> inject classes.dex
#   zipalign -> 4-byte align for Android
#   apksigner -> sign with the release keystore (APK Signature Scheme v2/v3)
#
# Toolchain: build-tools r34 + platform android-34, OpenJDK 21.
# ---------------------------------------------------------------------------
set -euo pipefail

SDK="${SDK:-/home/user/tools/sdk}"
BT="$SDK/android-14"                 # build-tools r34 (extracts to this folder name)
AJ="$SDK/android-34/android.jar"     # platform android-34

# Portable JDK (javac is not on PATH in this environment)
if ! command -v javac >/dev/null 2>&1; then
  JDK_BIN="$(ls -d /home/user/tools/jdk-*/bin 2>/dev/null | head -1)"
  [ -n "$JDK_BIN" ] && export PATH="$JDK_BIN:$PATH"
fi

PROJ="$(cd "$(dirname "$0")" && pwd)"
APP="$PROJ/app"
BUILD="$PROJ/build"
OUT="$PROJ/out"
KS="$PROJ/keystore/release.jks"
KS_PASS="firerescue123"
KS_ALIAS="firerescue"

PKG_NAME="FireRescueMission"
APK_NAME="FireRescueMission-1.0.0.apk"

for tool in "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner"; do
  [ -x "$tool" ] || { echo "MISSING TOOL: $tool"; exit 1; }
done
[ -f "$AJ" ] || { echo "MISSING android.jar: $AJ"; exit 1; }

rm -rf "$BUILD" "$OUT"
mkdir -p "$BUILD/res_compiled" "$BUILD/gen" "$BUILD/classes" "$BUILD/dex" "$OUT"

echo "]] 1/6  aapt2 compile resources"
"$BT/aapt2" compile --dir "$APP/res" -o "$BUILD/res.zip"

echo "]] 2/6  javac compile"
find "$APP/src" -name '*.java' > "$BUILD/sources.txt"
javac -source 8 -target 8 -encoding UTF-8 \
  -classpath "$AJ" \
  -d "$BUILD/classes" \
  @"$BUILD/sources.txt" 2>&1 | grep -v "source value 8\|target value 8\|deprecat\|warning: \[options\]" || true
[ -f "$BUILD/classes/com/firerescuemission/game/GameActivity.class" ] || { echo "JAVAC FAILED"; exit 1; }

echo "]] 3/6  d8 -> dex"
find "$BUILD/classes" -name '*.class' > "$BUILD/classes.txt"
"$BT/d8" --lib "$AJ" --min-api 24 --output "$BUILD/dex" @"$BUILD/classes.txt"

echo "]] 4/6  aapt2 link (resources + assets -> base APK)"
"$BT/aapt2" link \
  -o "$BUILD/base.apk" \
  -I "$AJ" \
  --manifest "$APP/AndroidManifest.xml" \
  -A "$APP/assets" \
  --java "$BUILD/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code 1 \
  --version-name 1.0.0 \
  "$BUILD/res.zip"

echo "]] 5/6  inject dex + zipalign"
cp "$BUILD/base.apk" "$BUILD/unsigned.apk"
for dex in "$BUILD"/dex/*.dex; do
  ( cd "$BUILD/dex" && zip -q -j "$BUILD/unsigned.apk" "$(basename "$dex")" )
done
"$BT/zipalign" -f -p 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

echo "]] 6/6  apksigner"
"$BT/apksigner" sign \
  --ks "$KS" \
  --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" \
  --key-pass "pass:$KS_PASS" \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$OUT/$APK_NAME" \
  "$BUILD/aligned.apk"

echo ""
echo "BUILD OK -> $OUT/$APK_NAME"
ls -la "$OUT/"
