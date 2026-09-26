#!/usr/bin/env bash
# ================================================================
#  ZVPN Panel — Full Backup → GitHub Releases
#
#  Setup (one-time, add to /opt/zvpn-panel/app/backend/.env):
#    BACKUP_GITHUB_TOKEN=ghp_xxxxxxxxxxxx
#    BACKUP_GITHUB_REPO=YourUser/zvpn-backups   ← private repo
#    BACKUP_PASSPHRASE=your_strong_passphrase    ← encrypts the file
#
#  Usage:
#    sudo bash ops/backup-github.sh
#
#  Auto daily backup (add to crontab with: sudo crontab -e):
#    0 3 * * * bash /opt/zvpn-panel/app/ops/backup-github.sh >> /var/log/zvpn-backup.log 2>&1
# ================================================================
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash ops/backup-github.sh"; exit 1; }

APP_DIR=/opt/zvpn-panel/app
ENV_FILE="$APP_DIR/backend/.env"
KEEP_RELEASES=15   # number of backups to keep on GitHub

C='\033[1;36m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; N='\033[0m'
info(){ echo -e "${C}[BACKUP]${N} $*"; }
ok(){   echo -e "${G}[OK]${N} $*"; }
warn(){ echo -e "${Y}[!]${N} $*"; }
die(){  echo -e "${R}[ERROR]${N} $*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || die "ZVPN not installed — $ENV_FILE not found"

# Load .env vars
set -a; source "$ENV_FILE" 2>/dev/null || true; set +a

# Prefer arguments passed from CLI, then environment, then .env
GITHUB_TOKEN="${1:-${BACKUP_GITHUB_TOKEN:-}}"
GITHUB_REPO="${2:-${BACKUP_GITHUB_REPO:-}}"
BACKUP_PASS="${3:-${BACKUP_PASSPHRASE:-}}"

# Sync to .env if passed from CLI
if [[ -n "${1:-}" && -f "$ENV_FILE" ]]; then
  grep -q '^BACKUP_GITHUB_TOKEN=' "$ENV_FILE" && sed -i "s|^BACKUP_GITHUB_TOKEN=.*|BACKUP_GITHUB_TOKEN=$GITHUB_TOKEN|" "$ENV_FILE" || echo "BACKUP_GITHUB_TOKEN=$GITHUB_TOKEN" >> "$ENV_FILE"
  grep -q '^BACKUP_GITHUB_REPO=' "$ENV_FILE" && sed -i "s|^BACKUP_GITHUB_REPO=.*|BACKUP_GITHUB_REPO=$GITHUB_REPO|" "$ENV_FILE" || echo "BACKUP_GITHUB_REPO=$GITHUB_REPO" >> "$ENV_FILE"
  grep -q '^BACKUP_PASSPHRASE=' "$ENV_FILE" && sed -i "s|^BACKUP_PASSPHRASE=.*|BACKUP_PASSPHRASE=$BACKUP_PASS|" "$ENV_FILE" || echo "BACKUP_PASSPHRASE=$BACKUP_PASS" >> "$ENV_FILE"
fi

# ── Validate config ──────────────────────────────────────────
if [[ -z "$GITHUB_TOKEN" || -z "$GITHUB_REPO" ]]; then
  echo ""
  echo -e "${Y}First-time setup:${N} Add these lines to $ENV_FILE"
  echo ""
  echo "  BACKUP_GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxx"
  echo "  BACKUP_GITHUB_REPO=YourGithubUser/zvpn-backups"
  echo "  BACKUP_PASSPHRASE=some_strong_secret_passphrase"
  echo ""
  echo "  Create a free private repo at https://github.com/new"
  echo "  Create a token at https://github.com/settings/tokens (scope: repo)"
  echo ""
  die "Configuration missing in $ENV_FILE"
fi

# ── Check dependencies ───────────────────────────────────────
for cmd in curl jq pg_dump gzip tar openssl; do
  command -v "$cmd" &>/dev/null || { apt-get install -y -qq "$cmd" 2>/dev/null || die "Missing: $cmd"; }
done

TS="$(date +%Y%m%d-%H%M%S)"
TAG="backup-$TS"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo ""
echo -e "${C}══════════════════════════════════════════${N}"
echo -e "${C}  ZVPN Full Backup → GitHub              ${N}"
echo -e "${C}  $(date '+%Y-%m-%d %H:%M:%S')           ${N}"
echo -e "${C}══════════════════════════════════════════${N}"
echo ""

# ── Step 1: Collect all files ────────────────────────────────
info "Collecting files..."
mkdir -p "$WORKDIR"/{ipsec.d/cacerts,ipsec.d/certs,ipsec.d/private,letsencrypt,nginx,systemd,runtime}

cp -f  "$ENV_FILE"   "$WORKDIR/panel.env"                                  2>/dev/null || true
cp -rf /etc/ipsec.d/cacerts/. "$WORKDIR/ipsec.d/cacerts/"                 2>/dev/null || true
cp -rf /etc/ipsec.d/certs/.   "$WORKDIR/ipsec.d/certs/"                   2>/dev/null || true
cp -rf /etc/ipsec.d/private/. "$WORKDIR/ipsec.d/private/"                 2>/dev/null || true
cp -f  /etc/ipsec.conf        "$WORKDIR/ipsec.conf"                        2>/dev/null || true
cp -f  /etc/ipsec.secrets     "$WORKDIR/ipsec.secrets"                     2>/dev/null || true
cp -f  /etc/ipsec.d/zvpn-users.secrets "$WORKDIR/zvpn-users.secrets"      2>/dev/null || true
cp -rf /etc/letsencrypt/.     "$WORKDIR/letsencrypt/"                      2>/dev/null || true
cp -f  /etc/nginx/sites-available/zvpn-panel "$WORKDIR/nginx/"             2>/dev/null || true
cp -f  /etc/systemd/system/zvpn-panel.service "$WORKDIR/systemd/"          2>/dev/null || true
cp -rf /opt/zvpn-panel/runtime/. "$WORKDIR/runtime/"                       2>/dev/null || true

ok "Files collected"

# ── Step 2: Database dump ────────────────────────────────────
info "Dumping PostgreSQL database..."
DB_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
[[ -n "$DB_URL" ]] || die "DATABASE_URL not found in .env"
pg_dump "$DB_URL" | gzip -9 > "$WORKDIR/database.sql.gz"
DB_SIZE="$(du -sh "$WORKDIR/database.sql.gz" | cut -f1)"
ok "Database dumped ($DB_SIZE compressed)"

# ── Step 3: Create archive ───────────────────────────────────
info "Creating archive..."
chmod -R go-rwx "$WORKDIR"
ARCHIVE="$WORKDIR/zvpn-$TS.tar.gz"
tar -czf "$ARCHIVE" -C "$WORKDIR" \
  panel.env ipsec.d ipsec.conf ipsec.secrets zvpn-users.secrets \
  letsencrypt nginx systemd runtime database.sql.gz 2>/dev/null || true

RAW_SIZE="$(du -sh "$ARCHIVE" | cut -f1)"
ok "Archive created ($RAW_SIZE)"

# ── Step 4: Encrypt ──────────────────────────────────────────
if [[ -n "$BACKUP_PASS" ]]; then
  info "Encrypting with AES-256-CBC..."
  ENC_FILE="$WORKDIR/zvpn-$TS.tar.gz.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 \
    -pass "pass:$BACKUP_PASS" \
    -in "$ARCHIVE" -out "$ENC_FILE"
  UPLOAD_FILE="$ENC_FILE"
  UPLOAD_NAME="zvpn-$TS.tar.gz.enc"
  ok "Encrypted (passphrase protected)"
else
  warn "BACKUP_PASSPHRASE not set — backup uploaded unencrypted!"
  warn "Add BACKUP_PASSPHRASE=... to $ENV_FILE for security"
  UPLOAD_FILE="$ARCHIVE"
  UPLOAD_NAME="zvpn-$TS.tar.gz"
fi

UPLOAD_SIZE="$(du -sh "$UPLOAD_FILE" | cut -f1)"
info "Upload size: $UPLOAD_SIZE"

# ── Step 5: Create GitHub Release ───────────────────────────
info "Creating GitHub Release: $TAG"
RELEASE_JSON="$(curl -fsSL \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -X POST "https://api.github.com/repos/$GITHUB_REPO/releases" \
  -d "{
    \"tag_name\": \"$TAG\",
    \"name\": \"ZVPN Backup — $TS\",
    \"body\": \"Auto-generated full backup\\nIncludes: DB, IPsec CA+certs, .env, Let's Encrypt, Nginx, runtime\",
    \"draft\": false,
    \"prerelease\": false
  }" 2>/dev/null)"

RELEASE_ID="$(echo "$RELEASE_JSON" | jq -r '.id // empty')"
[[ -n "$RELEASE_ID" && "$RELEASE_ID" != "null" ]] || \
  die "Failed to create release: $(echo "$RELEASE_JSON" | jq -r '.message // .')"
ok "Release created (id: $RELEASE_ID)"

# ── Step 6: Upload asset ─────────────────────────────────────
info "Uploading backup to GitHub Releases..."
UPLOAD_RESP="$(curl -fsSL \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/octet-stream" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  --data-binary "@$UPLOAD_FILE" \
  "https://uploads.github.com/repos/$GITHUB_REPO/releases/$RELEASE_ID/assets?name=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$UPLOAD_NAME'))")" \
  2>/dev/null)"

