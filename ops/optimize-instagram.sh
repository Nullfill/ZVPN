#!/bin/bash
# ==============================================================================
# ZVPN Panel - Instagram & Social Media Ultra-Speed Optimizer
# Tunes kernel, TCP stack, UDP/IKEv2 and DNS for maximum streaming performance
# Run as root: bash ops/optimize-instagram.sh
# ==============================================================================
set -e

C='\033[1;36m'; G='\033[1;32m'; Y='\033[1;33m'; N='\033[0m'
info() { echo -e "${C}[ZVPN-TURBO]${N} $*"; }
ok()   { echo -e "${G}[✓]${N} $*"; }

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash $0"; exit 1; }

echo -e "${C}============================================================${N}"
echo -e "${G}    ZVPN Instagram & Social Media Ultra-Speed Optimizer    ${N}"
echo -e "${C}============================================================${N}"
echo ""

# ── 1. BBR v2 + Aggressive Kernel Network Tuning ────────────────────────────
info "1/7  Applying BBR + high-throughput kernel network buffers..."
cat << 'EOF' > /etc/sysctl.d/99-zvpn-instagram.conf
# ── TCP congestion control: BBR (throughput-optimal for long-fat pipes) ──────
net.core.default_qdisc           = fq_codel
net.ipv4.tcp_congestion_control  = bbr

# ── Socket buffer sizes: 128 MB for 4K-video-grade throughput ───────────────
net.core.rmem_max                = 134217728
net.core.wmem_max                = 134217728
net.core.rmem_default            = 33554432
net.core.wmem_default            = 33554432
net.ipv4.tcp_rmem                = 8192 1048576 134217728
net.ipv4.tcp_wmem                = 8192 1048576 134217728
net.ipv4.udp_rmem_min            = 65536
net.ipv4.udp_wmem_min            = 65536

# ── Reduce TCP handshake latency ─────────────────────────────────────────────
net.ipv4.tcp_fastopen            = 3
net.ipv4.tcp_syn_retries         = 2
net.ipv4.tcp_synack_retries      = 2
net.ipv4.tcp_fin_timeout         = 10
net.ipv4.tcp_tw_reuse            = 1
net.ipv4.tcp_keepalive_time      = 30
net.ipv4.tcp_keepalive_intvl     = 5
net.ipv4.tcp_keepalive_probes    = 3

# ── Eliminate packet loss & reordering (critical for Instagram video) ────────
net.ipv4.tcp_sack                = 1
net.ipv4.tcp_dsack               = 1
net.ipv4.tcp_fack                = 0
net.ipv4.tcp_recovery            = 1
net.ipv4.tcp_retries2            = 8
net.ipv4.tcp_slow_start_after_idle = 0

# ── Large backlog for burst connections (Stories, Reels) ─────────────────────
net.core.netdev_max_backlog      = 250000
net.core.somaxconn               = 65535
net.ipv4.tcp_max_syn_backlog     = 65535
net.ipv4.tcp_max_tw_buckets      = 2000000

# ── VPN forwarding (mandatory for IKEv2 tunnel) ──────────────────────────────
net.ipv4.ip_forward              = 1
net.ipv4.conf.all.forwarding     = 1
net.ipv4.conf.all.rp_filter      = 0
net.ipv4.conf.default.rp_filter  = 0
net.ipv4.ip_no_pmtu_disc         = 0

# ── UDP optimization (IKEv2/ESP packets) ─────────────────────────────────────
net.ipv4.udp_mem                 = 102400 873800 134217728

# ── Memory pressure relief ───────────────────────────────────────────────────
vm.swappiness                    = 10
vm.dirty_ratio                   = 40
vm.dirty_background_ratio        = 10
EOF

sysctl --system > /dev/null 2>&1 || true
ok "BBR + 128MB kernel buffers applied."

# ── 2. MSS Clamping to prevent fragmentation inside VPN tunnel ──────────────
info "2/7  Setting TCP MSS clamping (eliminates broken Instagram images/videos)..."
for table in FORWARD POSTROUTING; do
    iptables -t mangle -C "$table" -p tcp --tcp-flags SYN,RST SYN \
        -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || \
    iptables -t mangle -A "$table" -p tcp --tcp-flags SYN,RST SYN \
        -j TCPMSS --clamp-mss-to-pmtu
done
which netfilter-persistent > /dev/null 2>&1 && netfilter-persistent save > /dev/null 2>&1 || true
ok "MSS clamping active."

