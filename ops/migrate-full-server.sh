#!/usr/bin/env bash
# Byte-preserving migration using the same full snapshot as Telegram/GitHub.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f /opt/zvpn-panel/app/backend/.env ]] || { echo 'Run on the currently installed ZVPN server' >&2; exit 1; }
NEW_IP="${1:-}"
NEW_PORT="${2:-}"
[[ -n "$NEW_IP" ]] || read -rp 'New server IP: ' NEW_IP < /dev/tty
if [[ -z "$NEW_PORT" ]]; then
    read -rp 'New server SSH port [22]: ' NEW_PORT < /dev/tty
    NEW_PORT="${NEW_PORT:-22}"
fi
python3 - "$NEW_IP" "$NEW_PORT" <<'PY'
import ipaddress,sys
assert ipaddress.ip_address(sys.argv[1]).version == 4, 'IPv4 destination required'
assert 1 <= int(sys.argv[2]) <= 65535
PY
command -v sshpass >/dev/null || { apt-get update -qq; apt-get install -y sshpass; }
read -rsp 'New server root SSH password: ' SSHPASS < /dev/tty
echo
export SSHPASS
WORK="$(mktemp -d)"
trap 'unset SSHPASS; rm -rf "$WORK"' EXIT
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new -p "$NEW_PORT" "root@$NEW_IP")
SCP=(sshpass -e scp -o StrictHostKeyChecking=accept-new -P "$NEW_PORT")
"${SSH[@]}" 'echo SSH_OK'
SOURCE_ID="$(cat /etc/machine-id)"
DEST_ID="$("${SSH[@]}" 'cat /etc/machine-id')"
[[ "$SOURCE_ID" != "$DEST_ID" ]] || { echo 'Destination is the source server; migration refused' >&2; exit 1; }
# The current panel stays available; PostgreSQL takes a consistent dump.
python3 "$TOOLS/full-backup.py" > "$WORK/backup.tar.gz"
REMOTE_DIR="$("${SSH[@]}" 'mktemp -d /tmp/zvpn-migrate-XXXXXXXX')"
[[ "$REMOTE_DIR" =~ ^/tmp/zvpn-migrate-[A-Za-z0-9]+$ ]] || exit 1
"${SCP[@]}" "$WORK/backup.tar.gz" "$TOOLS/restore-full-backup.py" "$TOOLS/restore-full-backup.sh" "root@$NEW_IP:$REMOTE_DIR/"
"${SSH[@]}" "bash '$REMOTE_DIR/restore-full-backup.sh' '$REMOTE_DIR/backup.tar.gz' --yes"
"${SSH[@]}" 'cd /opt/zvpn-panel/app/backend && node scripts/netlify-status.js'
"${SSH[@]}" 'cd /opt/zvpn-panel/app/backend && node scripts/ike-relay-status.js'
"${SSH[@]}" "rm -rf -- '$REMOTE_DIR'"
echo 'Migration complete. Point the existing domain DNS to the new server.'
echo 'Accounts, shared traffic, Xray UUIDs and the existing IKE/TLS certificates are preserved.'
echo 'Active connections reconnect; live sessions are not transferred.'
DOMAIN="$(python3 - /opt/zvpn-panel/app/backend/.env "$TOOLS/full-backup.py" <<'PY'
import importlib.util,pathlib,sys
from urllib.parse import urlparse
spec=importlib.util.spec_from_file_location('snapshot',sys.argv[2]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
print(urlparse(m.env_value(pathlib.Path(sys.argv[1]).read_text(),'PUBLIC_BASE_URL')).hostname or '')
PY
)"
if [[ -n "$DOMAIN" ]]; then
    echo "Update the DNS A record of $DOMAIN to $NEW_IP. Waiting up to 10 minutes."
    RESOLVED=0
    for ((i=0; i<60; i++)); do
        if python3 - "$DOMAIN" "$NEW_IP" <<'PY'
import socket,sys
try: addresses={x[4][0] for x in socket.getaddrinfo(sys.argv[1],None,socket.AF_INET)}
except OSError: sys.exit(1)
sys.exit(0 if addresses == {sys.argv[2]} else 1)
PY
        then RESOLVED=1; break; fi
        sleep 10
    done
    if [[ "$RESOLVED" == 1 ]]; then
        "${SSH[@]}" 'curl -fsS http://127.0.0.1:3300/api/health >/dev/null && systemctl is-active --quiet strongswan-starter xray zvpn-panel nginx'
        echo 'DNS updated and destination services are active. Existing certificates retained.'
    else
        echo 'Data restored, but DNS still pending. Do not remove the old server yet.'
    fi
fi
