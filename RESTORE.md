# بازیابی اضطراری — server.js پاک شده

## علت
`upgrade.sh` قدیمی با `rsync --delete` فایل‌های production را با zip **ناقص** جایگزین می‌کرد و `server.js` حذف می‌شد.

## فوری — از backup

```bash
# آخرین backup
ls -lt /root/zvpn-backups/*.tar.gz | head -1

# استخراج database (کاربران سالم است)
tar -xzf /root/zvpn-backups/zvpn-XXXX.tar.gz -C /tmp
# database در /tmp/XXXX/database.sql.gz — معمولاً لازم نیست اگر DB سالم است

# zip کامل v2.1.1 را آپلود و upgrade کنید (دیگر --delete ندارد)
cd ~/zvpn-panel-v2.1.1
sudo ./upgrade.sh
```

## اگر فقط server.js لازم است

```bash
# از release کامل روی سرور
sudo cp ~/zvpn-panel-v2.1.1/backend/src/server.js /opt/zvpn-panel/app/backend/src/
sudo cp ~/zvpn-panel-v2.1.1/backend/src/vpn.js /opt/zvpn-panel/app/backend/src/
sudo cp ~/zvpn-panel-v2.1.1/backend/src/worker.js /opt/zvpn-panel/app/backend/src/
sudo cp -r ~/zvpn-panel-v2.1.1/backend/src/services /opt/zvpn-panel/app/backend/src/
sudo cp -r ~/zvpn-panel-v2.1.1/backend/src/routes /opt/zvpn-panel/app/backend/src/
sudo systemctl restart zvpn-panel
curl -s http://127.0.0.1:3300/api/health
```

## چک لیست zip قبل از upload

```bash
for f in backend/src/server.js backend/src/vpn.js backend/src/worker.js frontend/index.html; do
  test -f "$f" && echo "OK $f" || echo "MISSING $f"
done
```

همه باید `OK` باشند.