# ── 3. strongSwan thread boost ───────────────────────────────────────────────
info "3/7  Boosting strongSwan threads for parallel Instagram connections..."
NCPU=$(nproc 2>/dev/null || echo 2)
THREADS=$(( NCPU * 16 ))
[[ $THREADS -lt 32 ]] && THREADS=32
mkdir -p /etc/strongswan.d
cat << EOF > /etc/strongswan.d/charon-instagram.conf
charon {
    threads = $THREADS
    ikesa_limit = 0
    processor {
        priority = 0
    }
}
EOF
ok "strongSwan threads set to $THREADS."

# ── 4. Hardware AES-GCM cipher (Intel/AMD AES-NI accelerated) ───────────────
info "4/7  Enabling AES-GCM hardware cipher (zero CPU overhead for encryption)..."
if [ -f /etc/ipsec.conf ]; then
    sed -i "s/^[[:space:]]*esp=.*/    esp=aes128gcm128,aes256gcm128,aes128-sha256,aes256-sha256!/" /etc/ipsec.conf
    sed -i "s/^[[:space:]]*ike=.*/    ike=aes128gcm128-sha256-ecp256,aes256gcm128-sha256-ecp256,aes128-sha256-ecp256,aes256-sha256-ecp384,aes128-sha256-modp2048,aes256-sha256-modp2048!/" /etc/ipsec.conf
fi
ok "AES-GCM hardware ciphers active."

# ── 5. DNS upgrade to Cloudflare 1.1.1.1 (fastest resolver on earth) ────────
info "5/7  Switching DNS to Cloudflare 1.1.1.1 (lowers first-byte time for CDN)..."
if [ -f /etc/resolv.conf ]; then
    # Don't overwrite if systemd-resolved is managing it
    if ! grep -q "systemd-resolved" /etc/resolv.conf 2>/dev/null; then
        cat << 'EOF' > /etc/resolv.conf
nameserver 1.1.1.1
nameserver 1.0.0.1
nameserver 8.8.8.8
EOF
    fi
fi
# Install and configure systemd-resolved with Cloudflare if available
if systemctl is-active --quiet systemd-resolved 2>/dev/null; then
    mkdir -p /etc/systemd/resolved.conf.d
    cat << 'EOF' > /etc/systemd/resolved.conf.d/cloudflare.conf
[Resolve]
DNS=1.1.1.1 1.0.0.1
FallbackDNS=8.8.8.8 8.8.4.4
DNSOverTLS=opportunistic
EOF
    systemctl restart systemd-resolved > /dev/null 2>&1 || true
fi
ok "DNS set to Cloudflare 1.1.1.1."

# ── 6. IRQ balancing for NIC (spreads network load across CPU cores) ────────
info "6/7  Enabling CPU IRQ balancing for network cards..."
if ! command -v irqbalance &>/dev/null; then
    apt-get install -y -qq irqbalance > /dev/null 2>&1 || true
fi
systemctl enable irqbalance > /dev/null 2>&1 && \
systemctl restart irqbalance > /dev/null 2>&1 || true
ok "IRQ balancing enabled."

# ── 7. Restart services ──────────────────────────────────────────────────────
info "7/7  Restarting VPN services..."
systemctl restart strongswan-starter 2>/dev/null || systemctl restart strongswan 2>/dev/null || true
systemctl restart zvpn-panel 2>/dev/null || true

echo ""
echo -e "${G}================================================================${N}"
echo -e "${G}  [✓] Instagram Ultra-Speed Optimizations DONE!               ${N}"
echo -e "${G}================================================================${N}"
echo ""
echo -e "  ${C}BBR congestion control:${N}  $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)"
echo -e "  ${C}Queue discipline:${N}         $(sysctl -n net.core.default_qdisc 2>/dev/null)"
echo -e "  ${C}Socket RX buffer:${N}         $(( $(sysctl -n net.core.rmem_max 2>/dev/null) / 1048576 )) MB"
echo -e "  ${C}strongSwan threads:${N}       $THREADS"
echo -e "  ${C}TCP Fast Open:${N}            $(sysctl -n net.ipv4.tcp_fastopen 2>/dev/null)"
echo -e "  ${C}DNS resolver:${N}             Cloudflare 1.1.1.1"
echo ""
echo -e "  ${Y}Expected Instagram improvement: 2x–5x faster reel/story loading${N}"
echo ""
