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

# Read values as data; passwords containing $, quotes or | must never execute.
readarray -t SAVED_CONFIG < <(python3 - "$ENV_FILE" <<'PY'
import base64,json,pathlib,sys
values={}
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
    key,sep,value=line.partition('=')
    if sep:
        value=value.strip()
        if value.startswith('"'):
            try:value=json.loads(value)
            except ValueError:value=value.strip('"')
        elif value.startswith("'"):value=value.strip("'")
        values[key]=value
for key in ('BACKUP_GITHUB_TOKEN','BACKUP_GITHUB_REPO','BACKUP_PASSPHRASE'):
    print(base64.b64encode(values.get(key,'').encode()).decode())
PY
)

# Prefer arguments passed from CLI, then environment, then .env
GITHUB_TOKEN="${1:-${BACKUP_GITHUB_TOKEN:-$(printf '%s' "${SAVED_CONFIG[0]:-}" | base64 -d)}}"
GITHUB_REPO="${2:-${BACKUP_GITHUB_REPO:-$(printf '%s' "${SAVED_CONFIG[1]:-}" | base64 -d)}}"
BACKUP_PASS="${3-${BACKUP_PASSPHRASE:-$(printf '%s' "${SAVED_CONFIG[2]:-}" | base64 -d)}}"
[[ "$GITHUB_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die 'Invalid backup repository'

# Sync to .env if passed from CLI
if [[ -n "${1:-}" && -f "$ENV_FILE" ]]; then
  python3 - "$ENV_FILE" "$GITHUB_TOKEN" "$GITHUB_REPO" "$BACKUP_PASS" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]);names=('BACKUP_GITHUB_TOKEN','BACKUP_GITHUB_REPO','BACKUP_PASSPHRASE')
lines=[line for line in p.read_text().splitlines() if line.partition('=')[0] not in names]
lines += [key+'='+json.dumps(value,ensure_ascii=False) for key,value in zip(names,sys.argv[2:])]
p.write_text('\n'.join(lines)+'\n')
PY
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

# Complete snapshots contain private keys even when an admin forgets encryption.
REPO_PRIVATE="$(curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$GITHUB_REPO" | jq -r '.private')"
[[ "$REPO_PRIVATE" == true ]] || die 'Full backups require a private GitHub repository'

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
python3 "$APP_DIR/ops/full-backup.py" --collect "$WORKDIR/snapshot"
ARCHIVE="$WORKDIR/zvpn-$TS.tar.gz"
tar -czf "$ARCHIVE" -C "$WORKDIR/snapshot" .
ok "Complete snapshot created and certificates verified"

# ── Step 4: Encrypt ──────────────────────────────────────────
if [[ -n "$BACKUP_PASS" ]]; then
  info "Encrypting with AES-256-CBC..."
  ENC_FILE="$WORKDIR/zvpn-$TS.tar.gz.enc"
  export ZVPN_ARCHIVE_PASSWORD="$BACKUP_PASS"
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 \
    -pass env:ZVPN_ARCHIVE_PASSWORD \
    -in "$ARCHIVE" -out "$ENC_FILE"
  unset ZVPN_ARCHIVE_PASSWORD
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
