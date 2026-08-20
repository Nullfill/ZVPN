## 2.1.0 — 2026-08-13

### VPN Server Address (Admin Settings)
- آدرس سرور و Remote ID از **تنظیمات ادمین** (DB) — override بر `.env`
- همه پروفایل‌های Android / iOS / Windows و صفحه دانلود از `ike.spinbox.ir` یا هر دامنه‌ای که بزنید
- کاربران با **همان لینک دانلود** فایل جدید می‌گیرند

### Backup Export / Import
- `GET /api/backup/export` — JSON کامل (users, settings, usage, tokens)
- `POST /api/backup/import` — merge برای انتقال سرور
- UI در صفحه تنظیمات

### UI
- فونت **Vazirmatn** (فارسی)

### Ops
- `apply-v2.1.sh` — patch + migration + rebuild
- `backend/scripts/patch-v2.1-server.js`
- Migration `003_vpn_settings_backup.sql`
