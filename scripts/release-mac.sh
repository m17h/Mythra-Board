#!/bin/sh
# Builds a signed Mythra Board.app and .dmg for macOS.
#
# Signing uses the "Developer ID Application" certificate in your keychain. To also have
# Apple notarise it (so it opens on other Macs without warnings), set these first:
#   export APPLE_ID="you@example.com"            # your Apple ID email
#   export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # an app-specific password from appleid.apple.com
#   export APPLE_TEAM_ID="Q39WKZ9SP2"
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

APPLE_SIGNING_IDENTITY="$IDENTITY" pnpm tauri build --bundles app,dmg

APP="src-tauri/target/release/bundle/macos/Mythra Board.app"
codesign --verify --deep --strict "$APP"
echo "Signature OK."
ls src-tauri/target/release/bundle/dmg/*.dmg
