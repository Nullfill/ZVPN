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
  return `@echo off\r\nsetlocal\r\ntitle ZVPN Windows VPN Installer\r\n\r\npowershell.exe -NoProfile -Command "if (-not ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))) { exit 1 }"\r\nif errorlevel 1 (\r\n  echo Administrator permission is required. Requesting elevation...\r\n  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"\r\n  exit /b\r\n)\r\n\r\nset "ZVPNPS1=%TEMP%\\zvpn-setup-%RANDOM%-%RANDOM%.ps1"\r\necho Downloading your VPN profile...\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing '${safeUrl}' -OutFile '%ZVPNPS1%'"\r\nif errorlevel 1 (\r\n  echo Download failed.\r\n  pause\r\n  exit /b 1\r\n)\r\n\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ZVPNPS1%"\r\nset "RC=%ERRORLEVEL%"\r\ndel /q "%ZVPNPS1%" >nul 2>&1\r\nif not "%RC%"=="0" (\r\n  echo Installer returned error %RC%.\r\n  pause\r\n)\r\nexit /b %RC%\r\n`;
}

export async function windowsProfile(user) {
  const ca = await caInfo();
  const vpn = await getVpnProfileConfig();
  const vpnName = `${config.panelName} - ${user.username}`;
  const username = user.username;
  const password = decryptSecret(user.secret_enc);
  const script = `# ZVPN Windows IKEv2 installer
$ErrorActionPreference = 'Stop'
$VpnName = '${psSingleQuote(vpnName)}'
$ServerAddress = '${psSingleQuote(vpn.serverAddress)}'
$Username = '${psSingleQuote(username)}'
$Password = '${psSingleQuote(password)}'
$CaBase64 = '${ca.derBase64}'
# ... (rest uses $ServerAddress from panel settings)
Import-Module VpnClient
$tempCert = Join-Path $env:TEMP ('zvpn-ca-' + [guid]::NewGuid().ToString() + '.cer')
[IO.File]::WriteAllBytes($tempCert, [Convert]::FromBase64String($CaBase64))
Import-Certificate -FilePath $tempCert -CertStoreLocation 'Cert:\\LocalMachine\\Root' | Out-Null
Remove-Item $tempCert -Force -ErrorAction SilentlyContinue
$EapXml = @'
<EapHostConfig xmlns="http://www.microsoft.com/provisioning/EapHostConfig"><EapMethod><Type xmlns="http://www.microsoft.com/provisioning/EapCommon">26</Type></EapMethod><Config xmlns="http://www.microsoft.com/provisioning/EapHostConfig"><Eap xmlns="http://www.microsoft.com/provisioning/BaseEapConnectionPropertiesV1"><Type>26</Type><EapType xmlns="http://www.microsoft.com/provisioning/MsChapV2ConnectionPropertiesV1"><UseWinLogonCredentials>false</UseWinLogonCredentials></EapType></Eap></Config></EapHostConfig>
'@
$old = Get-VpnConnection -Name $VpnName -AllUserConnection -ErrorAction SilentlyContinue
if ($old) { Remove-VpnConnection -Name $VpnName -AllUserConnection -Force }
Add-VpnConnection -Name $VpnName -ServerAddress $ServerAddress -TunnelType Ikev2 -EncryptionLevel Maximum -AuthenticationMethod Eap -EapConfigXmlStream $EapXml -AllUserConnection -RememberCredential -Force | Out-Null
Set-VpnConnectionIPsecConfiguration -ConnectionName $VpnName -AuthenticationTransformConstants SHA256128 -CipherTransformConstants AES128 -EncryptionMethod AES128 -IntegrityCheckMethod SHA256 -PfsGroup None -DHGroup ECP256 -AllUserConnection -Force | Out-Null
Write-Host 'VPN profile installed successfully.' -ForegroundColor Green
Write-Host 'Windows VPN connection window is opening. Click Connect to establish the VPN.' -ForegroundColor Cyan
Start-Process -FilePath "$env:SystemRoot\\System32\\rasphone.exe" -ArgumentList @('-d', $VpnName)
Read-Host 'Press Enter to close' | Out-Null
`;
  return script;
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
      <div class="stat"><span>انقضا</span><b>${htmlEsc(exp)}${remainDays != null ? ` · ${remainDays} روز` : ''}</b></div>
      <div class="stat"><span>مصرف کل</span><b>${fmtPortalBytes(totalUsed)}${totalLimit ? ` / ${fmtPortalBytes(totalLimit)}` : ' / ∞'}</b></div>
      <div class="stat"><span>مصرف امروز</span><b>${fmtPortalBytes(dailyUsed)}${dailyLimit ? ` / ${fmtPortalBytes(dailyLimit)}` : ' / ∞'}</b></div>
    </div>

    <div class="usage">
      <h3>جزئیات مصرف</h3>
      <div class="row"><span>حجم کل</span><span>${fmtPortalBytes(totalUsed)}${totalLimit ? ` از ${fmtPortalBytes(totalLimit)}` : ''}${totalRemain != null ? ` · باقی ${fmtPortalBytes(totalRemain)}` : ''}</span></div>
      ${totalLimit ? progressBar(totalPct) : ''}
      <div class="row"><span>حجم روزانه</span><span>${fmtPortalBytes(dailyUsed)}${dailyLimit ? ` از ${fmtPortalBytes(dailyLimit)}` : ''}${dailyRemain != null ? ` · باقی ${fmtPortalBytes(dailyRemain)}` : ''}</span></div>
      ${dailyLimit ? progressBar(dailyPct, 'violet') : ''}
      <div class="row"><span>آپلود / دانلود</span><span>${fmtPortalBytes(user.upload_bytes || 0)} ↑ · ${fmtPortalBytes(user.download_bytes || 0)} ↓</span></div>
    </div>

    <div class="server">
      <b>تنظیمات اتصال</b><br>
      Server Address: <code>${server}</code><br>
      Remote ID: <code>${remoteId}</code><br>
      پروتکل: IKEv2 · EAP-MSCHAPv2
    </div>
  </div>

  <div class="card section">
    <h2>دانلود پروفایل</h2>
    <div class="btns">
      <a class="btn" href="${htmlEsc(links.android)}"><span>Android — strongSwan</span><strong>.sswan</strong></a>
      <a class="btn" href="${htmlEsc(links.ios)}"><span>iPhone / iPad</span><strong>.mobileconfig</strong></a>
      <a class="btn" href="${htmlEsc(links.windowsLauncher)}"><span>Windows 10/11 — نصب آسان</span><strong>.cmd</strong></a>
      <a class="btn alt" href="${htmlEsc(links.windows)}"><span>Windows — پیشرفته (PowerShell)</span><strong>.ps1</strong></a>
    </div>
  </div>

  <div class="card section">
    <h2>راهنمای نصب</h2>
    <div class="guides">
      <div class="guide"><b>Android</b><p>۱) strongSwan VPN Client را نصب کنید. ۲) فایل .sswan را باز کنید. ۳) Import و Connect — نام کاربری و رمز همان حساب VPN شماست.</p></div>
      <div class="guide"><b>iPhone / iPad</b><p>۱) فایل .mobileconfig را دانلود کنید. ۲) Settings → General → VPN &amp; Device Management → Install. ۳) Settings → VPN → Connect.</p></div>
      <div class="guide"><b>Windows</b><p>۱) فایل .cmd را Run as Administrator اجرا کنید. ۲) پروفایل نصب می‌شود و پنجره VPN باز می‌شود. ۳) Connect را بزنید. اگر خطا داشتید نسخه .ps1 را امتحان کنید.</p></div>
      <div class="guide"><b>نکته</b><p>اگر آدرس سرور عوض شد، پروفایل را دوباره از همین صفحه دانلود کنید. لینک را در اختیار دیگران قرار ندهید.</p></div>
    </div>
  </div>

  <p class="foot">${htmlEsc(supportText)}</p>
</div>
</body>
</html>`;
}
