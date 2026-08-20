#!/usr/bin/env bash
# Idempotent first installation for Debian/Ubuntu.  The script never deletes
# an existing application or database; rerunning it behaves like a repair.
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo 'Run as root: sudo ./install.sh'; exit 1; }
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT=/opt/zvpn-panel
APP="$ROOT/app"
ENV_FILE="$APP/backend/.env"
DB_NAME="${ZVPN_DB_NAME:-zvpn}"
DB_USER="${ZVPN_DB_USER:-zvpn}"
DB_PASSWORD="${ZVPN_DB_PASSWORD:-}"

log(){ printf '[ZVPN] %s\n' "$*"; }
die(){ printf '[ZVPN] ERROR: %s\n' "$*" >&2; exit 1; }
command -v apt-get >/dev/null || die 'Debian/Ubuntu apt-get is required';

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends postgresql postgresql-client strongswan-swanctl strongswan-starter nginx rsync openssl curl python3 >/dev/null

if ! command -v node >/dev/null || [[ "$(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v')" -lt 20 ]]; then
  log "Ensuring Node.js 20+ LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y --no-install-recommends nodejs >/dev/null
fi

id zvpn >/dev/null 2>&1 || useradd --system --home "$ROOT" --shell /usr/sbin/nologin zvpn
install -o root -g root -m 0755 -d "$ROOT" "$ROOT/runtime" "$ROOT/runtime/endpoint-backups"
chown root:root "$ROOT/runtime/endpoint-backups"; chmod 700 "$ROOT/runtime/endpoint-backups"

if [[ -z "$DB_PASSWORD" ]]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE USER \"$DB_USER\" WITH PASSWORD '$DB_PASSWORD';" >/dev/null
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER USER \"$DB_USER\" WITH PASSWORD '$DB_PASSWORD';" >/dev/null
fi
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"

if [[ ! -d "$APP/backend" ]]; then
  rsync -a --exclude backend/.env --exclude backend/node_modules --exclude frontend/node_modules --exclude frontend/dist --exclude runtime/ "$SOURCE_DIR/" "$APP/"
else
  rsync -a --exclude backend/.env --exclude backend/node_modules --exclude frontend/node_modules --exclude frontend/dist --exclude runtime/ "$SOURCE_DIR/" "$APP/"
fi
install -o root -g root -m 0755 "$APP/ops/helper/zvpn-helper" /usr/local/sbin/zvpn-helper
install -o root -g root -m 0700 -d /var/lib/zvpn-panel /var/lib/zvpn-panel/endpoint-backups
install -o zvpn -g zvpn -m 0600 /dev/null "$ROOT/runtime/ipsec-users.secrets" 2>/dev/null || true

if [[ ! -f "$ENV_FILE" ]]; then
  install -o zvpn -g zvpn -m 0600 /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3300
DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
MASTER_KEY=$(openssl rand -base64 48 | tr -d '\n')
SECURE_COOKIES=true
VPN_SECRETS_FILE=$ROOT/runtime/ipsec-users.secrets
EOF
  chown zvpn:zvpn "$ENV_FILE"; chmod 600 "$ENV_FILE"
fi

cd "$APP/backend"; npm ci --omit=dev --no-audit --no-fund
cd "$APP/frontend"; npm ci --no-audit --no-fund; npm run build
chown -R root:root "$APP"; chown zvpn:zvpn "$ENV_FILE" "$ROOT/runtime" "$ROOT/runtime/ipsec-users.secrets"; chmod 600 "$ENV_FILE" "$ROOT/runtime/ipsec-users.secrets"
install -o root -g root -m 0644 "$APP/ops/systemd/zvpn-panel.service" /etc/systemd/system/zvpn-panel.service
install -o root -g root -m 0644 "$APP/ops/nginx/zvpn.conf.template" /etc/nginx/sites-available/zvpn-panel
ln -sfn /etc/nginx/sites-available/zvpn-panel /etc/nginx/sites-enabled/zvpn-panel
cat > /etc/sudoers.d/zvpn-panel <<'SUDOERS'
zvpn ALL=(root) NOPASSWD: /usr/local/sbin/zvpn-helper sync-secrets, /usr/local/sbin/zvpn-helper reread-secrets, /usr/local/sbin/zvpn-helper list-sas, /usr/local/sbin/zvpn-helper terminate *, /usr/local/sbin/zvpn-helper status, /usr/local/sbin/zvpn-helper cert-info, /usr/local/sbin/zvpn-helper resolve-host *, /usr/local/sbin/zvpn-helper check-ike-ports, /usr/local/sbin/zvpn-helper endpoint-backup, /usr/local/sbin/zvpn-helper endpoint-rollback /var/lib/zvpn-panel/endpoint-backups/*, /usr/local/sbin/zvpn-helper issue-server-cert *, /usr/local/sbin/zvpn-helper set-leftid *, /usr/local/sbin/zvpn-helper normalize-conn, /usr/local/sbin/zvpn-helper strongswan-logs, /usr/local/sbin/zvpn-helper restart-strongswan
SUDOERS
chmod 440 /etc/sudoers.d/zvpn-panel; visudo -cf /etc/sudoers.d/zvpn-panel >/dev/null
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
iptables -t nat -C POSTROUTING -s 10.0.0.0/8 -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s 10.0.0.0/8 -j MASQUERADE 2>/dev/null || true
iptables -C FORWARD -s 10.0.0.0/8 -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -s 10.0.0.0/8 -j ACCEPT 2>/dev/null || true
iptables -C FORWARD -d 10.0.0.0/8 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -d 10.0.0.0/8 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
iptables -t mangle -C FORWARD -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || \
  iptables -t mangle -A FORWARD -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true
systemctl daemon-reload; systemctl enable --now postgresql strongswan-starter
systemctl enable --now zvpn-panel
nginx -t && systemctl reload nginx
curl -fsS http://127.0.0.1:3300/api/health >/dev/null || die 'Panel health check failed; inspect journalctl -u zvpn-panel'
log "Installed ZVPN $(cat "$APP/VERSION" 2>/dev/null || echo unknown)"
