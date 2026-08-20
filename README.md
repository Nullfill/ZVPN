# ZVPN Panel - Next-Gen IKEv2 VPN Management Platform 🛡️
### پنل مدیریت حرفه‌ای و مدرن IKEv2 / strongSwan (معماری Multi-Agent v3.0.0)

[![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)](https://github.com/zvpn-panel/zvpn-panel)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg)](https://nodejs.org/)
[![strongSwan](https://img.shields.io/badge/strongSwan-5.9%2B-red.svg)](https://www.strongswan.org/)
[![Database](https://img.shields.io/badge/PostgreSQL-14%2B-blue.svg)](https://www.postgresql.org/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)
[![License](https://img.shields.io/badge/license-MIT-purple.svg)](LICENSE)

---

## 📖 معرفی پروژه (Overview)

پروژه **ZVPN Panel** یک پلتفرم مدیریت سشن‌ها، کاربران و ترافیک سرورهای **IKEv2 / strongSwan** است که با معماری ماژولار و بازطراحی چندعاملی (**Multi-Agent Architecture**) به سطح **Production-Ready** ارتقا یافته است.

این پنل برای مدیریت همزمان اتصال کلاینت‌های **Windows**، **iOS**، **macOS** و **Android** (برنامه strongSwan) با بالاترین پایداری، سرعت و امنیت توسعه داده شده است.

---

## ✨ ویژگی‌های کلیدی بر اساس حوزه‌های ۷ عاملی (Key Features)

### 1. 🛡️ موتور مدیریت IKEv2 و strongSwan (VPN Specialist)
- **مدیریت نشست‌های همزمان (Session Reconciler)**: حل کامل Race Condition‌ها در اتصال مجدد با تشخیص دقیق سشن‌های قدیمی و جدید بر اساس سن SA.
- **Grace Period هوشمند (۴۵ ثانیه)**: جلوگیری از قطع اشتباه کلاینت هنگام جابجایی شبکه (Wi-Fi به 4G یا رویدادهای MOBIKE).
- **سیاست‌های سقف اتصال (Max Devices Policy)**: انتخاب استراتژی `disconnect_oldest` (پیش‌فرض) یا `reject_newest`.
- **پروپوزال‌های استاندارد رمزنگاری**: سازگاری کامل با کلاینت بومی ویندوز (`ike=aes128-sha256-ecp256...`, `esp=aes128-sha256...`).
- **DPD و NAT-T اجباری**: اعمال `dpdaction=clear`, `dpddelay=30s`, `dpdtimeout=120s` و `forceencaps=yes`.

### 2. 🏗️ معماری ماژولار بک‌اند (Backend Architecture)
- ساختار استاندارد لایه‌ای: تفکیک وظایف در کنترلرها، سرویس‌ها، مخازن داده و میدل‌ویرها.
- مدیریت پایگاه‌داده PostgreSQL با سیستم Migration خودکار و Connection Pool پایدار.
- صف ناهمگام و Debounce شده برای هماهنگ‌سازی سکرت‌ها و رایت اتمیک فایل‌های سیستمی.

### 3. 🔒 امنیت و ایزوله‌سازی دسترسی‌ها (Security & Hardening)
- اجرای پنل با کاربر سیستمی بدون دسترسی مستقیم (`zvpn`) و اجرای عملیات روت فقط از طریق اسکریپت امن `/usr/local/sbin/zvpn-helper`.
- رمزنگاری متقارن سکرت‌های کاربران با **AES-256-GCM**.
- کنترل دسترسی بر پایه نقش (**RBAC**: Admin, Operator, Viewer).
- محدودسازی نرخ درخواست‌ها (Rate Limiting) و هدرهای امنیتی Helmet.

### 4. 📊 سیستم پایش و لاگینگ زنده (Observability & Logging)
- ثبت لاگ‌های ساختاریافته به فرمت JSON در ۴ سطح: `error`, `warn`, `info`, `debug`.
- ردیابی درخواست‌ها با `X-Request-Id` و سانسور خودکار رمزهای عبور و توکن‌ها.
- رابط گرافیکی مشاهده و جستجوی لاگ‌ها در پنل ادمین با امکان فیلتر بر اساس سطح، کاربر و متادیتا.

### 5. 🎨 رابط کاربری مدرن (21st Design SaaS Dashboard)
- توسعه‌یافته با **React 18 + Vite + TailwindCSS + Framer Motion**.
- پشتیبانی از تم تاریک و روشن (Dark / Light Mode) و طراحی واکنش‌گرا (Mobile First).
- داشبورد آماری با گیج‌های مصرف پردازنده، رم، دیسک و وضعیت زنده strongSwan.
- مودال دانلود آنی کانفیگ، QR Code، و صفحات دانلود کلاینت اختصاصی.

### 6. 🧪 تست‌های خودکار و تضمین کیفیت (QA & Integration)
- تست‌های پوشش‌دهنده Reconciler, SA Parser, Crypto, RBAC و API Endpoints.
- بیلد بدون خطای TypeScript و فرانت‌اند.

### 7. 🚀 استقرار و ارتقای بدون قطعی (DevOps & Deployment)
- اسکریپت نصب تمام‌خودکار و تکرارپذیر `install.sh`.
- اسکریپت ارتقای تک‌دستوری `upgrade.sh` همراه با پشتیبان‌گیری خودکار.

---

## 🚀 نصب سریع روی سرور خام (Quick Install)

روی سرور Ubuntu 20.04/22.04/24.04 یا Debian 11/12 با دسترسی root اجرا کنید:

```bash
git clone https://github.com/zvpn-panel/zvpn-panel.git /tmp/zvpn-release
cd /tmp/zvpn-release
sudo bash install.sh
```

اسکریپت به صورت خودکار تمام پیش‌نیازها (Node.js 20, PostgreSQL, strongSwan, Nginx) را نصب و راه‌اندازی می‌کند.

---

## 🔄 ارتقا از نسخه قبلی (Upgrade)

برای ارتقای پنل بدون از دست رفتن کاربران، سکرت‌ها یا تنظیمات دامنه:

```bash
cd /path/to/new-release
sudo bash upgrade.sh
```

---

## 📁 ساختار مخزن (Repository Structure)

```text
├── backend/
│   ├── src/
│   │   ├── services/      # سرویس‌های محاسباتی، Reconciler، پارسر و آمار
│   │   ├── routes/        # مسیرهای API و ابزارهای مانیتورینگ
│   │   ├── middleware/    # مدیریت خطاها، احراز هویت و RBAC
│   │   ├── db.js          # کانکشن پول PostgreSQL
│   │   ├── logger.js      # لاگر ساختاریافته JSON
│   │   ├── worker.js      # ورکر مصرف ترافیک و هماهنگ‌سازی سشن‌ها
│   │   └── server.js      # سرور اصلی Express
│   └── tests/             # تست‌های خودکار Node.js
├── frontend/
│   ├── src/
│   │   ├── pages/         # صفحات Dashboard, Users, Sessions, Logs, Settings
│   │   ├── components/    # کامپوننت‌های مدرن شیشه‌ای، مودال‌ها و ویزاردها
│   │   └── lib/           # کلاینت API و فرمت‌کننده‌ها
│   └── dist/              # خروجی بهینه‌شده پروداکشن
├── ops/
│   ├── helper/            # اسکریپت روت با دسترسی محدود (zvpn-helper)
│   ├── migrations/        # مایگریشن‌های دیتابیس
│   ├── systemd/           # سرویس لینوکس zvpn-panel.service
│   └── nginx/             # تمپلیت Nginx Reverse Proxy
├── docs/                  # مستندات معماری، استقرار، امنیت و عیب‌یابی
├── install.sh             # اسکریپت نصب خودکار
├── upgrade.sh             # اسکریپت ارتقای امن
└── VERSION                # نسخه ۳.۰.۰
```

---

## 📄 لایسنس (License)

این پروژه تحت مجوز [MIT](LICENSE) منتشر شده است.
