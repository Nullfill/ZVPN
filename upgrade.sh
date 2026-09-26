#!/usr/bin/env bash
# ============================================================
#  ZVPN Panel — Upgrade Script
#  Usage:  sudo bash upgrade.sh
#  Run from inside the app directory (/opt/zvpn-panel/app)
#  Works with: git pull + this script — no ZIP release needed
# ============================================================
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash upgrade.sh"; exit 1; }

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$APP_DIR/backend/.env"

C='\033[1;36m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; N='\033[0m'
info(){ echo -e "${C}[ZVPN]${N} $*"; }
ok(){   echo -e "${G}[OK]${N} $*"; }
warn(){ echo -e "${Y}[!]${N} $*"; }
die(){  echo -e "${R}[ERROR]${N} $*" >&2; exit 1; }

# ── Sanity checks ───────────────────────────────────────────
[[ -f "$ENV_FILE" ]] || die "No .env found at $ENV_FILE — is this a ZVPN install?"
[[ -f "$APP_DIR/backend/package.json" ]] || die "Run this script from the ZVPN app directory"

NEW_VERSION="$(cat "$APP_DIR/VERSION" 2>/dev/null || echo unknown)"

echo "============================================="
echo "       ZVPN Panel Self-Upgrade"
echo "       Version: $NEW_VERSION"
echo "============================================="
echo

# ── Step 1: Pull latest code ────────────────────────────────
info "Pulling latest code from GitHub..."
git -C "$APP_DIR" pull origin main || die "git pull failed — check network / SSH keys"
ok "Code updated"

NEW_VERSION="$(cat "$APP_DIR/VERSION" 2>/dev/null || echo unknown)"

# ── Step 2: Stop service ────────────────────────────────────
info "Stopping ZVPN Panel service..."
if systemctl is-active --quiet zvpn-panel 2>/dev/null; then
  systemctl stop zvpn-panel
  SERVICE_MGR="systemd"
elif command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q zvpn; then
  pm2 stop zvpn-backend 2>/dev/null || true
  SERVICE_MGR="pm2"
else
  warn "No known service manager detected — will attempt manual node kill"
  pkill -f "node.*server.js" 2>/dev/null || true
  SERVICE_MGR="none"
fi
sleep 1
ok "Service stopped (manager: $SERVICE_MGR)"

# ── Step 3: Database migrations ─────────────────────────────
info "Applying database schema and migrations..."
DB_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
[[ -n "$DB_URL" ]] || die "DATABASE_URL missing from $ENV_FILE"

if [[ -f "$APP_DIR/ops/schema.sql" ]]; then
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/ops/schema.sql" >/dev/null
fi

if [[ -d "$APP_DIR/ops/migrations" ]]; then
  psql "$DB_URL" -v ON_ERROR_STOP=1 -c "
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );" >/dev/null
  for mig in "$APP_DIR"/ops/migrations/*.sql; do
    [[ -f "$mig" ]] || continue
    ver="$(basename "$mig" .sql)"
    applied="$(psql "$DB_URL" -tAc "SELECT 1 FROM schema_migrations WHERE version='$ver'" 2>/dev/null | tr -d '[:space:]')"
    if [[ "$applied" != "1" ]]; then
      info "  Applying migration: $ver"
      psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$mig"
      psql "$DB_URL" -c "INSERT INTO schema_migrations(version) VALUES('$ver') ON CONFLICT DO NOTHING" >/dev/null
    fi
  done
fi
ok "Database migrations applied"

# ── Step 4: Node.js dependencies ────────────────────────────
info "Checking Node.js version..."
if ! command -v node >/dev/null || [[ "$(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v')" -lt 20 ]]; then
  info "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y --no-install-recommends nodejs >/dev/null
fi

info "Installing backend dependencies..."
cd "$APP_DIR/backend"
npm ci --omit=dev --no-audit --no-fund

# ── Step 5: Build frontend ───────────────────────────────────
info "Building frontend..."
cd "$APP_DIR/frontend"
npm ci --no-audit --no-fund
npm run build
chown -R root:root "$APP_DIR/frontend/dist"
ok "Frontend built"

# ── Step 6: Update helper & sudoers ─────────────────────────
if [[ -f "$APP_DIR/ops/helper/zvpn-helper" ]]; then
  info "Updating zvpn-helper..."
  install -o root -g root -m 0755 "$APP_DIR/ops/helper/zvpn-helper" /usr/local/sbin/zvpn-helper
fi

chmod +x "$APP_DIR/ops/backup-github.sh" 2>/dev/null || true
chmod +x "$APP_DIR/ops/restore-github.sh" 2>/dev/null || true

# Configure sudoers for zvpn user
cat << 'EOF' > /etc/sudoers.d/zvpn-panel
zvpn ALL=(ALL) NOPASSWD: /usr/local/sbin/zvpn-helper
zvpn ALL=(ALL) NOPASSWD: /opt/zvpn-panel/app/ops/backup-github.sh
EOF
chmod 440 /etc/sudoers.d/zvpn-panel
ok "Helper & sudoers updated"

# ── Step 7: Start service ────────────────────────────────────
info "Starting ZVPN Panel service..."
if [[ "$SERVICE_MGR" == "systemd" ]]; then
  # Update systemd unit if changed
  if [[ -f "$APP_DIR/ops/systemd/zvpn-panel.service" ]]; then
    install -o root -g root -m 0644 "$APP_DIR/ops/systemd/zvpn-panel.service" /etc/systemd/system/zvpn-panel.service
    systemctl daemon-reload
  fi
  systemctl restart zvpn-panel
  sleep 2
  systemctl is-active --quiet zvpn-panel || { journalctl -u zvpn-panel -n 80 --no-pager; die "Panel failed to start"; }

elif [[ "$SERVICE_MGR" == "pm2" ]]; then
  cd "$APP_DIR/backend"
  pm2 restart zvpn-backend 2>/dev/null || pm2 start src/server.js --name zvpn-backend
  sleep 2

else
  # Fallback: start manually in background
  warn "Starting backend manually (no service manager found)..."
  cd "$APP_DIR/backend"
  nohup node src/server.js >> /var/log/zvpn-panel.log 2>&1 &
  sleep 3
fi

# ── Step 8: Health check ─────────────────────────────────────
info "Running health check..."
PORT="${PORT:-3300}"
for i in 1 2 3 4 5; do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    ok "Panel is healthy on port $PORT ✓"
    break
  fi
  if [[ $i -eq 5 ]]; then
    warn "Health check did not respond — check logs:"
    echo "  journalctl -u zvpn-panel -n 50 --no-pager"
    echo "  cat /var/log/zvpn-panel.log"
  fi
  sleep 2
done

# ── Step 9: Reload nginx ─────────────────────────────────────
if command -v nginx >/dev/null && nginx -t >/dev/null 2>&1; then
  systemctl reload nginx 2>/dev/null || true
fi

# ── Done ─────────────────────────────────────────────────────
echo
echo "─────────────────────────────────────────────"
echo "  ZVPN Panel upgraded to $NEW_VERSION"
echo "  .env / database / CA / SSL preserved ✓"
echo "─────────────────────────────────────────────"
