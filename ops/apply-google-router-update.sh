#!/usr/bin/env bash
# Apply already-downloaded source without requiring a Git checkout.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Root required' >&2; exit 1; }
APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$APP" == /opt/zvpn-panel/app && -f "$APP/backend/.env" ]] || { echo 'Run from the installed ZVPN application' >&2; exit 1; }
cd "$APP"
bash ops/install-psiphon.sh
# Retire the isolated, time-limited probe if this machine ran one.
systemctl stop psiphon-probe.service 2>/dev/null || true
install -o root -g root -m 755 ops/helper/warp-router.py /usr/local/libexec/zvpn/warp-router.py
install -o root -g root -m 644 ops/helper/warp_policy.py /usr/local/libexec/zvpn/warp_policy.py
install -o root -g root -m 755 ops/full-backup.py /usr/local/libexec/zvpn/full-backup.py
npm --prefix frontend run build
systemctl restart zvpn-warp-router.service zvpn-panel.service
echo 'Google router updated. Select Psiphon and the Gemini preset in Settings.'
