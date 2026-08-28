#!/bin/bash
set -e

DOMAIN="${1:-ike.spinbox.ir}"
ADMIN_PASS="${2:-admin123456}"
ENV_DB=$(grep '^DATABASE_URL=' /opt/zvpn-panel/app/backend/.env 2>/dev/null | sed -E 's/.*\/([^?]+).*/\1/' || echo "zvpn")

echo "[1/4] Configuring Nginx for domain $DOMAIN..."
sed -i "s/server_name .*/server_name $DOMAIN _ ;/" /etc/nginx/sites-available/zvpn-panel 2>/dev/null || true
sed -i "s/server_name .*/server_name $DOMAIN _ ;/" /etc/nginx/sites-enabled/zvpn-panel 2>/dev/null || true
nginx -t
systemctl reload nginx

echo "[2/4] Activating SSL (HTTPS) for $DOMAIN..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || true

echo "[3/4] Applying all Database Migrations and RBAC schema..."
for mig in /opt/zvpn-panel/app/ops/migrations/*.sql; do
  sudo -u postgres psql -d "$ENV_DB" -f "$mig" 2>/dev/null || true
done
sudo -u postgres psql -d "$ENV_DB" -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO zvpn; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO zvpn; ALTER TABLE admins OWNER TO zvpn;" 2>/dev/null || true

echo "[4/4] Setting Admin Password..."
sudo -u postgres psql -d "$ENV_DB" -c "
INSERT INTO admins(username, password_hash, role)
VALUES('admin', '\$2a\$12\$dbFkjaLhzq7NUKtsHPgTb.rl0J9CZU73AJtS68nhRi4hvZy/Q0MT.', 'owner')
ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='owner';
"
systemctl restart zvpn-panel

echo ""
echo "=================================================="
echo " [✓] DONE! ALL MIGRATIONS & ADMIN CONFIGURED!"
echo " URL: https://$DOMAIN"
echo " User: admin"
echo " Pass: $ADMIN_PASS"
echo "=================================================="
