#!/usr/bin/env bash
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo ./upgrade.sh"; exit 1; }
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/opt/zvpn-panel/app
ENV_FILE="$APP_DIR/backend/.env"
RUNTIME_SECRETS=/opt/zvpn-panel/runtime/ipsec-users.secrets
IPSEC_USER_SECRETS=/etc/ipsec.d/zvpn-users.secrets

C='\033[1;36m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; N='\033[0m'
info(){ echo -e "${C}[ZVPN]${N} $*"; }
ok(){ echo -e "${G}[OK]${N} $*"; }
warn(){ echo -e "${Y}[!]${N} $*"; }
die(){ echo -e "${R}[ERROR]${N} $*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || die "Existing ZVPN installation not found at $APP_DIR"
[[ -f "$SOURCE_DIR/backend/package.json" && -f "$SOURCE_DIR/frontend/package.json" ]] || die "Run this script from the extracted ZVPN release directory"
[[ -f /etc/ipsec.conf && -f /etc/ipsec.secrets ]] || die "strongSwan configuration not found"

id -u zvpn >/dev/null 2>&1 || die "System user 'zvpn' is missing"

REQUIRED=(
  "$SOURCE_DIR/VERSION"
  "$SOURCE_DIR/backend/src/server.js"
  "$SOURCE_DIR/backend/src/vpn.js"
  "$SOURCE_DIR/backend/src/worker.js"
  "$SOURCE_DIR/backend/src/profiles.js"
  "$SOURCE_DIR/backend/src/migrate.js"
  "$SOURCE_DIR/backend/package.json"
  "$SOURCE_DIR/frontend/index.html"
  "$SOURCE_DIR/frontend/vite.config.ts"
  "$SOURCE_DIR/frontend/package.json"
  "$SOURCE_DIR/frontend/src/main.tsx"
  "$SOURCE_DIR/frontend/src/App.tsx"
  "$SOURCE_DIR/ops/schema.sql"
  "$SOURCE_DIR/ops/helper/zvpn-helper"
)
info "Validating release package..."
for f in "${REQUIRED[@]}"; do
  [[ -f "$f" ]] || die "Incomplete release — missing: ${f#$SOURCE_DIR/}"
done
ok "Release package looks complete"

NEW_VERSION="$(cat "$SOURCE_DIR/VERSION" 2>/dev/null || echo unknown)"
OLD_VERSION="$(cat "$APP_DIR/VERSION" 2>/dev/null || echo unknown)"

echo "============================================="
echo "       ZVPN Panel Safe Upgrade"
echo "       $OLD_VERSION  ->  $NEW_VERSION"
echo "============================================="
echo
warn "strongSwan will restart once; active VPN sessions will reconnect."

info "Creating pre-upgrade backup..."
if [[ -f "$SOURCE_DIR/backup.sh" ]]; then
  chmod +x "$SOURCE_DIR/backup.sh" 2>/dev/null || true
  BACKUP_PATH="$(bash "$SOURCE_DIR/backup.sh")"
  ok "Backup: $BACKUP_PATH"
else
  die "backup.sh not found in release directory"
fi

info "Stopping panel service..."
systemctl stop zvpn-panel

info "Updating application source (preserving .env, DB, runtime)..."
# NOTE: no --delete — incomplete zips must NOT wipe production files
rsync -a \
  --exclude 'backend/.env' \
  --exclude 'backend/node_modules/' \
  --exclude 'frontend/node_modules/' \
  --exclude 'frontend/dist/' \
  --exclude 'runtime/' \
  "$SOURCE_DIR/" "$APP_DIR/"

chown root:root "$APP_DIR" 2>/dev/null || true
chown -R root:root "$APP_DIR/backend/src" "$APP_DIR/backend/scripts" "$APP_DIR/frontend/src" "$APP_DIR/ops" 2>/dev/null || true
chown zvpn:zvpn "$ENV_FILE"
chmod 600 "$ENV_FILE"
mkdir -p /opt/zvpn-panel/runtime
chown zvpn:zvpn /opt/zvpn-panel/runtime
chmod 700 /opt/zvpn-panel/runtime
if [[ ! -f "$RUNTIME_SECRETS" ]]; then
  install -o zvpn -g zvpn -m 600 /dev/null "$RUNTIME_SECRETS"
else
  chown zvpn:zvpn "$RUNTIME_SECRETS"
  chmod 600 "$RUNTIME_SECRETS"
fi

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
      info "Applying migration $ver..."
      psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$mig"
      psql "$DB_URL" -c "INSERT INTO schema_migrations(version) VALUES('$ver') ON CONFLICT DO NOTHING" >/dev/null
    fi
  done
fi
ok "Database preserved and migrations applied"

info "Installing updated restricted helper..."
install -o root -g root -m 0700 -d /var/lib/zvpn-panel /var/lib/zvpn-panel/endpoint-backups
install -o root -g root -m 0755 "$APP_DIR/ops/helper/zvpn-helper" /usr/local/sbin/zvpn-helper
cat > /etc/sudoers.d/zvpn-panel <<'SUDOERS'
zvpn ALL=(root) NOPASSWD: /usr/local/sbin/zvpn-helper sync-secrets, /usr/local/sbin/zvpn-helper reread-secrets, /usr/local/sbin/zvpn-helper list-sas, /usr/local/sbin/zvpn-helper terminate *, /usr/local/sbin/zvpn-helper status, /usr/local/sbin/zvpn-helper cert-info, /usr/local/sbin/zvpn-helper resolve-host *, /usr/local/sbin/zvpn-helper check-ike-ports, /usr/local/sbin/zvpn-helper endpoint-backup, /usr/local/sbin/zvpn-helper endpoint-rollback /var/lib/zvpn-panel/endpoint-backups/*, /usr/local/sbin/zvpn-helper issue-server-cert *, /usr/local/sbin/zvpn-helper set-leftid *, /usr/local/sbin/zvpn-helper normalize-conn, /usr/local/sbin/zvpn-helper strongswan-logs, /usr/local/sbin/zvpn-helper restart-strongswan
SUDOERS
chmod 440 /etc/sudoers.d/zvpn-panel
visudo -cf /etc/sudoers.d/zvpn-panel >/dev/null

info "Ensuring strongSwan user-secret path..."
mkdir -p /etc/ipsec.d
[[ -f "$IPSEC_USER_SECRETS" ]] || install -o root -g root -m 600 /dev/null "$IPSEC_USER_SECRETS"
chown root:root "$IPSEC_USER_SECRETS"
chmod 600 "$IPSEC_USER_SECRETS"
sed -i '\#^include /opt/zvpn-panel/runtime/ipsec-users.secrets$#d' /etc/ipsec.secrets
if ! grep -q '^include /etc/ipsec.d/zvpn-users.secrets$' /etc/ipsec.secrets; then
  echo 'include /etc/ipsec.d/zvpn-users.secrets' >> /etc/ipsec.secrets
fi

info "Normalizing strongSwan configuration (Mobile fragmentation, MOBIKE, reauth=no, proposals)..."
if grep -q 'conn ikev2-vpn' /etc/ipsec.conf 2>/dev/null; then
  cp -a /etc/ipsec.conf "/etc/ipsec.conf.pre-zvpn-${NEW_VERSION}-$(date +%s)"
  /usr/local/sbin/zvpn-helper normalize-conn || warn "zvpn-helper normalize-conn returned non-zero"
fi

info "Configuring network performance, NAT Masquerade & TCP MSS clamping..."
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
iptables -t nat -C POSTROUTING -s 10.0.0.0/8 -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s 10.0.0.0/8 -j MASQUERADE 2>/dev/null || true
iptables -C FORWARD -s 10.0.0.0/8 -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -s 10.0.0.0/8 -j ACCEPT 2>/dev/null || true
iptables -C FORWARD -d 10.0.0.0/8 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -d 10.0.0.0/8 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
iptables -t mangle -C FORWARD -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || \
  iptables -t mangle -A FORWARD -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true

info "Ensuring Node.js 20+ runtime and building assets..."
if ! command -v node >/dev/null || [[ "$(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v')" -lt 20 ]]; then
  info "Upgrading Node.js to 20+ LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y --no-install-recommends nodejs >/dev/null
fi

info "Installing Node dependencies and rebuilding frontend..."
cd "$APP_DIR/backend"
npm ci --omit=dev --no-audit --no-fund
cd "$APP_DIR/frontend"
npm ci --no-audit --no-fund
npm run build
chown -R root:root "$APP_DIR/frontend/dist"

info "Patching server.js for v2.1 routes (if needed)..."
if [[ -f "$APP_DIR/backend/scripts/patch-v2.1-server.js" ]]; then
  (cd "$APP_DIR/backend" && node scripts/patch-v2.1-server.js) || warn "patch-v2.1-server.js failed — check server.js manually"
fi

info "Ensuring strongSwan EAP-MSCHAPv2 and PKI plugins..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends strongswan-pki libcharon-extra-plugins libcharon-extauth-plugins libstrongswan-extra-plugins libstrongswan-standard-plugins >/dev/null 2>&1 || true

mkdir -p /etc/strongswan.d/charon
for plugin in eap-mschapv2 md4 des openssl fips-prf gmp; do
  printf '%s {\n    load = yes\n}\n' "$plugin" > "/etc/strongswan.d/charon/${plugin}.conf"
done

if [[ -f "$APP_DIR/ops/optimize-speed.sh" ]]; then
  info "Applying BBR, TCP MSS clamping, and kernel speed optimizations..."
  bash "$APP_DIR/ops/optimize-speed.sh" || warn "Speed optimizations skipped"
fi

info "Updating systemd unit..."
install -o root -g root -m 0644 "$APP_DIR/ops/systemd/zvpn-panel.service" /etc/systemd/system/zvpn-panel.service
systemctl daemon-reload

info "Restarting strongSwan..."
systemctl restart strongswan-starter
sleep 2
systemctl is-active --quiet strongswan-starter || { journalctl -u strongswan-starter -n 80 --no-pager; die "strongSwan failed after upgrade"; }

info "Synchronizing VPN users into strongSwan..."
sudo -u zvpn sudo /usr/local/sbin/zvpn-helper sync-secrets
sleep 1

info "Starting updated panel..."
systemctl restart zvpn-panel
sleep 2
if ! curl -fsS http://127.0.0.1:3300/api/health >/dev/null; then
  journalctl -u zvpn-panel -n 100 --no-pager
  die "Panel health check failed"
fi

rm -f /etc/nginx/sites-enabled/default
if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx
  ok "Nginx reloaded successfully"
else
  warn "nginx -t failed — check manually"
fi

echo
if [[ -f "$APP_DIR/doctor.sh" ]]; then
  bash "$APP_DIR/doctor.sh" || true
fi

echo
echo "---------------------------------------------"
echo "ZVPN Panel upgraded successfully to $NEW_VERSION"
echo "Database / .env / CA / Let's Encrypt preserved."
echo "Set VPN server address: Admin → Settings"
echo "---------------------------------------------"
