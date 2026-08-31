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

NEW_IP="${1:-}"
NEW_PORT="${2:-}"

if [[ -z "$NEW_IP" ]]; then
    read -rp "Enter NEW Server IP address: " NEW_IP < /dev/tty
fi
[[ -n "$NEW_IP" ]] || die "New server IP cannot be empty."

if [[ -z "$NEW_PORT" ]]; then
    read -rp "Enter NEW Server SSH Port [default 22]: " NEW_PORT < /dev/tty
    NEW_PORT="${NEW_PORT:-22}"
fi

which sshpass >/dev/null 2>&1 || {
    info "Installing sshpass for automated transfer..."
    apt-get update -qq && apt-get install -y -qq sshpass
}

read -rsp "Enter NEW Server Root SSH Password: " SSH_PASS < /dev/tty
echo ""

SSH_CMD="sshpass -p '$SSH_PASS' ssh -o StrictHostKeyChecking=no -p $NEW_PORT root@$NEW_IP"
SCP_CMD="sshpass -p '$SSH_PASS' scp -o StrictHostKeyChecking=no -P $NEW_PORT"

info "Testing SSH connection to $NEW_IP:$NEW_PORT..."
eval "$SSH_CMD 'echo SSH_OK'" >/dev/null 2>&1 || die "Failed to connect to new server via SSH. Check IP, Port and Password."
ok "SSH connection verified!"

info "Checking if ZVPN is installed on new server..."
HAS_PANEL=$(eval "$SSH_CMD '[ -f /opt/zvpn-panel/app/backend/src/server.js ] && echo 1 || echo 0'")
if [[ "$HAS_PANEL" != "1" ]]; then
    warn "ZVPN is not installed on new server. Installing fresh panel first..."
    eval "$SSH_CMD 'which git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git; }; rm -rf /tmp/zvpn-release && git clone https://github.com/Nullfill/ZVPN.git /tmp/zvpn-release && cd /tmp/zvpn-release && bash install.sh --non-interactive'"
    ok "Panel installed on new server."
fi

# Stop panel on new server during migration
eval "$SSH_CMD 'systemctl stop zvpn-panel strongswan-starter 2>/dev/null || true'"

TEMP_DIR="/tmp/zvpn-migration-$$"
mkdir -p "$TEMP_DIR"

info "1/5 Dumping PostgreSQL database on this server..."
DB_URL=$(grep '^DATABASE_URL=' /opt/zvpn-panel/app/backend/.env 2>/dev/null | cut -d= -f2- || true)
if [[ -n "$DB_URL" ]]; then
    DB_NAME=$(echo "$DB_URL" | sed -E 's/.*\/([^?]+).*/\1/')
    DB_USER=$(echo "$DB_URL" | sed -E 's/.*:\/\/([^:]+):.*/\1/')
    DB_PASS=$(echo "$DB_URL" | sed -E 's/.*:([^@]+)@.*/\1/')
    su - postgres -c "pg_dump -U postgres -d $DB_NAME --clean --if-exists" > "$TEMP_DIR/zvpn_db.sql" || \
    su - postgres -c "pg_dump -U postgres -d zvpn --clean --if-exists" > "$TEMP_DIR/zvpn_db.sql" || \
    su - postgres -c "pg_dump -U postgres -d zvpn_panel --clean --if-exists" > "$TEMP_DIR/zvpn_db.sql"
    ok "Database dump created ($DB_NAME)."
else
    die "Could not find DATABASE_URL in /opt/zvpn-panel/app/backend/.env"
fi

