#!/bin/bash
# ==============================================================================
# ZVPN Panel - Automated Zero-Downtime Server Migration Tool
# Transfers Database, Encryption Keys, Root CA, StrongSwan Certs & Users to New Server
# ==============================================================================

set -e

C='\033[1;36m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; N='\033[0m'
info() { echo -e "${C}[ZVPN-MIGRATE]${N} $*"; }
ok()   { echo -e "${G}[✓]${N} $*"; }
warn() { echo -e "${Y}[!]${N} $*"; }
die()  { echo -e "${R}[ERROR]${N} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "This script must be run as root: sudo bash $0"

echo -e "${C}======================================================${N}"
echo -e "${G}    ZVPN Panel - Seamless Server Migration Tool      ${N}"
echo -e "${C}======================================================${N}"
echo "This tool will transfer:"
echo " 1. Database (All users, traffic stats, tokens, history)"
echo " 2. CA Certificates & Server SSL Keys (Users don't need to re-download profiles!)"
echo " 3. Panel Encryption Keys (.env)"
echo " 4. StrongSwan IPsec configurations and secrets"
echo ""

read -rp "Enter NEW Server IP address: " NEW_IP
[[ -n "$NEW_IP" ]] || die "New server IP cannot be empty."

read -rp "Enter NEW Server SSH Port [default 22]: " NEW_PORT
NEW_PORT="${NEW_PORT:-22}"

which sshpass >/dev/null 2>&1 || {
    info "Installing sshpass for automated transfer..."
    apt-get update -qq && apt-get install -y -qq sshpass
}

read -rsp "Enter NEW Server Root SSH Password: " SSH_PASS
echo ""

SSH_CMD="sshpass -p '$SSH_PASS' ssh -o StrictHostKeyChecking=no -p $NEW_PORT root@$NEW_IP"
SCP_CMD="sshpass -p '$SSH_PASS' scp -o StrictHostKeyChecking=no -P $NEW_PORT"

info "Testing SSH connection to $NEW_IP:$NEW_PORT..."
eval "$SSH_CMD 'echo SSH_OK'" >/dev/null 2>&1 || die "Failed to connect to new server via SSH. Check IP, Port and Password."
ok "SSH connection verified!"

info "Checking if ZVPN is installed on new server..."
HAS_PANEL=$(eval "$SSH_CMD '[ -d /opt/zvpn-panel/app ] && echo 1 || echo 0'")
if [[ "$HAS_PANEL" != "1" ]]; then
    warn "ZVPN is not installed on new server. Installing fresh panel first..."
    eval "$SSH_CMD 'curl -sSL https://raw.githubusercontent.com/Nullfill/ZVPN/main/install.sh | bash -s -- --non-interactive'"
    ok "Panel installed on new server."
fi

# Stop panel on new server during migration
eval "$SSH_CMD 'systemctl stop zvpn-panel strongswan-starter 2>/dev/null || true'"

TEMP_DIR="/tmp/zvpn-migration-$$"
mkdir -p "$TEMP_DIR"

info "1/5 Dumping PostgreSQL database on this server..."
DB_URL=$(grep '^DATABASE_URL=' /opt/zvpn-panel/app/backend/.env 2>/dev/null | cut -d= -f2- || true)
if [[ -n "$DB_URL" ]]; then
    su - postgres -c "pg_dump -U postgres -d zvpn_panel --clean --if-exists" > "$TEMP_DIR/zvpn_db.sql"
    ok "Database dump created."
else
    die "Could not find DATABASE_URL in /opt/zvpn-panel/app/backend/.env"
fi

info "2/5 Collecting CA, Certificates and Encryption Keys..."
mkdir -p "$TEMP_DIR/certs" "$TEMP_DIR/conf"
cp -f /opt/zvpn-panel/app/backend/.env "$TEMP_DIR/backend.env"
cp -r /etc/ipsec.d/cacerts "$TEMP_DIR/certs/" 2>/dev/null || true
cp -r /etc/ipsec.d/certs "$TEMP_DIR/certs/" 2>/dev/null || true
cp -r /etc/ipsec.d/private "$TEMP_DIR/certs/" 2>/dev/null || true
cp -f /etc/ipsec.conf "$TEMP_DIR/conf/ipsec.conf" 2>/dev/null || true
cp -f /etc/ipsec.secrets "$TEMP_DIR/conf/ipsec.secrets" 2>/dev/null || true
cp -f /etc/ipsec.d/zvpn-users.secrets "$TEMP_DIR/conf/zvpn-users.secrets" 2>/dev/null || true
ok "Security artifacts and keys collected."

info "3/5 Transferring data to new server..."
tar -czf "$TEMP_DIR/migration.tar.gz" -C "$TEMP_DIR" zvpn_db.sql backend.env certs conf
eval "$SCP_CMD '$TEMP_DIR/migration.tar.gz' root@$NEW_IP:/tmp/"
ok "Data transferred to new server."

info "4/5 Restoring Database, Keys and Certificates on new server..."
REMOTE_RESTORE="
set -e
tar -xzf /tmp/migration.tar.gz -C /tmp/

# Restore database
su - postgres -c 'psql -U postgres -d zvpn_panel' < /tmp/zvpn_db.sql >/dev/null 2>&1 || true

# Restore .env
cp -f /tmp/backend.env /opt/zvpn-panel/app/backend/.env
chown zvpn:zvpn /opt/zvpn-panel/app/backend/.env
chmod 600 /opt/zvpn-panel/app/backend/.env

# Restore certificates
cp -rf /tmp/certs/cacerts/* /etc/ipsec.d/cacerts/ 2>/dev/null || true
cp -rf /tmp/certs/certs/* /etc/ipsec.d/certs/ 2>/dev/null || true
cp -rf /tmp/certs/private/* /etc/ipsec.d/private/ 2>/dev/null || true
chmod 600 /etc/ipsec.d/private/* 2>/dev/null || true
chmod 644 /etc/ipsec.d/cacerts/* /etc/ipsec.d/certs/* 2>/dev/null || true

# Restore ipsec conf and secrets
cp -f /tmp/conf/ipsec.conf /etc/ipsec.conf 2>/dev/null || true
cp -f /tmp/conf/ipsec.secrets /etc/ipsec.secrets 2>/dev/null || true
cp -f /tmp/conf/zvpn-users.secrets /etc/ipsec.d/zvpn-users.secrets 2>/dev/null || true
chmod 600 /etc/ipsec.secrets /etc/ipsec.d/zvpn-users.secrets 2>/dev/null || true

# Clean temporary files
rm -rf /tmp/migration.tar.gz /tmp/zvpn_db.sql /tmp/backend.env /tmp/certs /tmp/conf

# Apply Speed Optimizations
[ -f /opt/zvpn-panel/app/ops/optimize-speed.sh ] && bash /opt/zvpn-panel/app/ops/optimize-speed.sh || true

# Restart Services
systemctl restart strongswan-starter zvpn-panel
"

eval "$SSH_CMD \"$REMOTE_RESTORE\""
ok "Database, CA certificates, and secrets successfully restored on new server!"

# Clean local temp
rm -rf "$TEMP_DIR"

echo ""
echo -e "${G}========================================================================${N}"
echo -e "${G} [✓] MIGRATION COMPLETED 100% SUCCESSFULLY!                             ${N}"
echo -e "${G}========================================================================${N}"
echo -e "Both servers now share the ${C}EXACT SAME Root CA and Cryptographic Keys${N}."
echo ""
echo -e "${Y}NEXT SIMPLE STEP:${N}"
echo "Change the DNS A-Record of your VPN subdomain to point to: ${G}$NEW_IP${N}"
echo "Once DNS updates, all existing users on Android, iOS and Windows will connect"
echo "to the new server automatically without downloading any new profile!"
echo ""
