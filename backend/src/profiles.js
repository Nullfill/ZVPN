import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';
import { decryptSecret } from './crypto.js';
import { getVpnProfileConfig } from './services/vpnConfig.js';

let caCache = null;
async function caInfo() {
  if (caCache) return caCache;
  const pem = await fs.readFile(config.vpnCaCert, 'utf8');
  const body = pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g, '');
  caCache = { pem, derBase64: body };
  return caCache;
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export async function androidProfile(user) {
  const ca = await caInfo();
  const vpn = await getVpnProfileConfig();
  const profile = {
    uuid: uuidv4(),
    name: `${config.panelName} - ${user.username}`,
    type: 'ikev2-eap',
    remote: { addr: vpn.serverAddress, id: vpn.remoteId, cert: ca.derBase64 },
    local: { eap_id: user.username, id: user.username, shared_secret: decryptSecret(user.secret_enc) },
    'split-tunneling': { 'block-ipv4': true, 'block-ipv6': true },
  };
  return JSON.stringify(profile, null, 2);
}

export async function iosProfile(user) {
  const ca = await caInfo();
  const vpn = await getVpnProfileConfig();
  const topUuid = uuidv4().toUpperCase();
  const certUuid = uuidv4().toUpperCase();
  const vpnUuid = uuidv4().toUpperCase();
  const username = xmlEscape(user.username);
  const password = xmlEscape(decryptSecret(user.secret_enc));
  const server = xmlEscape(vpn.serverAddress);
  const remoteId = xmlEscape(vpn.remoteId);
  const display = xmlEscape(`${config.panelName} - ${user.username}`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadContent</key><array>
<dict>
<key>PayloadCertificateFileName</key><string>zvpn-ca.cer</string>
<key>PayloadContent</key><data>${ca.derBase64}</data>
<key>PayloadDisplayName</key><string>${xmlEscape(config.panelName)} Root CA</string>
<key>PayloadIdentifier</key><string>com.zvpn.ca.${certUuid.toLowerCase()}</string>
<key>PayloadType</key><string>com.apple.security.root</string>
<key>PayloadUUID</key><string>${certUuid}</string><key>PayloadVersion</key><integer>1</integer>
</dict>
<dict>
<key>PayloadDisplayName</key><string>${display}</string>
<key>PayloadIdentifier</key><string>com.zvpn.vpn.${vpnUuid.toLowerCase()}</string>
<key>PayloadType</key><string>com.apple.vpn.managed</string>
<key>PayloadUUID</key><string>${vpnUuid}</string><key>PayloadVersion</key><integer>1</integer>
<key>UserDefinedName</key><string>${display}</string>
<key>VPNType</key><string>IKEv2</string>
<key>IKEv2</key><dict>
<key>RemoteAddress</key><string>${server}</string>
<key>RemoteIdentifier</key><string>${remoteId}</string>
<key>LocalIdentifier</key><string>${username}</string>
<key>AuthenticationMethod</key><string>Certificate</string>
<key>ExtendedAuthEnabled</key><integer>1</integer>
<key>AuthName</key><string>${username}</string>
<key>AuthPassword</key><string>${password}</string>
<key>EnablePFS</key><integer>0</integer>
<key>DeadPeerDetectionRate</key><string>Medium</string>
</dict>
</dict>
</array>
<key>PayloadDisplayName</key><string>${display}</string>
<key>PayloadIdentifier</key><string>com.zvpn.profile.${topUuid.toLowerCase()}</string>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadUUID</key><string>${topUuid}</string>
<key>PayloadVersion</key><integer>1</integer>
</dict></plist>`;
}

function psSingleQuote(s) {
  return String(s).replace(/'/g, "''");
}

export function windowsLauncher(token) {
  const safeUrl = `${config.publicBaseUrl}/d/${token}/windows`.replace(/"/g, '');
  return `@echo off
setlocal
chcp 65001 >nul
title ZVPN Windows 10/11 Installer

:: 1. Request Administrator elevation if needed
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ZVPN] Requesting Administrator permissions...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

set "ZVPN_PS1=%TEMP%\\zvpn-setup-%RANDOM%.ps1"
echo [ZVPN] 1/3 Downloading profile configuration...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13; Invoke-WebRequest -UseBasicParsing '${safeUrl}' -OutFile '%ZVPN_PS1%'"
if errorlevel 1 (
  echo [ZVPN] ERROR: Could not download setup script from server.
  pause
  exit /b 1
)

echo [ZVPN] 2/3 Installing CA certificate and configuring IKEv2 connection...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ZVPN_PS1%"
set "RC=%ERRORLEVEL%"
del /q "%ZVPN_PS1%" >nul 2>&1

if not "%RC%"=="0" (
  echo [ZVPN] Setup finished with error code %RC%.
  pause
  exit /b %RC%
)
exit /b 0
`;
}

export async function windowsProfile(user) {
  const ca = await caInfo();
  const vpn = await getVpnProfileConfig();
  const vpnName = `${config.panelName} - ${user.username}`;
  const username = user.username;
  const password = decryptSecret(user.secret_enc);
  const script = `# ZVPN Windows IKEv2 Automated Installer
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$VpnName = '${psSingleQuote(vpnName)}'
$ServerAddress = '${psSingleQuote(vpn.serverAddress)}'
$Username = '${psSingleQuote(username)}'
$Password = '${psSingleQuote(password)}'
$CaBase64 = '${ca.derBase64}'

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "     ZVPN Windows IKEv2 Installer        " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. Install Root CA into Trusted Root Certification Authorities
try {
    Write-Host "[1/4] Installing Trusted Root CA Certificate..." -ForegroundColor Yellow
    $tempCert = Join-Path $env:TEMP ('zvpn-ca-' + [guid]::NewGuid().ToString() + '.cer')
    [IO.File]::WriteAllBytes($tempCert, [Convert]::FromBase64String($CaBase64))
    Import-Certificate -FilePath $tempCert -CertStoreLocation 'Cert:\\LocalMachine\\Root' | Out-Null
    Remove-Item $tempCert -Force -ErrorAction SilentlyContinue
    Write-Host "  -> Root CA installed successfully." -ForegroundColor Green
} catch {
    Write-Host "  -> Warning: Could not install CA to LocalMachine; trying CurrentUser..." -ForegroundColor Yellow
    Import-Certificate -FilePath $tempCert -CertStoreLocation 'Cert:\\CurrentUser\\Root' -ErrorAction SilentlyContinue | Out-Null
}

# 2. Configure Windows NAT-T Registry Fix (AssumeUDPEncapsulationContextOnSendRule = 2)
try {
    Write-Host "[2/4] Applying Windows IPsec NAT-T Compatibility..." -ForegroundColor Yellow
    Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\PolicyAgent' -Name 'AssumeUDPEncapsulationContextOnSendRule' -Value 2 -Type DWord -Force -ErrorAction SilentlyContinue
    Write-Host "  -> NAT-T registry key configured." -ForegroundColor Green
} catch {
    # Non-fatal if regular user
}

# 3. Create or Replace VPN Connection
Write-Host "[3/4] Creating IKEv2 VPN Connection: $VpnName" -ForegroundColor Yellow
Remove-VpnConnection -Name $VpnName -Force -ErrorAction SilentlyContinue
Remove-VpnConnection -Name $VpnName -AllUserConnection -Force -ErrorAction SilentlyContinue

try {
    Add-VpnConnection -Name $VpnName -ServerAddress $ServerAddress -TunnelType Ikev2 -EncryptionLevel Maximum -AuthenticationMethod Eap -RememberCredential -Force | Out-Null
} catch {
    Add-VpnConnection -Name $VpnName -ServerAddress $ServerAddress -TunnelType Ikev2 -EncryptionLevel Maximum -RememberCredential -Force | Out-Null
}

# 4. Set Hardware-Accelerated High-Security IPsec Parameters
try {
    Set-VpnConnectionIPsecConfiguration -ConnectionName $VpnName -AuthenticationTransformConstants SHA256128 -CipherTransformConstants AES128 -EncryptionMethod AES128 -IntegrityCheckMethod SHA256 -PfsGroup None -DHGroup ECP256 -Force | Out-Null
    Write-Host "  -> IPsec crypto suite configured (AES-128 / SHA-256 / ECP-256)." -ForegroundColor Green
} catch {
    try {
        Set-VpnConnectionIPsecConfiguration -ConnectionName $VpnName -AuthenticationTransformConstants SHA256128 -CipherTransformConstants AES128 -EncryptionMethod AES128 -IntegrityCheckMethod SHA256 -PfsGroup None -DHGroup Group14 -Force | Out-Null
        Write-Host "  -> IPsec crypto suite configured (AES-128 / SHA-256 / Group14)." -ForegroundColor Green
    } catch {
        Write-Host "  -> Default Windows IKEv2 proposal maintained." -ForegroundColor Yellow
    }
}

Write-Host "=========================================" -ForegroundColor Green
Write-Host " ZVPN connection successfully created!   " -ForegroundColor Green
Write-Host " Username: $Username" -ForegroundColor White
Write-Host " Password: $Password" -ForegroundColor White
Write-Host "=========================================" -ForegroundColor Green

# 5. Open Windows VPN Settings
Write-Host "Opening Windows VPN Settings..." -ForegroundColor Cyan
try {
    Start-Process "ms-settings:network-vpn"
    Write-Host "Click '$VpnName' -> 'Connect' to start using VPN." -ForegroundColor Green
} catch {
    Start-Process -FilePath "$env:SystemRoot\\System32\\rasphone.exe" -ArgumentList @('-d', $VpnName)
}
Write-Host ""
Write-Host "Tip: You can also connect anytime from the Windows taskbar network tray!" -ForegroundColor Cyan
Read-Host "Press Enter to finish..." | Out-Null
`;
  return script;
}

export async function jsonProfile(user) {
  const ca = await caInfo();
  const vpn = await getVpnProfileConfig();
  return {
    username: user.username,
    password: decryptSecret(user.secret_enc),
    serverAddress: vpn.serverAddress,
    remoteId: vpn.remoteId || vpn.serverAddress,
    caCertificateBase64: ca.derBase64,
    expiresAt: user.expires_at,
    durationDays: user.duration_days,
    activationStatus: user.activation_status,
    enabled: user.enabled,
    quotaBlocked: user.quota_blocked,
    usageTotal: Number(user.usage_total || 0),
    todayBytes: Number(user.today_bytes || 0),
    totalLimitBytes: user.unlimited_traffic ? null : (user.total_limit_bytes ? Number(user.total_limit_bytes) : null),
    dailyLimitBytes: user.daily_limit_bytes ? Number(user.daily_limit_bytes) : null,
    unlimitedTraffic: user.unlimited_traffic,
  };
}

function htmlEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtPortalBytes(n = 0) {
  n = Number(n) || 0;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i < 2 ? 0 : 1)} ${u[i]}`;
}

