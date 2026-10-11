#!/usr/bin/env bash
# Byte-preserving migration using the same full snapshot as Telegram/GitHub.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEW_IP="${1:-}"
NEW_PORT="${2:-22}"
[[ -n "$NEW_IP" ]] || read -rp 'New server IP: ' NEW_IP
python3 - "$NEW_IP" "$NEW_PORT" <<'PY'
import ipaddress,sys
assert ipaddress.ip_address(sys.argv[1]).version == 4, 'IPv4 destination required'
assert 1 <= int(sys.argv[2]) <= 65535
PY
command -v sshpass >/dev/null || { apt-get update -qq; apt-get install -y sshpass; }
read -rsp 'New server root SSH password: ' SSHPASS
echo
export SSHPASS
WORK="$(mktemp -d)"
trap 'unset SSHPASS; rm -rf "$WORK"' EXIT
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new -p "$NEW_PORT" "root@$NEW_IP")
SCP=(sshpass -e scp -o StrictHostKeyChecking=accept-new -P "$NEW_PORT")
"${SSH[@]}" 'echo SSH_OK'
# The current panel stays available; PostgreSQL takes a consistent dump.
python3 "$SOURCE_DIR/ops/full-backup.py" > "$WORK/backup.tar.gz"
REMOTE_DIR="$("${SSH[@]}" 'mktemp -d /tmp/zvpn-migrate-XXXXXXXX')"
[[ "$REMOTE_DIR" =~ ^/tmp/zvpn-migrate-[A-Za-z0-9]+$ ]] || exit 1
"${SCP[@]}" "$WORK/backup.tar.gz" "$SOURCE_DIR/ops/restore-full-backup.py" "$SOURCE_DIR/ops/restore-full-backup.sh" "root@$NEW_IP:$REMOTE_DIR/"
"${SSH[@]}" "bash '$REMOTE_DIR/restore-full-backup.sh' '$REMOTE_DIR/backup.tar.gz' --yes"
"${SSH[@]}" "rm -rf -- '$REMOTE_DIR'"
echo 'Migration complete. Point the existing domain DNS to the new server.'
echo 'Accounts, shared traffic, Xray UUIDs and the existing IKE/TLS certificates are preserved.'
echo 'Active connections reconnect; live sessions are not transferred.'
