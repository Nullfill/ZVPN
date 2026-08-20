#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root"; exit 1; }
OUT="${1:-/root/zvpn-backups}"
TS="$(date +%Y%m%d-%H%M%S)"
DIR="$OUT/$TS"
mkdir -p "$DIR"
cp -a /opt/zvpn-panel/app/backend/.env "$DIR/panel.env" 2>/dev/null || true
cp -a /etc/ipsec.conf /etc/ipsec.secrets /etc/ipsec.d/zvpn-users.secrets "$DIR/" 2>/dev/null || true
cp -a /etc/ipsec.d/cacerts/ikev2-ca-cert.pem "$DIR/" 2>/dev/null || true
cp -a /etc/ipsec.d/certs/ikev2-server-cert.pem "$DIR/" 2>/dev/null || true
cp -a /etc/ipsec.d/private/ikev2-server-key.pem "$DIR/" 2>/dev/null || true
DB_URL="$(grep '^DATABASE_URL=' /opt/zvpn-panel/app/backend/.env | cut -d= -f2-)"
pg_dump "$DB_URL" | gzip -9 > "$DIR/database.sql.gz"
chmod -R go-rwx "$DIR"
tar -C "$OUT" -czf "$OUT/zvpn-$TS.tar.gz" "$TS"
rm -rf "$DIR"
echo "$OUT/zvpn-$TS.tar.gz"
