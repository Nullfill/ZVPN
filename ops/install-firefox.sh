#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Root required' >&2; exit 1; }
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)'
id zvpn-firefox >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/zvpn-panel/firefox --shell /usr/sbin/nologin zvpn-firefox
install -d -o root -g root -m 755 /etc/zvpn /usr/local/libexec/zvpn/firefox
install -d -o zvpn-firefox -g zvpn-firefox -m 700 /var/lib/zvpn-panel/firefox
if [[ ! -e /etc/zvpn/firefox.key ]]; then
  (umask 077; openssl rand 32 > /etc/zvpn/firefox.key)
fi
[[ ! -L /etc/zvpn/firefox.key && $(stat -c %s /etc/zvpn/firefox.key) == 32 ]] || { echo 'Invalid Firefox credential key' >&2; exit 1; }
chown root:zvpn-firefox /etc/zvpn/firefox.key
chmod 640 /etc/zvpn/firefox.key
chown -R zvpn-firefox:zvpn-firefox /var/lib/zvpn-panel/firefox
find /var/lib/zvpn-panel/firefox -type f -exec chmod 600 {} +
install -o root -g root -m 644 "$SOURCE_DIR/ops/firefox/core.mjs" "$SOURCE_DIR/ops/firefox/service.mjs" /usr/local/libexec/zvpn/firefox/
install -o root -g root -m 644 "$SOURCE_DIR/ops/systemd/zvpn-firefox.service" /etc/systemd/system/zvpn-firefox.service
systemctl daemon-reload
# Account linking is available without selecting this provider. No user routes change.
systemctl enable --now zvpn-firefox.service
systemctl try-restart zvpn-firefox.service
echo 'Firefox provider installed. Link a Mozilla account in Google routing settings.'
