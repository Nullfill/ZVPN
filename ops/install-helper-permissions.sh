#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || exit 1
cat > /etc/sudoers.d/zvpn-panel <<'EOF'
zvpn ALL=(root) NOPASSWD: /usr/local/sbin/zvpn-helper sync-secrets, /usr/local/sbin/zvpn-helper reread-secrets, /usr/local/sbin/zvpn-helper list-sas, /usr/local/sbin/zvpn-helper terminate *, /usr/local/sbin/zvpn-helper status, /usr/local/sbin/zvpn-helper cert-info, /usr/local/sbin/zvpn-helper resolve-host *, /usr/local/sbin/zvpn-helper check-ike-ports, /usr/local/sbin/zvpn-helper endpoint-backup, /usr/local/sbin/zvpn-helper endpoint-rollback /var/lib/zvpn-panel/endpoint-backups/*, /usr/local/sbin/zvpn-helper issue-server-cert *, /usr/local/sbin/zvpn-helper set-leftid *, /usr/local/sbin/zvpn-helper normalize-conn, /usr/local/sbin/zvpn-helper strongswan-logs, /usr/local/sbin/zvpn-helper restart-strongswan, /usr/local/sbin/zvpn-helper full-backup, /usr/local/sbin/zvpn-helper sync-xray, /usr/local/sbin/zvpn-helper sync-warp, /usr/local/sbin/zvpn-helper warp-status, /usr/local/sbin/zvpn-helper warp-reconnect, /usr/local/sbin/zvpn-helper xray-epoch, /usr/local/sbin/zvpn-helper stop-xray, /usr/local/sbin/zvpn-helper backup-github *
EOF
chmod 440 /etc/sudoers.d/zvpn-panel
visudo -cf /etc/sudoers.d/zvpn-panel
