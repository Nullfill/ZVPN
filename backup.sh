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

mkdir -p "$WORKDIR/ipsec.d/cacerts" "$WORKDIR/ipsec.d/certs" \
         "$WORKDIR/ipsec.d/private" "$WORKDIR/letsencrypt" \
         "$WORKDIR/nginx" "$WORKDIR/systemd" "$WORKDIR/runtime"

cp -f "$ENV_FILE" "$WORKDIR/panel.env"                                    2>/dev/null || true
cp -rf /etc/ipsec.d/cacerts/. "$WORKDIR/ipsec.d/cacerts/"                2>/dev/null || true
cp -rf /etc/ipsec.d/certs/.   "$WORKDIR/ipsec.d/certs/"                  2>/dev/null || true
cp -rf /etc/ipsec.d/private/. "$WORKDIR/ipsec.d/private/"                2>/dev/null || true
cp -f  /etc/ipsec.conf        "$WORKDIR/ipsec.conf"                       2>/dev/null || true
cp -f  /etc/ipsec.secrets     "$WORKDIR/ipsec.secrets"                    2>/dev/null || true
cp -f  /etc/ipsec.d/zvpn-users.secrets "$WORKDIR/zvpn-users.secrets"     2>/dev/null || true
cp -rf /etc/letsencrypt/.     "$WORKDIR/letsencrypt/"                     2>/dev/null || true
cp -f  /etc/nginx/sites-available/zvpn-panel "$WORKDIR/nginx/"            2>/dev/null || true
cp -f  /etc/systemd/system/zvpn-panel.service "$WORKDIR/systemd/"         2>/dev/null || true
cp -rf /opt/zvpn-panel/runtime/. "$WORKDIR/runtime/"                      2>/dev/null || true

DB_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
pg_dump "$DB_URL" | gzip -9 > "$WORKDIR/database.sql.gz"

chmod -R go-rwx "$WORKDIR"
mkdir -p "$OUT"
OUTFILE="$OUT/zvpn-$TS.tar.gz"
tar -czf "$OUTFILE" -C "$WORKDIR" .
echo "$OUTFILE"
