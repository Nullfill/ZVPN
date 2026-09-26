#!/usr/bin/env bash
# ================================================================
#  ZVPN Panel — Full Restore from GitHub Backup
#  Works on: fresh Ubuntu server OR existing ZVPN install
#
#  One-liner (from any fresh server):
#    curl -fsSL https://raw.githubusercontent.com/Nullfill/ZVPN/main/ops/restore-github.sh | \
#      sudo GITHUB_TOKEN=ghp_xxx GITHUB_REPO=user/zvpn-backups BACKUP_PASS=xxx bash
#
#  Interactive:
#    sudo bash ops/restore-github.sh
# ================================================================
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash ops/restore-github.sh"; exit 1; }

C='\033[1;36m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; N='\033[0m'
info(){ echo -e "${C}[RESTORE]${N} $*"; }
ok(){   echo -e "${G}[OK]${N} $*"; }
warn(){ echo -e "${Y}[!]${N} $*"; }
die(){  echo -e "${R}[ERROR]${N} $*" >&2; exit 1; }

APP_DIR=/opt/zvpn-panel/app
ENV_FILE="$APP_DIR/backend/.env"

echo ""
echo -e "${C}══════════════════════════════════════════${N}"
echo -e "${C}  ZVPN Panel — Restore from GitHub       ${N}"
echo -e "${C}══════════════════════════════════════════${N}"
echo ""

# ── Collect credentials ──────────────────────────────────────
# Load from existing .env if available (re-install scenario)
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE" 2>/dev/null || true; set +a
fi

GITHUB_TOKEN="${GITHUB_TOKEN:-${BACKUP_GITHUB_TOKEN:-}}"
GITHUB_REPO="${GITHUB_REPO:-${BACKUP_GITHUB_REPO:-}}"
BACKUP_PASS="${BACKUP_PASS:-${BACKUP_PASSPHRASE:-}}"

if [[ -z "$GITHUB_TOKEN" ]]; then
  read -rsp "GitHub Personal Access Token (repo scope): " GITHUB_TOKEN < /dev/tty; echo
fi
[[ -n "$GITHUB_TOKEN" ]] || die "GitHub token is required"

if [[ -z "$GITHUB_REPO" ]]; then
  read -rp "Backup repo (e.g. YourUser/zvpn-backups): " GITHUB_REPO < /dev/tty
fi
[[ -n "$GITHUB_REPO" ]] || die "Backup repo is required"

if [[ -z "$BACKUP_PASS" ]]; then
  read -rsp "Backup passphrase (empty if not encrypted): " BACKUP_PASS < /dev/tty; echo
fi

# ── Install prerequisites ────────────────────────────────────
info "Installing prerequisites..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq 2>/dev/null
apt-get install -y --no-install-recommends \
  curl jq openssl tar gzip postgresql-client git rsync 2>/dev/null | tail -1
ok "Prerequisites ready"

# ── Fetch latest backup from GitHub ─────────────────────────
info "Fetching backup list from GitHub..."
HTTP_RESP="$(curl -sSL -w "\nHTTP_STATUS:%{http_code}" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/releases?per_page=10" || true)"

HTTP_CODE="$(echo "$HTTP_RESP" | grep '^HTTP_STATUS:' | cut -d: -f2 || true)"
RELEASES="$(echo "$HTTP_RESP" | sed '/^HTTP_STATUS:/d')"

if [[ "$HTTP_CODE" == "401" ]]; then
  die "توکن گیت‌هاب نامعتبر است (401 Unauthorized) — لطفاً توکن را بررسی کنید."
elif [[ "$HTTP_CODE" == "404" ]]; then
  die "ریپوی $GITHUB_REPO در گیت‌هاب پیدا نشد (404 Not Found) — نام ریپو را بررسی کنید."
elif [[ "$HTTP_CODE" != "200" ]]; then
  ERR_MSG="$(echo "$RELEASES" | jq -r '.message // empty' 2>/dev/null || echo "$RELEASES")"
  die "خطای گیت‌هاب (کد $HTTP_CODE): $ERR_MSG"
