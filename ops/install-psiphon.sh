#!/usr/bin/env bash
# Local-only optional upstream for selective Google routing.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Root required' >&2; exit 1; }
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$(uname -m)" == x86_64 ]] || { echo 'Psiphon binary is currently supported on x86_64 only' >&2; exit 1; }
REV=e02a99daa375567d2df20740bb3d4673eaec11fe
SHA=d83dcaa632b265536852e2d97c45eb4831960f8dbcb2d8638293d5958483705b
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if [[ ! -x /usr/local/bin/zvpn-psiphon ]] || ! echo "$SHA  /usr/local/bin/zvpn-psiphon" | sha256sum -c --status; then
  curl -fsSL --retry 3 --max-time 120 "https://raw.githubusercontent.com/Psiphon-Labs/psiphon-tunnel-core-binaries/$REV/linux/psiphon-tunnel-core-x86_64" -o "$WORK/client"
  echo "$SHA  $WORK/client" | sha256sum -c --status
  install -o root -g root -m 755 "$WORK/client" /usr/local/bin/zvpn-psiphon
fi
id zvpn-psiphon >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/zvpn-panel/psiphon --shell /usr/sbin/nologin zvpn-psiphon
install -d -o root -g root -m 755 /etc/zvpn
python3 - "$SOURCE_DIR/ops/psiphon-network.json" <<'PY'
import json,pathlib,os,grp
target=pathlib.Path('/etc/zvpn/psiphon.json')
data=json.loads(target.read_text()) if target.exists() else json.loads(pathlib.Path(__import__('sys').argv[1]).read_text())
data.update(LocalSocksProxyPort=40002,DisableLocalHTTPProxy=True,ListenInterface='lo',
            DataRootDirectory='/var/lib/zvpn-panel/psiphon',TunnelPoolSize=1)
temporary=target.with_suffix('.tmp')
with temporary.open('w') as f:
    os.fchmod(f.fileno(),0o640);os.fchown(f.fileno(),0,grp.getgrnam('zvpn-psiphon').gr_gid)
    json.dump(data,f,indent=2)
os.replace(temporary,target)
PY
install -o root -g root -m 644 "$SOURCE_DIR/ops/systemd/zvpn-psiphon.service" /etc/systemd/system/zvpn-psiphon.service
systemctl daemon-reload
# The routing daemon starts this service only when selected and enabled.
echo 'Psiphon installed. Choose WARP or Psiphon in Google routing settings.'