ASSET_URL="$(echo "$UPLOAD_RESP" | jq -r '.browser_download_url // empty')"
[[ -n "$ASSET_URL" && "$ASSET_URL" != "null" ]] || \
  die "Upload failed: $(echo "$UPLOAD_RESP" | jq -r '.message // .')"
ok "Uploaded: $ASSET_URL"

# ── Step 7: Prune old releases ───────────────────────────────
info "Pruning old releases (keeping last $KEEP_RELEASES)..."
ALL_RELEASES="$(curl -fsSL \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/releases?per_page=100" 2>/dev/null)"

TOTAL="$(echo "$ALL_RELEASES" | jq 'length')"
if [[ "$TOTAL" -gt "$KEEP_RELEASES" ]]; then
  while IFS= read -r row; do
    rid="$(echo "$row" | jq -r '.id')"
    rtag="$(echo "$row" | jq -r '.tag_name')"
    # Delete release
    curl -fsSL -X DELETE \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com/repos/$GITHUB_REPO/releases/$rid" >/dev/null 2>&1 || true
    # Delete tag
    curl -fsSL -X DELETE \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com/repos/$GITHUB_REPO/git/refs/tags/$rtag" >/dev/null 2>&1 || true
    warn "Deleted old release: $rtag"
  done < <(echo "$ALL_RELEASES" | jq -c ".[$KEEP_RELEASES:][]")
fi

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${G}────────────────────────────────────────────────${N}"
echo -e "${G}  Backup complete ✓${N}"
echo    "  Tag:  $TAG"
echo    "  File: $UPLOAD_NAME  ($UPLOAD_SIZE)"
echo    "  Repo: https://github.com/$GITHUB_REPO/releases"
echo -e "${G}────────────────────────────────────────────────${N}"
echo ""