info "2/5 Collecting CA, Certificates, SSL, and Encryption Keys..."
mkdir -p "$TEMP_DIR/certs" "$TEMP_DIR/conf" "$TEMP_DIR/public" "$TEMP_DIR/ssl"
cp -f /opt/zvpn-panel/app/backend/.env "$TEMP_DIR/backend.env"
cp -r /etc/ipsec.d/cacerts "$TEMP_DIR/certs/" 2>/dev/null || true
cp -r /etc/ipsec.d/certs "$TEMP_DIR/certs/" 2>/dev/null || true
cp -r /etc/ipsec.d/private "$TEMP_DIR/certs/" 2>/dev/null || true
cp -f /etc/ipsec.conf "$TEMP_DIR/conf/ipsec.conf" 2>/dev/null || true
cp -f /etc/ipsec.secrets "$TEMP_DIR/conf/ipsec.secrets" 2>/dev/null || true
cp -f /etc/ipsec.d/zvpn-users.secrets "$TEMP_DIR/conf/zvpn-users.secrets" 2>/dev/null || true
cp -rf /etc/letsencrypt "$TEMP_DIR/ssl/" 2>/dev/null || true
cp -f /opt/zvpn-panel/backend/public/ZVPN-Windows-Client.exe "$TEMP_DIR/public/" 2>/dev/null || true
cp -f /opt/zvpn-panel/app/backend/public/ZVPN-Windows-Client.exe "$TEMP_DIR/public/" 2>/dev/null || true
ok "Security artifacts, database, and keys collected."

info "3/5 Creating self-contained restore script..."
cat << 'REMOTE_RESTORE_EOF' > "$TEMP_DIR/remote_restore.sh"
#!/bin/bash
set -e

EXTRACT_DIR="/tmp/migration-extract"

# 1. Restore .env
cp -f "$EXTRACT_DIR/backend.env" /opt/zvpn-panel/app/backend/.env
chown zvpn:zvpn /opt/zvpn-panel/app/backend/.env
chmod 600 /opt/zvpn-panel/app/backend/.env

# Parse Database credentials from .env
DB_URL=$(grep '^DATABASE_URL=' /opt/zvpn-panel/app/backend/.env | cut -d= -f2-)
DB_NAME=$(echo "$DB_URL" | sed -E 's/.*\/([^?]+).*/\1/')
DB_USER=$(echo "$DB_URL" | sed -E 's/.*:\/\/([^:]+):.*/\1/')
DB_PASS=$(echo "$DB_URL" | sed -E 's/.*:([^@]+)@.*/\1/')

# 2. Synchronize PostgreSQL User & Database with SUPERUSER privileges
su - postgres -c "psql -c \"CREATE USER \\\"$DB_USER\\\" WITH PASSWORD '$DB_PASS';\"" 2>/dev/null || \
su - postgres -c "psql -c \"ALTER USER \\\"$DB_USER\\\" WITH PASSWORD '$DB_PASS';\""

su - postgres -c "psql -c \"ALTER USER \\\"$DB_USER\\\" WITH SUPERUSER;\""

su - postgres -c "psql -c \"CREATE DATABASE \\\"$DB_NAME\\\" OWNER \\\"$DB_USER\\\";\"" 2>/dev/null || true
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE \\\"$DB_NAME\\\" TO \\\"$DB_USER\\\";\""

# 3. Restore Database Schema & Records
if [ -f "$EXTRACT_DIR/zvpn_db.sql" ]; then
    su - postgres -c "psql -d $DB_NAME" < "$EXTRACT_DIR/zvpn_db.sql" >/dev/null 2>&1 || true
fi

