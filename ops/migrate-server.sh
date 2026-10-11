#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$TOOLS/migrate-full-server.sh" ]]; then
    exec bash "$TOOLS/migrate-full-server.sh" "$@"
fi
# A downloaded entry point must also work outside the repository, e.g. /tmp.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fsSL --retry 3 https://codeload.github.com/Nullfill/ZVPN/tar.gz/refs/heads/main -o "$WORK/tools.tar.gz"
tar -xzf "$WORK/tools.tar.gz" -C "$WORK" --strip-components=1 \
    ZVPN-main/ops/migrate-full-server.sh ZVPN-main/ops/full-backup.py \
    ZVPN-main/ops/restore-full-backup.py ZVPN-main/ops/restore-full-backup.sh
bash "$WORK/ops/migrate-full-server.sh" "$@"
