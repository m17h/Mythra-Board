#!/bin/sh
# Builds a signed Mythra Board.app and .dmg for macOS.
#
# Signing uses the "Developer ID Application" certificate in your keychain. To also have
# Apple notarise it (so it opens on other Macs without warnings), set these first:
#   export APPLE_ID="you@example.com"            # your Apple ID email
#   export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # an app-specific password from appleid.apple.com
#   export APPLE_TEAM_ID="Q39WKZ9SP2"
#
# Automatic updates: if the update-signing key is at ~/.tauri/mythra-board.key (or
# TAURI_SIGNING_PRIVATE_KEY is set), it also makes the update files and a latest.json.
# Upload all three to a GitHub release on github.com/m17h/Mythra-Board tagged v<version>.
set -eu
cd "$(dirname "$0")/.."

IDENTITY="${APPLE_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | head -1)}"
if [ -z "$IDENTITY" ]; then
  echo "No Developer ID Application certificate found in your keychain." >&2
  exit 1
fi
echo "Signing with: $IDENTITY"
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  echo "Notarisation: on"
else
  echo "Notarisation: off (set APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID to turn it on)"
fi

KEY_FILE="$HOME/.tauri/mythra-board.key"
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -f "$KEY_FILE" ]; then
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
  export TAURI_SIGNING_PRIVATE_KEY
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
fi
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "Update files: on"
  set -- --config src-tauri/tauri.release.conf.json
else
  echo "Update files: off (no key at $KEY_FILE)"
  set --
fi

APPLE_SIGNING_IDENTITY="$IDENTITY" pnpm tauri build --bundles app,dmg "$@"

APP="src-tauri/target/release/bundle/macos/Mythra Board.app"
codesign --verify --deep --strict "$APP"
echo "Signature OK."
DMG="$(ls -t src-tauri/target/release/bundle/dmg/*.dmg | head -1)"
echo "$DMG"

# The app inside is already notarised; notarise the disk image too, so it opens cleanly when downloaded.
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
  xcrun stapler staple "$DMG"
  spctl --assess --type open --context context:primary-signature -v "$DMG"
  spctl --assess --type execute -v "$APP"
fi

BUNDLE="src-tauri/target/release/bundle/macos"
if [ -f "$BUNDLE/Mythra Board.app.tar.gz.sig" ]; then
  VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' src-tauri/tauri.conf.json | head -1)"
  case "$(uname -m)" in arm64) ARCH=aarch64 ;; *) ARCH=x86_64 ;; esac
  # GitHub swaps spaces in uploaded file names for dots.
  URL="https://github.com/m17h/Mythra-Board/releases/download/v$VERSION/Mythra.Board.app.tar.gz"
  SIG="$(cat "$BUNDLE/Mythra Board.app.tar.gz.sig")"
  cat > "$BUNDLE/latest.json" <<JSON
{
  "version": "$VERSION",
  "notes": "",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "darwin-$ARCH": { "signature": "$SIG", "url": "$URL" }
  }
}
JSON
  echo "Update files:"
  ls "$BUNDLE"/*.tar.gz "$BUNDLE"/latest.json
fi
