#!/bin/bash
set -e

DOMAIN="${1:-ike.spinbox.ir}"
ADMIN_PASS="${2:-admin123456}"

echo "[1/3] Configuring Nginx for domain $DOMAIN..."
sed -i "s/server_name .*/server_name $DOMAIN _ ;/" /etc/nginx/sites-available/zvpn-panel 2>/dev/null || true
sed -i "s/server_name .*/server_name $DOMAIN _ ;/" /etc/nginx/sites-enabled/zvpn-panel 2>/dev/null || true
nginx -t
systemctl reload nginx

echo "[2/3] Activating SSL (HTTPS) for $DOMAIN..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || true

echo "[3/3] Setting Admin Password..."
sudo -u postgres psql -d zvpn -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO zvpn; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO zvpn; ALTER TABLE admins OWNER TO zvpn;" 2>/dev/null || true
cd /opt/zvpn-panel/app/backend
node scripts/create-admin.js admin "$ADMIN_PASS"

echo ""
echo "=================================================="
echo " [✓] DONE!"
echo " URL: https://$DOMAIN"
echo " User: admin"
echo " Pass: $ADMIN_PASS"
echo "=================================================="
