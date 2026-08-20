# ZVPN Panel v2.1.0 — راهنمای Deploy

## ویژگی‌های جدید

1. **آدرس VPN از تنظیمات ادمین** — مثلاً `ike.spinbox.ir` به‌جای IP در همه پروفایل‌ها
2. **Export / Import JSON** — انتقال پنل به سرور جدید
3. **فونت Vazirmatn** — فارسی در UI

---

## فایل‌های جدید/تغییر یافته

```
backend/src/services/vpnConfig.js      ← NEW
backend/src/services/backup.js         ← NEW
backend/src/services/settings.js       ← REPLACE
backend/src/routes/v211.js             ← NEW
backend/src/profiles.js                ← REPLACE (uses dynamic VPN address)
backend/scripts/patch-v2.1-server.js   ← NEW
ops/migrations/003_vpn_settings_backup.sql
frontend/src/pages/SettingsPage.tsx    ← REPLACE
frontend/src/main.tsx                  ← font
frontend/src/index.css                 ← font
frontend/package.json                  ← @fontsource/vazirmatn
VERSION → 2.1.0
```

---

## روی سرور (از v2.0.0)

```bash
cd ~/zvpn-panel-v2.1   # پوشه release جدید
sudo ./upgrade.sh

# اگر upgrade.sh patch را اجرا نکرد:
cd /opt/zvpn-panel/app/backend
node scripts/patch-v2.1-server.js
sudo systemctl restart zvpn-panel
```

---

## تنظیم آدرس VPN

1. پنل → **تنظیمات**
2. بخش **آدرس سرور VPN**
3. Server Address: `ike.spinbox.ir`
4. Remote ID: `ike.spinbox.ir` (یا همان)
5. ذخیره

کاربران با **همان لینک دانلود قبلی** دوباره فایل می‌گیرند — آدرس جدید داخل فایل است.

---

## انتقال به سرور جدید

### سرور قدیم
1. تنظیمات → **Export JSON**
2. `backup.sh` را هم بگیرید (`.env`, certs, database)

### سرور جدید
1. `sudo ./install.sh`
2. **MASTER_KEY** را از `.env` سرور قدیم کپی کنید
3. تنظیمات → Import JSON (با تأیید checkbox)
4. گواهی IKEv2 / CA را از backup کپی کنید (یا همان CA را نگه دارید)
5. `sudo ./doctor.sh`

---

## Patch دستی server.js (در صورت نیاز)

```javascript
import { mountV211Routes } from './routes/v211.js';
// ...
mountV211Routes(app, { requireAdmin, audit, clientIp });
```

قبل از `await runMigrations();`
