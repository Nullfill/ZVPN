#!/usr/bin/env bash
set -u
C='\033[1;36m';G='\033[1;32m';R='\033[1;31m';Y='\033[1;33m';N='\033[0m'
VER="$(cat "$(dirname "$0")/VERSION" 2>/dev/null || echo 2.1.0)"
pass(){ echo -e "${G}✓ PASS${N} $1"; }
fail(){ echo -e "${R}✗ FAIL${N} $1"; }
warn(){ echo -e "${Y}⚠ WARNING${N} $1"; }
echo -e "${C}ZVPN Panel Doctor v${VER}${N}"
echo

check(){
  local name="$1" cmd="$2" retries="${3:-1}"
  for ((i=1; i<=retries; i++)); do
    if eval "$cmd" >/dev/null 2>&1; then
      pass "$name"
      return 0
    fi
    [[ $i -lt $retries ]] && sleep 1
  done
  fail "$name"
  return 1
}

check "strongSwan service" "systemctl is-active --quiet strongswan-starter" 3
check "IKE UDP/500" "ss -lun | grep -q ':500 '" 3
check "NAT-T UDP/4500" "ss -lun | grep -q ':4500 '" 3
check "VICI / swanctl" "sudo /usr/local/sbin/zvpn-helper list-sas" 2
check "strongSwan PKI tool" "command -v pki >/dev/null" 1
check "Panel backend service" "systemctl is-active --quiet zvpn-panel" 3
check "Backend health API" "curl -fsS http://127.0.0.1:3300/api/health" 5
check "Nginx config" "nginx -t" 1
check "PostgreSQL" "systemctl is-active --quiet postgresql" 2
check "Runtime secrets (panel rw)" "sudo -u zvpn test -r /opt/zvpn-panel/runtime/ipsec-users.secrets && sudo -u zvpn test -w /opt/zvpn-panel/runtime/ipsec-users.secrets" 1
check "strongSwan secrets 600 root" "test \"$(stat -c '%U:%G:%a' /etc/ipsec.d/zvpn-users.secrets 2>/dev/null)\" = 'root:root:600'" 1
check "secrets include path" "grep -q '^include /etc/ipsec.d/zvpn-users.secrets$' /etc/ipsec.secrets" 1
check "Windows IKE proposal" "grep -qE '^[[:space:]]*ike=.*aes128-sha256-ecp256' /etc/ipsec.conf" 1
check "Windows ESP proposal" "grep -qE '^[[:space:]]*esp=.*aes128-sha256' /etc/ipsec.conf" 1
check "IP forwarding" "test \"$(sysctl -n net.ipv4.ip_forward 2>/dev/null)\" = \"1\"" 1

if [[ -f /opt/zvpn-panel/app/backend/.env ]]; then
  DB_URL="$(grep '^DATABASE_URL=' /opt/zvpn-panel/app/backend/.env | cut -d= -f2-)"
  if [[ -n "$DB_URL" ]]; then
    psql "$DB_URL" -tAc "SELECT 1 FROM schema_migrations LIMIT 1" >/dev/null 2>&1 && pass "DB migrations table" || warn "schema_migrations missing"
  fi
fi

used="$(df / --output=pcent 2>/dev/null | tail -1 | tr -dc '0-9')"
if [[ -n "$used" && "$used" -ge 90 ]]; then warn "Disk usage ${used}%"; else pass "Disk space OK (${used:-?}%)"; fi

if journalctl -u strongswan-starter -n 150 --no-pager 2>/dev/null | grep -q "zvpn-users.secrets.*Permission denied"; then
  warn "strongSwan Permission denied in recent logs"
fi

echo
echo "--- IKE sessions (sample) ---"
sudo /usr/local/sbin/zvpn-helper list-sas 2>/dev/null | head -15 || true
echo
echo "--- panel logs ---"
journalctl -u zvpn-panel -n 15 --no-pager 2>/dev/null || true
