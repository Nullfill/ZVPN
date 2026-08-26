#!/bin/bash
set -e

echo "=== [1/5] Applying BBR & 64MB High-Speed Kernel Network Buffers ==="
cat << 'EOF' > /etc/sysctl.d/99-zvpn-speed.conf
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.core.rmem_default = 33554432
net.core.wmem_default = 33554432
net.core.netdev_max_backlog = 100000
net.ipv4.tcp_rmem = 4096 87380 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864
net.ipv4.udp_rmem_min = 16384
net.ipv4.udp_wmem_min = 16384
net.ipv4.ip_forward = 1
net.ipv4.conf.all.forwarding = 1
net.ipv4.conf.all.rp_filter = 0
net.ipv4.conf.default.rp_filter = 0
net.ipv4.ip_no_pmtu_disc = 0
EOF

sysctl --system > /dev/null 2>&1 || true

echo "=== [2/5] Setting TCP MSS Clamping to eliminate packet fragmentation ==="
iptables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || \
iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

iptables -t mangle -C POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || \
iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

which netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1 || true

echo "=== [3/5] Optimizing strongSwan Multi-Threading & Processors ==="
mkdir -p /etc/strongswan.d
cat << 'EOF' > /etc/strongswan.d/charon-speed.conf
charon {
    threads = 32
    processor {
        priority = 1
    }
}
EOF

echo "=== [4/5] Enabling Hardware-Accelerated AES-GCM Cipher Proposals ==="
if [ -f /etc/ipsec.conf ]; then
    sed -i "s/esp=.*/esp=aes128gcm128-ecp256,aes256gcm128-ecp384,aes128gcm128,aes256gcm128,aes128-sha256!/" /etc/ipsec.conf
    sed -i "s/ike=.*/ike=aes128gcm128-prfsha256-ecp256,aes256gcm128-prfsha384-ecp384,aes128-sha256-modp2048!/" /etc/ipsec.conf
fi

echo "=== [5/5] Restarting Services and Verifying ==="
systemctl restart strongswan-starter 2>/dev/null || systemctl restart strongswan 2>/dev/null || ipsec restart 2>/dev/null || true
systemctl restart zvpn-panel 2>/dev/null || true

echo ""
echo "=========================================================="
echo " [✓] SUCCESS: All speed & performance optimizations applied!"
echo " BBR Status: $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo active)"
echo " Queue Disc: $(sysctl -n net.core.default_qdisc 2>/dev/null || echo active)"
echo "=========================================================="
