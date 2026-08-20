#!/usr/bin/env bash
# Create a minimal release zip (source only, no node_modules)
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$ROOT/../zvpn-panel-release.zip}"
TMP="$(mktemp -d)"
NAME="zvpn-panel"
cp -a "$ROOT" "$TMP/$NAME"
rm -rf "$TMP/$NAME/frontend/node_modules" "$TMP/$NAME/backend/node_modules" "$TMP/$NAME/frontend/dist" 2>/dev/null || true
find "$TMP/$NAME" -name '.git' -o -name '*.zip' | head -1 >/dev/null
cd "$TMP"
zip -rq "$OUT" "$NAME"
rm -rf "$TMP"
echo "Created: $OUT ($(du -h "$OUT" | cut -f1))"
