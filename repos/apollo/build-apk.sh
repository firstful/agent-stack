#!/usr/bin/env bash
# build-apk.sh — Build Apollo debug APK with auto-versioning
# and deploy to files.ffilt.us with version in the filename.
#
# Usage:  ./build-apk.sh          # build + deploy
#         ./build-apk.sh --no-deploy  # build only
set -euo pipefail

cd "$(dirname "$0")/android"

echo "=== Building Apollo APK ==="
./gradlew assembleDebug

# Read the generated BuildConfig for version info
BUILD_DIR="app/build/generated/source/buildConfig/debug/com/reedsutliff/apollo"
if [ -f "$BUILD_DIR/BuildConfig.java" ]; then
    VERSION_NAME=$(grep 'VERSION_NAME' "$BUILD_DIR/BuildConfig.java" | sed 's/.*"\(.*\)".*/\1/')
    VERSION_CODE=$(grep 'VERSION_CODE' "$BUILD_DIR/BuildConfig.java" | sed 's/.*= \([0-9]*\);.*/\1/')
else
    echo "ERROR: BuildConfig not found at $BUILD_DIR/BuildConfig.java" >&2
    exit 1
fi

APK_SRC="app/build/outputs/apk/debug/app-debug.apk"
FILENAME="apollo-${VERSION_NAME}.apk"
DEST_DIR="/srv/files/apk/Apollo"

echo ""
echo "=== Deploying to $DEST_DIR/ ==="
echo "  Version: $VERSION_NAME  (code $VERSION_CODE)"
echo "  APK:     $FILENAME"

mkdir -p "$DEST_DIR"

cp "$APK_SRC" "$DEST_DIR/$FILENAME"
# Remove old builds except the latest 5
ls -1t "$DEST_DIR"/apollo-*.apk 2>/dev/null | tail -n +6 | xargs -r rm -f
# Update latest symlink
ln -sf "$FILENAME" "$DEST_DIR/apollo-latest.apk"

echo "  ✅ $DEST_DIR/$FILENAME  ($(du -h "$DEST_DIR/$FILENAME" | cut -f1))"
echo "  ✅ Symlink: $DEST_DIR/apollo-latest.apk → $FILENAME"
echo ""
echo "  URL: https://files.ffilt.us/apk/Apollo/$FILENAME"
echo "  URL: https://files.ffilt.us/apk/Apollo/apollo-latest.apk"
