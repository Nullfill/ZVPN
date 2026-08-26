#!/usr/bin/env bash
# ==============================================================================
# ZVPN Panel - Production Installer (Multi-Agent Architecture)
# Idempotent installation for Ubuntu 20.04/22.04/24.04 & Debian 11/12.
# ==============================================================================
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo 'Run as root: sudo ./install.sh'; exit 1; }
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT=/opt/zvpn-panel
APP="$ROOT/app"
ENV_FILE="$APP/backend/.env"
DB_NAME="${ZVPN_DB_NAME:-zvpn}"
DB_USER="${ZVPN_DB_USER:-zvpn}"

C='\033[1;36m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; M='\033[1;35m'; N='\033[0m'
log(){ echo -e "${C}[ZVPN]${N} $*"; }
ok(){ echo -e "${G}[OK]${N} $*"; }
warn(){ echo -e "${Y}[!]${N} $*"; }
die(){ echo -e "${R}[ERROR]${N} $*" >&2; exit 1; }

command -v apt-get >/dev/null || die 'Debian/Ubuntu apt-get is required'

echo -e "${M}"
echo "====================================================="
echo "       🛡️  ZVPN Panel Installation Wizard           "
echo "====================================================="
echo -e "${N}"

# 1. Detect public IP
DETECTED_IP="$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")"

# 2. Interactive or Environment Configuration
DOMAIN="${ZVPN_DOMAIN:-}"
ADMIN_USER="${ZVPN_ADMIN_USER:-admin}"
ADMIN_PASS="${ZVPN_ADMIN_PASSWORD:-}"

if [[ -t 0 && -z "${ZVPN_NON_INTERACTIVE:-}" ]]; then
  echo -e "${C}Please provide basic setup details (press Enter to keep defaults):${N}\n"
  
  read -r -p "Enter Domain or Server IP [${DETECTED_IP}]: " input_domain
  DOMAIN="${input_domain:-$DETECTED_IP}"
  
  read -r -p "Enter Admin Username [${ADMIN_USER}]: " input_user
  ADMIN_USER="${input_user:-$ADMIN_USER}"
  
  read -r -s -p "Enter Admin Password [Leave blank for auto-generated]: " input_pass
  echo
  ADMIN_PASS="${input_pass:-}"
fi

DOMAIN="${DOMAIN:-$DETECTED_IP}"
if [[ -z "$ADMIN_PASS" ]]; then
  ADMIN_PASS="$(openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 12)"
fi

log "Target Domain/IP: $DOMAIN"
log "Admin Username:   $ADMIN_USER"

# 3. System Packages
log "Updating package lists and installing dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
  postgresql postgresql-client strongswan strongswan-pki strongswan-swanctl strongswan-starter \
  libcharon-extra-plugins libstrongswan-extra-plugins libstrongswan-standard-plugins \
  nginx rsync openssl curl python3 certbot python3-certbot-nginx dnsutils >/dev/null

# 4. Ensure Node.js 20+
if ! command -v node >/dev/null || [[ "$(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v')" -lt 20 ]]; then
  log "Installing Node.js 20+ LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y --no-install-recommends nodejs >/dev/null
fi

# 5. System User & Runtime Directories
id zvpn >/dev/null 2>&1 || useradd --system --home "$ROOT" --shell /usr/sbin/nologin zvpn
install -o root -g root -m 0755 -d "$ROOT" "$ROOT/runtime" "$ROOT/runtime/endpoint-backups" /var/lib/zvpn-panel /var/lib/zvpn-panel/endpoint-backups
chown root:root "$ROOT/runtime/endpoint-backups" /var/lib/zvpn-panel/endpoint-backups
chmod 700 "$ROOT/runtime/endpoint-backups" /var/lib/zvpn-panel/endpoint-backups
chown zvpn:zvpn "$ROOT/runtime"
chmod 700 "$ROOT/runtime"
install -o zvpn -g zvpn -m 0600 /dev/null "$ROOT/runtime/ipsec-users.secrets" 2>/dev/null || true

# 6. PostgreSQL Database Setup
log "Configuring PostgreSQL database and credentials..."
DB_PASSWORD=""
if [[ -f "$ENV_FILE" ]]; then
  DB_PASSWORD="$(grep '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null | sed -E 's/.*:([^@]+)@.*/\1/' || true)"
fi
if [[ -z "$DB_PASSWORD" ]]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" 2>/dev/null | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE USER \"$DB_USER\" WITH PASSWORD '$DB_PASSWORD';" >/dev/null
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER USER \"$DB_USER\" WITH PASSWORD '$DB_PASSWORD';" >/dev/null
fi

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null | grep -q 1 || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE \"$DB_NAME\" TO \"$DB_USER\";" >/dev/null 2>&1 || true

# 7. Sync Source Files
log "Deploying application files to $APP..."
mkdir -p "$APP"
rsync -a \
  --exclude 'backend/.env' \
  --exclude 'backend/node_modules' \
  --exclude 'frontend/node_modules' \
  --exclude 'frontend/dist' \
  --exclude 'runtime/' \
  "$SOURCE_DIR/" "$APP/"

install -o root -g root -m 0755 "$APP/ops/helper/zvpn-helper" /usr/local/sbin/zvpn-helper

# 8. Backend .env configuration
if [[ ! -f "$ENV_FILE" ]]; then
  install -o zvpn -g zvpn -m 0600 /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3300
DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
MASTER_KEY=$(openssl rand -base64 48 | tr -d '\n')
SECURE_COOKIES=false
PUBLIC_BASE_URL=http://${DOMAIN}
VPN_SERVER=${DOMAIN}
VPN_REMOTE_ID=${DOMAIN}
VPN_SECRETS_FILE=$ROOT/runtime/ipsec-users.secrets
EOF
else
  if grep -q '^PUBLIC_BASE_URL=' "$ENV_FILE"; then
    sed -i "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=http://${DOMAIN}#" "$ENV_FILE"
  else
    echo "PUBLIC_BASE_URL=http://${DOMAIN}" >> "$ENV_FILE"
  fi
  if grep -q '^VPN_SERVER=' "$ENV_FILE"; then
    sed -i "s#^VPN_SERVER=.*#VPN_SERVER=${DOMAIN}#" "$ENV_FILE"
  else
    echo "VPN_SERVER=${DOMAIN}" >> "$ENV_FILE"
  fi
fi
chown zvpn:zvpn "$ENV_FILE"
chmod 600 "$ENV_FILE"

# 9. Apply Database Schema & Migrations
log "Applying database schema & migrations..."
DB_URL="postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}"
if [[ -f "$APP/ops/schema.sql" ]]; then
  sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$APP/ops/schema.sql" >/dev/null
fi

if [[ -d "$APP/ops/migrations" ]]; then
  sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );" >/dev/null
  for mig in "$APP"/ops/migrations/*.sql; do
    [[ -f "$mig" ]] || continue
    ver="$(basename "$mig" .sql)"
    applied="$(sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT 1 FROM schema_migrations WHERE version='$ver'" 2>/dev/null | tr -d '[:space:]')"
    if [[ "$applied" != "1" ]]; then
      sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$mig" >/dev/null
      sudo -u postgres psql -d "$DB_NAME" -c "INSERT INTO schema_migrations(version) VALUES('$ver') ON CONFLICT DO NOTHING" >/dev/null
    fi
  done
fi

sudo -u postgres psql -d "$DB_NAME" -c "
  GRANT ALL ON ALL TABLES IN SCHEMA public TO \"$DB_USER\";
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO \"$DB_USER\";
" >/dev/null 2>&1 || true

# 10. strongSwan PKI & Configuration
log "Configuring strongSwan PKI and IKEv2 proposals..."
mkdir -p /etc/ipsec.d/cacerts /etc/ipsec.d/certs /etc/ipsec.d/private

# Root CA
if [[ ! -f /etc/ipsec.d/cacerts/ikev2-ca-cert.pem || ! -f /etc/ipsec.d/private/ikev2-ca-key.pem ]]; then
  openssl req -x509 -newkey rsa:4096 -days 3650 -nodes \
    -keyout /etc/ipsec.d/private/ikev2-ca-key.pem \
    -out /etc/ipsec.d/cacerts/ikev2-ca-cert.pem \
    -subj "/CN=ZVPN Root CA" 2>/dev/null
  chmod 600 /etc/ipsec.d/private/ikev2-ca-key.pem
  chmod 644 /etc/ipsec.d/cacerts/ikev2-ca-cert.pem
fi

# Server Certificate
openssl req -newkey rsa:2048 -nodes \
  -keyout /etc/ipsec.d/private/ikev2-server-key.pem \
  -out /tmp/zvpn-server.csr \
  -subj "/CN=${DOMAIN}" 2>/dev/null
chmod 600 /etc/ipsec.d/private/ikev2-server-key.pem

cat > /tmp/zvpn-san.cnf <<EOF
[v3_ext]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
DNS.1 = ${DOMAIN}
IP.1 = ${DETECTED_IP}
EOF

openssl x509 -req -in /tmp/zvpn-server.csr -days 1825 \
  -CA /etc/ipsec.d/cacerts/ikev2-ca-cert.pem \
  -CAkey /etc/ipsec.d/private/ikev2-ca-key.pem \
  -CAcreateserial -out /etc/ipsec.d/certs/ikev2-server-cert.pem \
  -extfile /tmp/zvpn-san.cnf -extensions v3_ext 2>/dev/null
chmod 644 /etc/ipsec.d/certs/ikev2-server-cert.pem
rm -f /tmp/zvpn-server.csr /tmp/zvpn-san.cnf

# ipsec.conf
cat > /etc/ipsec.conf <<EOF
config setup
    charondebug="ike 1, knl 1, cfg 0"
    uniqueids=never

conn %default
    keyexchange=ikev2
    auto=add
    fragmentation=yes
    mobike=yes
    reauth=no
    rekey=no
    forceencaps=yes
    dpdaction=clear
    dpddelay=30s
    dpdtimeout=120s
    ike=aes128gcm128-sha256-ecp256,aes256gcm128-sha256-ecp256,aes128-sha256-ecp256,aes256-sha256-ecp384,aes128-sha256-modp2048,aes256-sha256-modp2048,aes128-sha1-modp1024,aes256-sha1-modp1024!
    esp=aes128gcm128,aes256gcm128,aes128-sha256,aes256-sha256,aes128-sha1,aes256-sha1!

conn ikev2-vpn
    left=%any
    leftid=${DOMAIN}
    leftcert=ikev2-server-cert.pem
    leftsendcert=always
    leftsubnet=0.0.0.0/0
    right=%any
    rightid=%any
    rightauth=eap-mschapv2
    rightsourceip=10.10.10.0/24
    rightdns=1.1.1.1,8.8.8.8
    rightsendcert=never
    eap_identity=%identity
EOF

# ipsec.secrets
cat > /etc/ipsec.secrets <<EOF
: RSA ikev2-server-key.pem
include /etc/ipsec.d/zvpn-users.secrets
EOF
touch /etc/ipsec.d/zvpn-users.secrets
chmod 600 /etc/ipsec.secrets /etc/ipsec.d/zvpn-users.secrets
chown root:root /etc/ipsec.secrets /etc/ipsec.d/zvpn-users.secrets

# 11. Sudoers Permissions for helper
cat > /etc/sudoers.d/zvpn-panel <<'SUDOERS'
zvpn ALL=(root) NOPASSWD: /usr/local/sbin/zvpn-helper sync-secrets, /usr/local/sbin/zvpn-helper reread-secrets, /usr/local/sbin/zvpn-helper list-sas, /usr/local/sbin/zvpn-helper terminate *, /usr/local/sbin/zvpn-helper status, /usr/local/sbin/zvpn-helper cert-info, /usr/local/sbin/zvpn-helper resolve-host *, /usr/local/sbin/zvpn-helper check-ike-ports, /usr/local/sbin/zvpn-helper endpoint-backup, /usr/local/sbin/zvpn-helper endpoint-rollback /var/lib/zvpn-panel/endpoint-backups/*, /usr/local/sbin/zvpn-helper issue-server-cert *, /usr/local/sbin/zvpn-helper set-leftid *, /usr/local/sbin/zvpn-helper normalize-conn, /usr/local/sbin/zvpn-helper strongswan-logs, /usr/local/sbin/zvpn-helper restart-strongswan
SUDOERS
chmod 440 /etc/sudoers.d/zvpn-panel
visudo -cf /etc/sudoers.d/zvpn-panel >/dev/null

# 12. Firewall & Routing
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
iptables -t nat -C POSTROUTING -s 10.0.0.0/8 -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s 10.0.0.0/8 -j MASQUERADE 2>/dev/null || true
iptables -C FORWARD -s 10.0.0.0/8 -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -s 10.0.0.0/8 -j ACCEPT 2>/dev/null || true
iptables -C FORWARD -d 10.0.0.0/8 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -d 10.0.0.0/8 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
iptables -t mangle -C FORWARD -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || \
  iptables -t mangle -A FORWARD -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true

# 13. Build Node.js Backend & React Frontend
log "Installing dependencies and building frontend..."
cd "$APP/backend"; npm ci --omit=dev --no-audit --no-fund
cd "$APP/frontend"; npm ci --no-audit --no-fund; npm run build

chown -R root:root "$APP"
chown zvpn:zvpn "$ENV_FILE" "$ROOT/runtime" "$ROOT/runtime/ipsec-users.secrets"
chmod 600 "$ENV_FILE" "$ROOT/runtime/ipsec-users.secrets"

# 14. Create Admin User & Update Settings
log "Creating administrator account..."
cd "$APP/backend"
node scripts/create-admin.js "$ADMIN_USER" "$ADMIN_PASS"

sudo -u postgres psql -d "$DB_NAME" -c "
  UPDATE panel_settings 
  SET value = jsonb_set(jsonb_set(value, '{serverAddress}', '\"${DOMAIN}\"'), '{remoteId}', '\"${DOMAIN}\"')
  WHERE key = 'vpn';
" >/dev/null 2>&1 || true

# 15. Nginx Configuration
log "Configuring Nginx web server..."
rm -f /etc/nginx/sites-enabled/default

sed "s/__DOMAIN__/${DOMAIN}/g" "$APP/ops/nginx/zvpn.conf.template" > /etc/nginx/sites-available/zvpn-panel
ln -sfn /etc/nginx/sites-available/zvpn-panel /etc/nginx/sites-enabled/zvpn-panel
nginx -t >/dev/null 2>&1 || die "Nginx configuration test failed"

# 16. Enable & Start Services
log "Enabling and starting system services..."
install -o root -g root -m 0644 "$APP/ops/systemd/zvpn-panel.service" /etc/systemd/system/zvpn-panel.service
systemctl daemon-reload
systemctl enable --now postgresql strongswan-starter zvpn-panel
systemctl restart postgresql strongswan-starter zvpn-panel
systemctl reload nginx

# 17. Optional Let's Encrypt SSL (if real domain is used)
if [[ "$DOMAIN" =~ [a-zA-Z] && ! "$DOMAIN" =~ ^[0-9.]+$ ]]; then
  log "Attempting automatic Let's Encrypt SSL certificate for $DOMAIN..."
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect >/dev/null 2>&1; then
    sed -i "s#^PUBLIC_BASE_URL=http://#PUBLIC_BASE_URL=https://#" "$ENV_FILE" 2>/dev/null || true
    systemctl restart zvpn-panel
    ok "Let's Encrypt SSL certificate active"
  else
    warn "SSL provisioning skipped (check DNS propagation)"
  fi
fi

sleep 2

# 18. Health Check & Completion Banner
echo
if [[ -f "$APP/doctor.sh" ]]; then
  bash "$APP/doctor.sh" || true
fi

PROTOCOL="http"
[[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]] && PROTOCOL="https"

echo
echo -e "${G}=====================================================${N}"
echo -e "${G}       🎉 ZVPN Panel v$(cat "$APP/VERSION" 2>/dev/null || echo "3.0.0") Installed Successfully! ${N}"
echo -e "${G}=====================================================${N}"
echo -e "  🌐 Panel URL:     ${C}${PROTOCOL}://${DOMAIN}${N}"
echo -e "  👤 Username:      ${C}${ADMIN_USER}${N}"
echo -e "  🔑 Password:      ${C}${ADMIN_PASS}${N}"
echo -e "  🛡️ VPN Endpoint:  ${C}${DOMAIN}${N}"
echo -e "${G}=====================================================${N}"
echo -e "${Y}Tip: You can re-run doctor checks anytime via:${N} bash /opt/zvpn-panel/app/doctor.sh\n"
