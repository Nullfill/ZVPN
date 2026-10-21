import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';
import { decryptSecret } from './crypto.js';
import { getVpnProfileConfig } from './services/vpnConfig.js';
import { renderUserPortal } from './services/userPortal.js';

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

export function windowsLauncher(token, req = null) {
  let base = config.publicBaseUrl;
  if (req) {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host');
    if (host && !host.includes('127.0.0.1') && !host.includes('localhost')) {
      base = `${proto}://${host}`;
    }
  }
  const safeUrl = `${base}/d/${token}/windows`.replace(/"/g, '');
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

# 1. Start Windows Network Services & Configure Registry
try {
    Set-Service -Name RasMan -StartupType Manual -ErrorAction SilentlyContinue
    Start-Service -Name RasMan -ErrorAction SilentlyContinue
    Set-Service -Name PolicyAgent -StartupType Manual -ErrorAction SilentlyContinue
    Start-Service -Name PolicyAgent -ErrorAction SilentlyContinue
    Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\PolicyAgent' -Name 'AssumeUDPEncapsulationContextOnSendRule' -Value 2 -Type DWord -Force -ErrorAction SilentlyContinue
    Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\RasMan\\Parameters' -Name 'ProhibitIPSec' -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue
} catch {}

# 2. Install Root CA into Trusted Root Certification Authorities
try {
    Write-Host "[1/4] Installing Trusted Root CA Certificate..." -ForegroundColor Yellow
    $tempCert = Join-Path $env:TEMP ('zvpn-ca-' + [guid]::NewGuid().ToString() + '.cer')
    [IO.File]::WriteAllBytes($tempCert, [Convert]::FromBase64String($CaBase64))
    Import-Certificate -FilePath $tempCert -CertStoreLocation 'Cert:\\LocalMachine\\Root' -ErrorAction SilentlyContinue | Out-Null
    Import-Certificate -FilePath $tempCert -CertStoreLocation 'Cert:\\CurrentUser\\Root' -ErrorAction SilentlyContinue | Out-Null
    certutil.exe -addstore -f "Root" $tempCert 2>$null | Out-Null
    certutil.exe -addstore -f -enterprise "Root" $tempCert 2>$null | Out-Null
    Remove-Item $tempCert -Force -ErrorAction SilentlyContinue
    Write-Host "  -> Root CA installed successfully." -ForegroundColor Green
} catch {
    Write-Host "  -> Warning: Could not install CA to LocalMachine; trying CurrentUser..." -ForegroundColor Yellow
}

# 3. Create or Replace VPN Connection
Write-Host "[2/4] Creating IKEv2 VPN Connection: $VpnName" -ForegroundColor Yellow
Remove-VpnConnection -Name $VpnName -Force -ErrorAction SilentlyContinue
Remove-VpnConnection -Name $VpnName -AllUserConnection -Force -ErrorAction SilentlyContinue

try {
    Add-VpnConnection -Name $VpnName -ServerAddress $ServerAddress -TunnelType Ikev2 -EncryptionLevel Maximum -AuthenticationMethod Eap -RememberCredential -Force | Out-Null
} catch {
    Add-VpnConnection -Name $VpnName -ServerAddress $ServerAddress -TunnelType Ikev2 -EncryptionLevel Maximum -RememberCredential -Force | Out-Null
}

# 4. Set Hardware-Accelerated High-Security IPsec Parameters with Revert Fallback
try {
    Set-VpnConnectionIPsecConfiguration -ConnectionName $VpnName -AuthenticationTransformConstants GCMAES128 -CipherTransformConstants GCMAES128 -EncryptionMethod GCMAES128 -IntegrityCheckMethod SHA256 -PfsGroup None -DHGroup ECP256 -Force -ErrorAction Stop | Out-Null
    Write-Host "  -> IPsec crypto suite configured (AES-128 / SHA-256 / ECP-256)." -ForegroundColor Green
} catch {
    try {
        Set-VpnConnectionIPsecConfiguration -ConnectionName $VpnName -AuthenticationTransformConstants SHA256128 -CipherTransformConstants AES128 -EncryptionMethod AES128 -IntegrityCheckMethod SHA256 -PfsGroup None -DHGroup Group14 -Force -ErrorAction Stop | Out-Null
        Write-Host "  -> IPsec crypto suite configured (AES-128 / SHA-256 / Group14)." -ForegroundColor Green
    } catch {
        Set-VpnConnectionIPsecConfiguration -ConnectionName $VpnName -Revert -Force -ErrorAction SilentlyContinue | Out-Null
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

export async function downloadPageHtml(user, links, settings) {
  return renderUserPortal(user, links, settings, {
    vpn: await getVpnProfileConfig(), baseUrl: config.publicBaseUrl,
    panelName: config.panelName,
  });
}
