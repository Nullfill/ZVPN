#!/usr/bin/env bash
# Apply v2.1.0 patches after rsync — run on server as root
set -Eeuo pipefail
APP_DIR="${APP_DIR:-/opt/zvpn-panel/app}"
[[ $EUID -eq 0 ]] || { echo "Run as root"; exit 1; }

echo "[v2.1] Applying migration 003..."
DB_URL="$(grep '^DATABASE_URL=' "$APP_DIR/backend/.env" | cut -d= -f2-)"
if [[ -f "$APP_DIR/ops/migrations/003_vpn_settings_backup.sql" && -n "$DB_URL" ]]; then
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/ops/migrations/003_vpn_settings_backup.sql" >/dev/null || true
  psql "$DB_URL" -c "INSERT INTO schema_migrations(version) VALUES('003_vpn_settings_backup') ON CONFLICT DO NOTHING" 2>/dev/null || true
fi

echo "[v2.1] Patching server.js..."
cd "$APP_DIR/backend"
node scripts/patch-v2.1-server.js

echo "[v2.1] Rebuilding frontend..."
cd "$APP_DIR/frontend"
npm install @fontsource/vazirmatn --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund
npm run build

echo "[v2.1] Restarting panel..."
systemctl restart zvpn-panel
sleep 2
curl -fsS http://127.0.0.1:3300/api/health && echo
echo "[v2.1] Done. Set VPN address in Admin → Settings."