fi

[[ "$(echo "$RELEASES" | jq 'type' 2>/dev/null)" == '"array"' ]] || \
  die "Failed to parse releases from GitHub — check token and repo name"
[[ "$(echo "$RELEASES" | jq 'length' 2>/dev/null)" -gt 0 ]] || \
  die "No backups found in $GITHUB_REPO — run backup-github.sh first"

# Show available backups and pick latest
echo ""
echo "Available backups:"
echo "$RELEASES" | jq -r 'to_entries[] | "  [\(.key)] \(.value.name)"'
echo ""

LATEST="$(echo "$RELEASES" | jq -r '.[0]')"
RELEASE_NAME="$(echo "$LATEST" | jq -r '.name')"
ASSET="$(echo "$LATEST" | jq -r '.assets[0]')"
ASSET_API_URL="$(echo "$ASSET" | jq -r '.url')"
ASSET_NAME="$(echo "$ASSET" | jq -r '.name')"
ASSET_SIZE="$(echo "$ASSET" | jq -r '.size')"

info "Restoring from: $RELEASE_NAME"
info "File: $ASSET_NAME ($(numfmt --to=iec "$ASSET_SIZE" 2>/dev/null || echo "${ASSET_SIZE} bytes"))"
echo ""

# ── Download ─────────────────────────────────────────────────
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

info "Downloading backup..."
curl -fsSL -L \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/octet-stream" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -o "$WORKDIR/$ASSET_NAME" "$ASSET_API_URL"
ok "Downloaded ($(du -sh "$WORKDIR/$ASSET_NAME" | cut -f1))"

# ── Decrypt if needed ────────────────────────────────────────
if [[ "$ASSET_NAME" == *.enc ]]; then
  if [[ -z "$BACKUP_PASS" ]]; then
    echo ""
    warn "این فایل پشتیبان با پسفراز رمزنگاری شده است."
    read -rp "لطفاً پسفراز بک‌آپ را وارد کنید: " BACKUP_PASS < /dev/tty || true
    echo ""
  fi
  [[ -n "$BACKUP_PASS" ]] || die "فایل رمزنگاری شده است و پسفراز وارد نشد."
  info "Decrypting..."
  ARCHIVE="$WORKDIR/zvpn-restore.tar.gz"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
    -pass "pass:$BACKUP_PASS" \
    -in "$WORKDIR/$ASSET_NAME" -out "$ARCHIVE" || die "Decryption failed — wrong passphrase?"
  ok "Decrypted successfully"
else
  ARCHIVE="$WORKDIR/$ASSET_NAME"
fi

# ── Extract ──────────────────────────────────────────────────
EXTRACT="$WORKDIR/extracted"
mkdir -p "$EXTRACT"
tar -xzf "$ARCHIVE" -C "$EXTRACT"
ok "Archive extracted"

# ── Install ZVPN if not present ──────────────────────────────
if [[ ! -f "$APP_DIR/backend/src/server.js" ]]; then
  info "ZVPN not installed — running fresh install first..."
  rm -rf /tmp/zvpn-install
  git clone https://github.com/Nullfill/ZVPN.git /tmp/zvpn-install >/dev/null 2>&1
  cd /tmp/zvpn-install
  # Non-interactive install (skip SSL/domain prompts — we restore from backup)
  NON_INTERACTIVE=1 bash install.sh || true
  ok "Base ZVPN installed"
  cd /
fi

# ── Stop services ────────────────────────────────────────────
info "Stopping services..."
systemctl stop zvpn-panel 2>/dev/null || true
systemctl stop strongswan-starter 2>/dev/null || true
sleep 1
ok "Services stopped"

# ── Restore .env ─────────────────────────────────────────────
info "Restoring .env..."
cp -f "$EXTRACT/panel.env" "$APP_DIR/backend/.env"
chown zvpn:zvpn "$APP_DIR/backend/.env" 2>/dev/null || true
chmod 600 "$APP_DIR/backend/.env"
# Reload env
set -a; source "$APP_DIR/backend/.env" 2>/dev/null || true; set +a
ok ".env restored"

