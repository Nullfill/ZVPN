# ZVPN - Windows IKEv2 Policy Match Fix
# Applies AES128/SHA256/ECP256 to an existing Windows IKEv2 VPN profile.
$ErrorActionPreference = 'Stop'
Import-Module VpnClient

$all = @(Get-VpnConnection -ErrorAction SilentlyContinue) + @(Get-VpnConnection -AllUserConnection -ErrorAction SilentlyContinue)
$ike = @($all | Where-Object { $_.TunnelType -eq 'Ikev2' })

if (-not $ike.Count) {
    Write-Host 'No IKEv2 VPN profile was found.' -ForegroundColor Red
    Read-Host 'Press Enter to close' | Out-Null
    exit 1
}

if ($ike.Count -eq 1) {
    $name = $ike[0].Name
} else {
    Write-Host 'IKEv2 profiles:' -ForegroundColor Cyan
    $ike | ForEach-Object { Write-Host (' - ' + $_.Name) }
    $name = Read-Host 'Enter the exact VPN profile name'
}

$global = Get-VpnConnection -Name $name -AllUserConnection -ErrorAction SilentlyContinue
$params = @{
    ConnectionName = $name
    AuthenticationTransformConstants = 'SHA256128'
    CipherTransformConstants = 'AES128'
    EncryptionMethod = 'AES128'
    IntegrityCheckMethod = 'SHA256'
    PfsGroup = 'None'
    DHGroup = 'ECP256'
    Force = $true
}
if ($global) { $params.AllUserConnection = $true }

Set-VpnConnectionIPsecConfiguration @params | Out-Null
Write-Host ('Policy updated successfully for: ' + $name) -ForegroundColor Green
Write-Host 'Try connecting again.' -ForegroundColor Green
Read-Host 'Press Enter to close' | Out-Null
