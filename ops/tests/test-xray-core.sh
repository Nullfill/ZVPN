#!/usr/bin/env bash
# End-to-end on a disposable Linux runner: XHTTP over TLS/Nginx plus Stats API.
set -Eeuo pipefail
WORK="$(mktemp -d)"
PIDS=()
cleanup() { for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done; rm -rf "$WORK"; }
trap cleanup EXIT
command -v nginx >/dev/null || { sudo apt-get update -qq; sudo apt-get install -y nginx; }
curl -fsSL --retry 3 https://api.github.com/repos/XTLS/Xray-core/releases/latest -o "$WORK/release.json"
TAG="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["tag_name"])' "$WORK/release.json")"
curl -fsSL --retry 3 "https://github.com/XTLS/Xray-core/releases/download/$TAG/Xray-linux-64.zip" -o "$WORK/core.zip"
curl -fsSL --retry 3 "https://github.com/XTLS/Xray-core/releases/download/$TAG/Xray-linux-64.zip.dgst" -o "$WORK/digest"
python3 - "$WORK" <<'PY'
import hashlib,pathlib,sys,zipfile
p=pathlib.Path(sys.argv[1]);assert hashlib.sha256((p/'core.zip').read_bytes()).hexdigest() in (p/'digest').read_text().lower()
with zipfile.ZipFile(p/'core.zip') as z:z.extract('xray',p)
PY
chmod +x "$WORK/xray"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost \
  -addext 'subjectAltName=DNS:localhost' -addext 'basicConstraints=critical,CA:FALSE' \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" >/dev/null 2>&1
node --input-type=module - "$WORK" <<'JS'
import fs from 'node:fs';
import {createHash,X509Certificate} from 'node:crypto';
import {buildXrayConfig} from './backend/src/services/xrayConfig.js';
const root=process.argv[2];
const pin=createHash('sha256').update(new X509Certificate(fs.readFileSync(root+'/cert.pem')).raw).digest('hex');
const user={id:'11111111-1111-4111-8111-111111111111',xray_uuid:'22222222-2222-4222-8222-222222222222',enabled:true,quota_blocked:false};
const server=buildXrayConfig([user]);server.log.loglevel='debug';
fs.writeFileSync(root+'/server.json',JSON.stringify(server));
fs.writeFileSync(root+'/empty.json',JSON.stringify(buildXrayConfig([])));
fs.writeFileSync(root+'/client.json',JSON.stringify({
  inbounds:[{listen:'127.0.0.1',port:11080,protocol:'socks',settings:{auth:'noauth',udp:false}}],
  outbounds:[{protocol:'vless',settings:{vnext:[{address:'127.0.0.1',port:15443,users:[{id:user.xray_uuid,encryption:'none'}]}]},
    streamSettings:{network:'xhttp',security:'tls',tlsSettings:{serverName:'localhost',pinnedPeerCertSha256:pin},
      xhttpSettings:{path:'/zvpn-xhttp/',mode:'packet-up'}}}],log:{loglevel:'debug'}}));
JS
"$WORK/xray" run -test -config "$WORK/server.json"
"$WORK/xray" run -config "$WORK/server.json" > "$WORK/server.log" 2>&1 &
CORE_PID=$!;PIDS+=("$CORE_PID")
cat > "$WORK/nginx.conf" <<EOF
pid $WORK/nginx.pid;
error_log $WORK/nginx.log;
events { worker_connections 64; }
http {
  access_log off;
  client_body_temp_path $WORK/body;
  proxy_temp_path $WORK/proxy;
  server {
    listen 127.0.0.1:15443 ssl;
    server_name localhost;
    ssl_certificate $WORK/cert.pem;
    ssl_certificate_key $WORK/key.pem;
    include $(pwd)/ops/nginx/xray.inc;
  }
}
EOF
nginx -p "$WORK" -c "$WORK/nginx.conf" -g 'daemon off;' &
PIDS+=("$!")
node --input-type=module -e "import http from 'node:http'; http.createServer((q,s)=>s.end(Buffer.alloc(1024*1024,97))).listen(18080,'127.0.0.1')" &
PIDS+=("$!")
"$WORK/xray" run -config "$WORK/client.json" > "$WORK/client.log" 2>&1 &
PIDS+=("$!")
for attempt in {1..5}; do
  if curl --fail --silent --show-error --max-time 10 --noproxy '' --socks5-hostname 127.0.0.1:11080 http://127.0.0.1:18080 > "$WORK/response"; then break; fi
  sleep 1
done
[[ "$(wc -c < "$WORK/response")" -eq 1048576 ]] || { cat "$WORK/server.log" "$WORK/client.log" "$WORK/nginx.log"; exit 1; }
"$WORK/xray" api statsquery --server=127.0.0.1:10086 -pattern 'user>>>' > "$WORK/stats.json"
node --input-type=module - "$WORK/stats.json" <<'JS'
import fs from 'node:fs';import assert from 'node:assert/strict';import {parseXrayStats} from './backend/src/services/xrayConfig.js';
const stats=parseXrayStats(JSON.parse(fs.readFileSync(process.argv[2])));
assert.equal(stats.size,1);assert.ok([...stats.values()][0].downlink>=1048576n);
console.log('TLS/XHTTP connection and per-user traffic confirmed');
JS
# Hard revocation includes established streams because the core is restarted.
kill "$CORE_PID";wait "$CORE_PID" || true
"$WORK/xray" run -config "$WORK/empty.json" > "$WORK/empty.log" 2>&1 &
PIDS+=("$!")
sleep 1
if curl --fail --silent --max-time 5 --noproxy '' --socks5-hostname 127.0.0.1:11080 http://127.0.0.1:18080 >/dev/null; then
  echo 'Revoked user still connected' >&2;exit 1
fi
echo 'Revocation verified'