# ── Restore database ─────────────────────────────────────────
info "Restoring database..."
DB_URL="$(grep '^DATABASE_URL=' "$APP_DIR/backend/.env" | cut -d= -f2-)"
DB_NAME="$(echo "$DB_URL" | sed -E 's/.*\/([^?]+).*/\1/')"
DB_USER="$(echo "$DB_URL" | sed -E 's/.*:\/\/([^:]+):.*/\1/')"
DB_PASS="$(echo "$DB_URL" | sed -E 's/.*:([^@]+)@.*/\1/')"

# Ensure DB user and database exist
su - postgres -c "psql -c \"CREATE USER \\\"$DB_USER\\\" WITH PASSWORD '$DB_PASS';\"" 2>/dev/null || \
su - postgres -c "psql -c \"ALTER USER \\\"$DB_USER\\\" WITH PASSWORD '$DB_PASS';\""   2>/dev/null || true
su - postgres -c "psql -c \"ALTER USER \\\"$DB_USER\\\" WITH SUPERUSER;\""              2>/dev/null || true
su - postgres -c "psql -c \"CREATE DATABASE \\\"$DB_NAME\\\" OWNER \\\"$DB_USER\\\";\""  2>/dev/null || true
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE \\\"$DB_NAME\\\" TO \\\"$DB_USER\\\";\""  2>/dev/null || true

# Restore dump
zcat "$EXTRACT/database.sql.gz" | su - postgres -c "psql -d $DB_NAME -v ON_ERROR_STOP=0 -q" 2>/dev/null || true

# Fix ownership
su - postgres -c "psql -d $DB_NAME -c \"\
  DO \\\$do\\\$
  DECLARE r RECORD;
  BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public') LOOP
      EXECUTE 'ALTER TABLE ' || quote_ident(r.tablename) || ' OWNER TO \\\"$DB_USER\\\";';
    END LOOP;
    FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public') LOOP
      EXECUTE 'ALTER SEQUENCE ' || quote_ident(r.sequence_name) || ' OWNER TO \\\"$DB_USER\\\";';
    END LOOP;
  END \\\$do\\\$;
  GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO \\\"$DB_USER\\\";
  GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO \\\"$DB_USER\\\";
\"" 2>/dev/null || true

ok "Database restored"

# ── Restore IPsec certificates ───────────────────────────────
info "Restoring IPsec certificates and secrets..."
mkdir -p /etc/ipsec.d/{cacerts,certs,private}

[[ -d "$EXTRACT/ipsec.d/cacerts" ]] && cp -rf "$EXTRACT/ipsec.d/cacerts/." /etc/ipsec.d/cacerts/ 2>/dev/null || true
[[ -d "$EXTRACT/ipsec.d/certs"   ]] && cp -rf "$EXTRACT/ipsec.d/certs/."   /etc/ipsec.d/certs/   2>/dev/null || true
[[ -d "$EXTRACT/ipsec.d/private" ]] && cp -rf "$EXTRACT/ipsec.d/private/." /etc/ipsec.d/private/ 2>/dev/null || true

