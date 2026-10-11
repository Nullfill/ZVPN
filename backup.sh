#!/usr/bin/env bash
# ================================================================
#  ZVPN Panel — Full Local Backup
#  Usage: sudo bash backup.sh [output_dir]
#  Backs up: DB, IPsec certs, .env, Let's Encrypt, Nginx, runtime
# ================================================================
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash backup.sh"; exit 1; }

APP_DIR=/opt/zvpn-panel/app
ENV_FILE="$APP_DIR/backend/.env"
OUT="${1:-/root/zvpn-backups}"
TS="$(date +%Y%m%d-%H%M%S)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

[[ -f "$ENV_FILE" ]] || { echo "ZVPN not found"; exit 1; }

python3 "$APP_DIR/ops/full-backup.py" --collect "$WORKDIR"

chmod -R go-rwx "$WORKDIR"
mkdir -p "$OUT"
OUTFILE="$OUT/zvpn-$TS.tar.gz"
tar -czf "$OUTFILE" -C "$WORKDIR" .
echo "$OUTFILE"