function portalPct(used, limit) {
  if (!limit) return 0;
  return Math.min(100, Math.round((Number(used) / Number(limit)) * 100));
}

function portalStatus(user) {
  if (!user.enabled || user.quota_blocked) return { label: 'غیرفعال', cls: 'bad' };
  if (user.activation_status === 'not_activated') return { label: 'فعال‌نشده — اولین اتصال', cls: 'warn' };
  if (user.expires_at && new Date(user.expires_at) <= new Date()) return { label: 'منقضی', cls: 'bad' };
  return { label: 'فعال', cls: 'ok' };
}

function progressBar(pct, tone = 'sky') {
  const color = pct >= 100 ? '#f43f5e' : pct >= 80 ? '#fbbf24' : tone === 'violet' ? '#818cf8' : '#38bdf8';
  return `<div class="bar"><div class="fill" style="width:${pct}%;background:${color}"></div></div>`;
}

export async function downloadPageHtml(user, links, settings) {
  const vpn = await getVpnProfileConfig();
  const panelName = settings?.general?.panelName || config.panelName;
  const pageTitle = settings?.download?.pageTitle || 'پورتال دانلود VPN';
  const supportText = settings?.download?.supportText || 'این لینک اختصاصی شماست — برای دیگران ارسال نکنید.';
  const st = portalStatus(user);
  const exp = user.expires_at
    ? new Date(user.expires_at).toLocaleDateString('fa-IR', { dateStyle: 'medium' })
    : user.duration_days && user.activation_status === 'not_activated'
      ? `${user.duration_days} روز پس از اولین اتصال`
      : '—';
  const remainDays = user.expires_at
    ? Math.max(0, Math.ceil((new Date(user.expires_at) - Date.now()) / 86400000))
    : null;
  const totalUsed = Number(user.usage_total || 0);
  const dailyUsed = Number(user.today_bytes || 0);
  const totalLimit = user.unlimited_traffic ? null : user.total_limit_bytes;
  const dailyLimit = user.daily_limit_bytes;
  const totalRemain = totalLimit ? Math.max(0, Number(totalLimit) - totalUsed) : null;
  const dailyRemain = dailyLimit ? Math.max(0, Number(dailyLimit) - dailyUsed) : null;
  const totalPct = portalPct(totalUsed, totalLimit);
  const dailyPct = portalPct(dailyUsed, dailyLimit);
  const username = htmlEsc(user.username);
  const server = htmlEsc(vpn.serverAddress);
  const remoteId = htmlEsc(vpn.remoteId || vpn.serverAddress);

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${htmlEsc(panelName)} — ${username}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:'Vazirmatn',Tahoma,system-ui,sans-serif;color:#eef6ff;
background:radial-gradient(circle at 15% 15%,#0b375c 0,transparent 32%),radial-gradient(circle at 90% 80%,#2a1652 0,transparent 30%),linear-gradient(135deg,#06101d,#090d19 65%,#071626);
padding:24px 16px 40px}
.wrap{max-width:720px;margin:0 auto;display:grid;gap:16px}
.card{padding:22px;border-radius:24px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(16px);box-shadow:0 20px 60px rgba(0,0,0,.25)}
.head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.head h1{margin:0;font-size:1.35rem}.sub{margin:6px 0 0;opacity:.75;font-size:.9rem}
.badge{display:inline-block;padding:6px 12px;border-radius:999px;font-size:.78rem;font-weight:600}
.badge.ok{background:rgba(52,211,153,.15);color:#6ee7b7}.badge.warn{background:rgba(251,191,36,.15);color:#fcd34d}.badge.bad{background:rgba(244,63,94,.15);color:#fda4af}
.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}
@media(min-width:640px){.stats{grid-template-columns:repeat(4,minmax(0,1fr))}}
.stat{padding:12px;border-radius:16px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.06)}
.stat b{display:block;font-size:1rem;margin-top:4px}.stat span{font-size:.75rem;opacity:.65}
.usage{margin-top:14px;padding:14px;border-radius:16px;background:rgba(0,0,0,.15)}
.usage h3{margin:0 0 10px;font-size:.92rem}
.row{display:flex;justify-content:space-between;gap:8px;font-size:.82rem;opacity:.85;margin-bottom:6px}
.bar{height:8px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin-bottom:12px}
.fill{height:100%;border-radius:999px;transition:width .3s}
.server{margin-top:12px;padding:12px;border-radius:14px;background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.15);font-size:.85rem;line-height:1.7}
.server code{direction:ltr;unicode-bidi:embed;background:rgba(0,0,0,.25);padding:2px 8px;border-radius:8px}
.section h2{margin:0 0 12px;font-size:1rem}
.btns{display:grid;gap:10px}
a.btn{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-radius:16px;text-decoration:none;color:#fff;font-weight:600;
background:linear-gradient(135deg,#1ea7ff,#6366f1);border:1px solid rgba(255,255,255,.12);transition:transform .15s,filter .15s}
a.btn:hover{filter:brightness(1.08);transform:translateY(-1px)}
a.btn.alt{background:rgba(255,255,255,.1)}a.btn span{font-size:.78rem;opacity:.85;font-weight:400}
.guides{display:grid;gap:10px}
.guide{padding:14px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)}
.guide b{display:block;margin-bottom:6px}.guide p{margin:0;font-size:.82rem;line-height:1.7;opacity:.82}
.foot{font-size:.78rem;opacity:.65;text-align:center;line-height:1.6;padding:0 8px}
</style>
</head>
<body>
<div class="wrap">
  <div class="card head">
    <div>
      <h1>${htmlEsc(panelName)}</h1>
      <p class="sub">${htmlEsc(pageTitle)} — <b>${username}</b></p>
    </div>
    <span class="badge ${st.cls}">${st.label}</span>
  </div>

  <div class="card">
    <div class="stats">
      <div class="stat"><span>وضعیت حساب</span><b>${st.label}</b></div>
      <div class="stat"><span>انقضا</span><b dir="rtl">${htmlEsc(exp)}${remainDays != null ? ` (${remainDays} روز)` : ''}</b></div>
      <div class="stat"><span>مصرف کل</span><b dir="ltr" style="text-align:right">${fmtPortalBytes(totalUsed)} <small style="opacity:0.65;font-size:0.8em">/ ${totalLimit ? fmtPortalBytes(totalLimit) : '∞'}</small></b></div>
      <div class="stat"><span>مصرف امروز</span><b dir="ltr" style="text-align:right">${fmtPortalBytes(dailyUsed)} <small style="opacity:0.65;font-size:0.8em">/ ${dailyLimit ? fmtPortalBytes(dailyLimit) : '∞'}</small></b></div>
    </div>

    <div class="usage">
      <h3>جزئیات مصرف</h3>
      <div class="row">
        <span>حجم کل</span>
        <span dir="ltr" style="unicode-bidi:isolate">${fmtPortalBytes(totalUsed)}${totalLimit ? ` / ${fmtPortalBytes(totalLimit)}` : ''}${totalRemain != null ? ` (باقی: ${fmtPortalBytes(totalRemain)})` : ''}</span>
      </div>
      ${totalLimit ? progressBar(totalPct) : ''}
      <div class="row">
        <span>حجم روزانه</span>
        <span dir="ltr" style="unicode-bidi:isolate">${fmtPortalBytes(dailyUsed)}${dailyLimit ? ` / ${fmtPortalBytes(dailyLimit)}` : ''}${dailyRemain != null ? ` (باقی: ${fmtPortalBytes(dailyRemain)})` : ''}</span>
      </div>
      ${dailyLimit ? progressBar(dailyPct, 'violet') : ''}
      <div class="row">
        <span>ترافیک دانلود / آپلود</span>
        <span dir="ltr" style="unicode-bidi:isolate">↓ ${fmtPortalBytes(user.download_bytes || 0)} · ↑ ${fmtPortalBytes(user.upload_bytes || 0)}</span>
      </div>
    </div>

    <div class="server">
      <b>تنظیمات اتصال</b><br>
      Server Address: <code>${server}</code><br>
      Remote ID: <code>${remoteId}</code><br>
      پروتکل: IKEv2 · EAP-MSCHAPv2
    </div>
  </div>

  <div class="card section">
    <h2>دانلود نرم‌افزار و کانکشن</h2>
    <div class="btns">
      <a class="btn" style="background:linear-gradient(135deg,#0284c7,#2563eb);grid-column:1/-1;" href="/download/windows-client.exe"><span>💻 نرم‌افزار اختصاصی ویندوز (ویندوز ۱۰ و ۱۱)</span><strong>.exe</strong></a>
      <a class="btn" href="${htmlEsc(links.android)}"><span>📱 Android — strongSwan</span><strong>.sswan</strong></a>
      <a class="btn" href="${htmlEsc(links.ios)}"><span>🍏 iPhone / iPad</span><strong>.mobileconfig</strong></a>
    </div>
  </div>

  <div class="card section">
    <h2>راهنمای اتصال</h2>
    <div class="guides">
      <div class="guide"><b>💻 ویندوز (ZVPN Client)</b><p>۱) نرم‌افزار اختصاصی را از دکمه بالا دانلود و باز کنید.<br>۲) لینک همین صفحه را در برنامه کپی کرده و روی دکمه بروزرسانی (🔄) بزنید.<br>۳) دکمه «اتصال به ZVPN» را بزنید تا ارتباط پرسرعت با پروتکل IKEv2 فعال شود.</p></div>
      <div class="guide"><b>📱 اندروید</b><p>۱) نرم‌افزار strongSwan را نصب کنید.<br>۲) فایل .sswan را دانلود و باز کنید.<br>۳) با نام کاربری و رمز عبور خود متصل شوید.</p></div>
      <div class="guide"><b>🍏 آیفون و آیپد</b><p>۱) فایل .mobileconfig را دانلود و نصب کنید.<br>۲) در تنظیمات گوشی بخش VPN آن را فعال و متصل کنید.</p></div>
      <div class="guide"><b>⚠️ نکته مهم</b><p>این لینک اختصاصی شماست. از ارسال آن به افراد دیگر خودداری کنید.</p></div>
    </div>
  </div>

  <p class="foot">${htmlEsc(supportText)}</p>
</div>
</body>
</html>`;
}