chmod 600 /etc/ipsec.d/private/*                                          2>/dev/null || true
chmod 644 /etc/ipsec.d/cacerts/* /etc/ipsec.d/certs/*                    2>/dev/null || true

[[ -f "$EXTRACT/ipsec.conf" ]]           && cp -f "$EXTRACT/ipsec.conf"           /etc/ipsec.conf           2>/dev/null || true
[[ -f "$EXTRACT/ipsec.secrets" ]]        && cp -f "$EXTRACT/ipsec.secrets"        /etc/ipsec.secrets        2>/dev/null || true
[[ -f "$EXTRACT/zvpn-users.secrets" ]]   && cp -f "$EXTRACT/zvpn-users.secrets"   /etc/ipsec.d/zvpn-users.secrets 2>/dev/null || true

chmod 600 /etc/ipsec.secrets /etc/ipsec.d/zvpn-users.secrets             2>/dev/null || true
ok "IPsec certificates restored — existing users will connect without re-setup"

# ── Restore Let's Encrypt SSL ────────────────────────────────
if [[ -d "$EXTRACT/letsencrypt" && -n "$(ls -A "$EXTRACT/letsencrypt" 2>/dev/null)" ]]; then
  info "Restoring Let's Encrypt certificates..."
  cp -rf "$EXTRACT/letsencrypt/." /etc/letsencrypt/ 2>/dev/null || true
  ok "SSL certificates restored"
else
  warn "No Let's Encrypt backup found — you may need to run certbot manually"
fi

# ── Restore Nginx config ─────────────────────────────────────
if [[ -f "$EXTRACT/nginx/zvpn-panel" ]]; then
  info "Restoring Nginx config..."
  cp -f "$EXTRACT/nginx/zvpn-panel" /etc/nginx/sites-available/zvpn-panel
  ln -sf /etc/nginx/sites-available/zvpn-panel /etc/nginx/sites-enabled/zvpn-panel 2>/dev/null || true
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  ok "Nginx config restored"
fi

# ── Restore runtime secrets ──────────────────────────────────
mkdir -p /opt/zvpn-panel/runtime
if [[ -d "$EXTRACT/runtime" && -n "$(ls -A "$EXTRACT/runtime" 2>/dev/null)" ]]; then
  cp -rf "$EXTRACT/runtime/." /opt/zvpn-panel/runtime/ 2>/dev/null || true
  chown -R zvpn:zvpn /opt/zvpn-panel/runtime 2>/dev/null || true
  chmod 700 /opt/zvpn-panel/runtime
  chmod 600 /opt/zvpn-panel/runtime/* 2>/dev/null || true
fi

# ── Build frontend (in case of version mismatch) ─────────────
if [[ -d "$APP_DIR/frontend" ]]; then
  info "Building frontend..."
  cd "$APP_DIR/frontend"
  npm ci --no-audit --no-fund --silent 2>/dev/null | tail -1 || true
  npm run build --silent 2>/dev/null | tail -3 || true
  chown -R root:root "$APP_DIR/frontend/dist" 2>/dev/null || true
fi

# ── Sudoers & Helper ──────────────────────────────────────────
if [[ -f "$APP_DIR/ops/helper/zvpn-helper" ]]; then
  info "Configuring zvpn-helper & sudoers..."
  install -o root -g root -m 0755 "$APP_DIR/ops/helper/zvpn-helper" /usr/local/sbin/zvpn-helper
fi
chmod +x "$APP_DIR/ops/backup-github.sh" 2>/dev/null || true
chmod +x "$APP_DIR/ops/restore-github.sh" 2>/dev/null || true
cat << 'EOF' > /etc/sudoers.d/zvpn-panel
zvpn ALL=(root) NOPASSWD: /usr/local/sbin/zvpn-helper, /usr/local/sbin/zvpn-helper *
zvpn ALL=(root) NOPASSWD: /opt/zvpn-panel/app/ops/backup-github.sh, /opt/zvpn-panel/app/ops/backup-github.sh *
EOF
chmod 440 /etc/sudoers.d/zvpn-panel

# ── Firewall & Routing ────────────────────────────────────────
info "Configuring firewall and IP forwarding..."
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf 2>/dev/null || echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
iptables -t nat -C POSTROUTING -s 10.0.0.0/8 -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s 10.0.0.0/8 -j MASQUERADE 2>/dev/null || true
iptables -C FORWARD -s 10.0.0.0/8 -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -s 10.0.0.0/8 -j ACCEPT 2>/dev/null || true
iptables -C FORWARD -d 10.0.0.0/8 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -d 10.0.0.0/8 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
iptables -t mangle -C FORWARD -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || \
  iptables -t mangle -A FORWARD -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true

# ── Optimizations ─────────────────────────────────────────────
[[ -f "$APP_DIR/ops/optimize-speed.sh" ]] && bash "$APP_DIR/ops/optimize-speed.sh" 2>/dev/null || true
[[ -f "$APP_DIR/ops/optimize-instagram.sh" ]] && bash "$APP_DIR/ops/optimize-instagram.sh" 2>/dev/null || true

# ── Start services ────────────────────────────────────────────
info "Starting all services..."
systemctl daemon-reload
systemctl restart postgresql                 2>/dev/null || true
sleep 1
systemctl restart strongswan-starter         2>/dev/null || true
sleep 2
systemctl restart zvpn-panel                 2>/dev/null || true
sleep 2

DOMAIN="$(grep -E '^(PUBLIC_BASE_URL|VPN_SERVER)=' "$APP_DIR/backend/.env" 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's#^https?://##;s#/.*##' || true)"

# Configure/Verify HTTPS via certbot
if [[ -n "$DOMAIN" && "$DOMAIN" =~ \. ]]; then
  info "Applying SSL certificate for $DOMAIN..."
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect >/dev/null 2>&1 || true
fi

if nginx -t >/dev/null 2>&1; then
  systemctl restart nginx 2>/dev/null || true
else
  warn "Nginx config test failed — check manually: nginx -t"
fi

# ── Health check ─────────────────────────────────────────────
PORT="${PORT:-3300}"
info "Running health check..."
for i in 1 2 3 4 5; do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    ok "Panel is healthy on port $PORT ✓"
    HEALTH_OK=1
    break
  fi
  sleep 2
done
if [[ "${HEALTH_OK:-0}" -ne 1 ]]; then
  warn "Health check failed — run: journalctl -u zvpn-panel -n 60 --no-pager"
fi

# ── DNS & Migration Verification ─────────────────────────────
DOMAIN="$(grep -E '^(PUBLIC_BASE_URL|VPN_SERVER)=' "$APP_DIR/backend/.env" 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's#^https?://##;s#/.*##' || true)"
MY_IP="$(curl -fs4s https://api.ipify.org 2>/dev/null || curl -fs4s https://ifconfig.me 2>/dev/null || ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' || true)"

echo ""
echo -e "${G}══════════════════════════════════════════════════${N}"
echo -e "${G}  Restore complete ✓${N}"
echo    "  Source:  $RELEASE_NAME"
echo    "  Panel:   https://${DOMAIN:-<your-domain>}"
echo    "  Users:   All existing accounts restored"
echo    "  Certs:   IPsec CA preserved — no re-download needed"
echo    "  SSL:     Let's Encrypt restored"
echo -e "${G}══════════════════════════════════════════════════${N}"
echo ""

if [[ -n "$DOMAIN" && "$DOMAIN" =~ \. ]]; then
  RESOLVED="$(dig +short "$DOMAIN" A 2>/dev/null | tail -1 || true)"
  if [[ -n "$MY_IP" && "$RESOLVED" == "$MY_IP" ]]; then
    ok "DNS record matches this server! ($DOMAIN → $MY_IP)"
    ok "Clients are connecting to this new server now!"
  else
    echo -e "${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
    echo -e "${Y}  ⚠️ مرحله نهایی برای انتقال ترافیک کاربران:${N}"
    echo -e "${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
    echo -e "  دامنه:          ${C}$DOMAIN${N}"
    echo -e "  آی‌پی سرور جدید: ${G}${MY_IP:-نامشخص}${N}"
    echo -e "  آی‌پی در DNS:    ${R}${RESOLVED:-یافت نشد}${N}"
    echo ""
    echo -e "  ${Y}در کلودفلر یا پنل دامنه خود، رکورد A دامنه ${C}$DOMAIN${Y} را به ${G}$MY_IP${Y} تغییر دهید.${N}"
    echo -e "  ${G}به محض تغییر آی‌پی، تمامی کاربران اندروید، آیفون و ویندوز قبلی${N}"
    echo -e "  ${G}بدون هیچ تنظیمی به صورت خودکار به این سرور جدید متصل خواهند شد!${N}"
    echo -e "${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
  fi
fi
echo ""