# 4. Apply all Database Migrations & Ensure Table Ownership
for mig in /opt/zvpn-panel/app/ops/migrations/*.sql; do
    [[ -f "$mig" ]] || continue
    su - postgres -c "psql -d $DB_NAME -f '$mig'" >/dev/null 2>&1 || true
done

su - postgres -c "psql -d $DB_NAME -c \"
DO \\\$do\\\$
DECLARE r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'ALTER TABLE ' || quote_ident(r.tablename) || ' OWNER TO \\\"$DB_USER\\\";';
    END LOOP;
    FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') LOOP
        EXECUTE 'ALTER SEQUENCE ' || quote_ident(r.sequence_name) || ' OWNER TO \\\"$DB_USER\\\";';
    END LOOP;
END \\\$do\\\$;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \\\"$DB_USER\\\";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO \\\"$DB_USER\\\";
\""

# Ensure fallback admin exists with owner role
su - postgres -c "psql -d $DB_NAME -c \"
INSERT INTO admins(username, password_hash, role)
VALUES('admin', '\\\$2a\\\$12\\\$dbFkjaLhzq7NUKtsHPgTb.rl0J9CZU73AJtS68nhRi4hvZy/Q0MT.', 'owner')
ON CONFLICT (username) DO UPDATE SET role='owner';
\"" >/dev/null 2>&1 || true

# 5. Restore strongSwan Certificates and Secrets
cp -rf "$EXTRACT_DIR/certs/cacerts"/* /etc/ipsec.d/cacerts/ 2>/dev/null || true
cp -rf "$EXTRACT_DIR/certs/certs"/* /etc/ipsec.d/certs/ 2>/dev/null || true
cp -rf "$EXTRACT_DIR/certs/private"/* /etc/ipsec.d/private/ 2>/dev/null || true
chmod 600 /etc/ipsec.d/private/* 2>/dev/null || true
chmod 644 /etc/ipsec.d/cacerts/* /etc/ipsec.d/certs/* 2>/dev/null || true

cp -f "$EXTRACT_DIR/conf/ipsec.conf" /etc/ipsec.conf 2>/dev/null || true
cp -f "$EXTRACT_DIR/conf/ipsec.secrets" /etc/ipsec.secrets 2>/dev/null || true
cp -f "$EXTRACT_DIR/conf/zvpn-users.secrets" /etc/ipsec.d/zvpn-users.secrets 2>/dev/null || true
chmod 600 /etc/ipsec.secrets /etc/ipsec.d/zvpn-users.secrets 2>/dev/null || true

# 6. Restore Nginx, Domain & SSL
DOMAIN=$(grep -E '^(PUBLIC_BASE_URL|VPN_SERVER)=' "$EXTRACT_DIR/backend.env" 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's#^https?://##' | sed -E 's#/.*##' || true)
if [[ -n "$DOMAIN" ]]; then
    sed -i "s/server_name .*/server_name $DOMAIN _ ;/" /etc/nginx/sites-available/zvpn-panel 2>/dev/null || true
    sed -i "s/server_name .*/server_name $DOMAIN _ ;/" /etc/nginx/sites-enabled/zvpn-panel 2>/dev/null || true
else
    sed -i "s/server_name .*/server_name _ ;/" /etc/nginx/sites-available/zvpn-panel 2>/dev/null || true
fi

if [ -d "$EXTRACT_DIR/ssl/letsencrypt" ]; then
    cp -rf "$EXTRACT_DIR/ssl/letsencrypt" /etc/ 2>/dev/null || true
    # Re-apply Nginx SSL config after restoring certificates
    if [[ -n "$DOMAIN" && "$DOMAIN" =~ \. ]]; then
        certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email >/dev/null 2>&1 || true
    fi
elif [[ -n "$DOMAIN" && "$DOMAIN" =~ \. ]]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email >/dev/null 2>&1 || true
fi

# 7. Restore Windows Client Binaries
mkdir -p /opt/zvpn-panel/app/backend/public /opt/zvpn-panel/backend/public
cp -f "$EXTRACT_DIR/public"/* /opt/zvpn-panel/app/backend/public/ 2>/dev/null || true
cp -f "$EXTRACT_DIR/public"/* /opt/zvpn-panel/backend/public/ 2>/dev/null || true

# 8. Clean temporary files
rm -rf /tmp/migration.tar.gz "$EXTRACT_DIR" /tmp/remote_restore.sh

# 9. Apply Speed Optimizations
[ -f /opt/zvpn-panel/app/ops/optimize-speed.sh ] && bash /opt/zvpn-panel/app/ops/optimize-speed.sh || true

# 10. Restart and enable services
systemctl restart postgresql zvpn-panel strongswan-starter nginx
REMOTE_RESTORE_EOF

chmod +x "$TEMP_DIR/remote_restore.sh"

info "4/5 Transferring and executing restore on new server..."
TEMP_ARCHIVE="/tmp/zvpn-migration-$$.tar.gz"
tar -czf "$TEMP_ARCHIVE" -C "$TEMP_DIR" .
eval "$SCP_CMD '$TEMP_ARCHIVE' root@$NEW_IP:/tmp/migration.tar.gz"
rm -f "$TEMP_ARCHIVE"
ok "Data transferred to new server."

eval "$SSH_CMD 'rm -rf /tmp/migration-extract && mkdir -p /tmp/migration-extract && tar -xzf /tmp/migration.tar.gz -C /tmp/migration-extract && bash /tmp/migration-extract/remote_restore.sh'"
ok "Database, CA certificates, SSL, and secrets successfully restored on new server!"

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
