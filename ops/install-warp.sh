#!/usr/bin/env bash
# Installed by the main installer; routing is controlled in administrator settings.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Root required' >&2; exit 1; }
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! command -v warp-cli >/dev/null; then
  . /etc/os-release
  [[ "$ID" == ubuntu || "$ID" == debian ]] || { echo 'WARP installation requires Ubuntu or Debian' >&2; exit 1; }
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  apt-get update -qq
  apt-get install -y curl gpg ca-certificates
  curl --fail --silent --show-error --location https://pkg.cloudflareclient.com/pubkey.gpg -o "$WORK/key"
  gpg --batch --yes --dearmor -o "$WORK/key.gpg" "$WORK/key"
  install -o root -g root -m 644 "$WORK/key.gpg" /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
  printf 'deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ %s main\n' "$VERSION_CODENAME" > /etc/apt/sources.list.d/cloudflare-client.list
  apt-get update -qq
  apt-get install -y cloudflare-warp
fi
install -d -o root -g root -m 755 /usr/local/libexec/zvpn
install -o root -g root -m 755 "$SOURCE_DIR/ops/helper/warp-router.py" /usr/local/libexec/zvpn/warp-router.py
install -o root -g root -m 644 "$SOURCE_DIR/ops/helper/warp_policy.py" /usr/local/libexec/zvpn/warp_policy.py
install -o root -g root -m 644 "$SOURCE_DIR/ops/systemd/zvpn-warp-router.service" /etc/systemd/system/zvpn-warp-router.service
install -o root -g root -m 755 -d /etc/zvpn /etc/systemd/system/zvpn-panel.service.d
cat > /etc/systemd/system/zvpn-panel.service.d/warp.conf <<'EOF'
[Service]
ReadWritePaths=/etc/zvpn
EOF
systemctl daemon-reload
systemctl enable --now warp-svc
if ! warp-cli --accept-tos registration show >/dev/null 2>&1; then
  warp-cli --accept-tos registration new
fi
# Proxy mode leaves the server's default route and SSH connection unchanged.
warp-cli --accept-tos mode proxy
warp-cli --accept-tos proxy port 40000
warp-cli --accept-tos connect
systemctl enable --now zvpn-warp-router
echo 'WARP proxy installed. Configure selected websites and users in Settings > WARP.'
