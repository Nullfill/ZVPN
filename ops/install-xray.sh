#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Root required' >&2; exit 1; }
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if [[ -z "$VERSION" && -f /usr/local/etc/xray/version.json ]]; then
  VERSION="$(python3 -c 'import json; print(json.load(open("/usr/local/etc/xray/version.json"))["version"])')"
fi
if [[ -z "$VERSION" ]]; then
  if curl --fail --silent --show-error --location --retry 3 https://api.github.com/repos/XTLS/Xray-core/releases/latest -o "$WORK/release.json"; then
    VERSION="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert not d["prerelease"] and not d["draft"]; print(d["tag_name"])' "$WORK/release.json")"
  else
    # GitHub's official latest redirect also resolves the stable release and
    # does not depend on the unauthenticated API rate limit of a shared IP.
    RELEASE_URL="$(curl --fail --silent --show-error --location --retry 3 -o /dev/null \
      -w '%{url_effective}' https://github.com/XTLS/Xray-core/releases/latest)"
    VERSION="${RELEASE_URL##*/}"
  fi
fi
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid Xray release tag' >&2; exit 1; }
case "$(uname -m)" in
  x86_64) ASSET=Xray-linux-64.zip ;;
  aarch64|arm64) ASSET=Xray-linux-arm64-v8a.zip ;;
  *) echo 'Unsupported Xray architecture' >&2; exit 1 ;;
esac
CURRENT="$(python3 -c 'import json; print(json.load(open("/usr/local/etc/xray/version.json"))["version"])' 2>/dev/null || true)"
if [[ ! -x /usr/local/bin/xray || "$CURRENT" != "$VERSION" ]]; then
  BASE="https://github.com/XTLS/Xray-core/releases/download/$VERSION"
  curl --fail --silent --show-error --location --retry 3 "$BASE/$ASSET" -o "$WORK/$ASSET"
  curl --fail --silent --show-error --location --retry 3 "$BASE/$ASSET.dgst" -o "$WORK/digest"
  python3 - "$WORK/$ASSET" "$WORK/digest" <<'PY'
import hashlib,pathlib,re,sys,zipfile
p=pathlib.Path(sys.argv[1]); digest=hashlib.sha256(p.read_bytes()).hexdigest()
assert digest.lower() in pathlib.Path(sys.argv[2]).read_text().lower(), 'Xray checksum mismatch'
with zipfile.ZipFile(p) as z: z.extract('xray',p.parent)
PY
  install -o root -g root -m 755 "$WORK/xray" /usr/local/bin/xray
fi
id xray >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin xray
install -o root -g root -m 755 -d /usr/local/etc/xray /usr/local/libexec/zvpn
python3 - "$VERSION" "$ASSET" <<'PY'
import json,pathlib,sys
pathlib.Path('/usr/local/etc/xray/version.json').write_text(json.dumps({'version':sys.argv[1],'asset':sys.argv[2]}))
PY
install -o root -g root -m 755 "$SOURCE_DIR/ops/full-backup.py" /usr/local/libexec/zvpn/full-backup.py
install -o root -g root -m 755 "$SOURCE_DIR/ops/helper/xray-apply.py" /usr/local/libexec/zvpn/xray-apply.py
install -o root -g root -m 644 "$SOURCE_DIR/ops/systemd/xray.service" /etc/systemd/system/xray.service
# The include is independent of Certbot changes to the existing server block.
install -o root -g root -m 644 "$SOURCE_DIR/ops/nginx/xray.inc" /etc/nginx/zvpn-xray.inc
python3 "$SOURCE_DIR/ops/configure-xray-nginx.py"
nginx -t
systemctl daemon-reload
systemctl enable xray
systemctl reload nginx
echo "Xray $VERSION installed; accounts are synchronized by ZVPN."
