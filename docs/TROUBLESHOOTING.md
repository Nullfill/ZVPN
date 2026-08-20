# ZVPN Troubleshooting & Diagnosis Guide

## 1. Checking Service Status
```bash
# Check ZVPN Web Panel service
sudo systemctl status zvpn-panel

# Check strongSwan service
sudo systemctl status strongswan-starter

# View real-time panel logs
sudo journalctl -u zvpn-panel -f

# View real-time strongSwan logs
sudo journalctl -u strongswan-starter -f
```

---

## 2. Common IKEv2 Issues

### Issue: "Server Unreachable" / "Policy Match Error" (Error 809 / Error 87 on Windows)
1. Ensure UDP ports 500 and 4500 are not blocked by cloud firewalls (AWS Security Groups, Hetzner, DigitalOcean Firewall, UFW).
   ```bash
   sudo ufw allow 500/udp
   sudo ufw allow 4500/udp
   ```
2. Enable NAT-T AssumeUDPEncapsulationContextOnSendRule on Windows clients behind NAT:
   ```powershell
   Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\PolicyAgent" -Name "AssumeUDPEncapsulationContextOnSendRule" -Value 2 -Type DWord
   ```

### Issue: "Certificate CN Mismatch" (Error 13801 on Windows)
- The VPN server address configured on the client MUST match either the `CN` (Common Name) or `SAN` (Subject Alternative Name) of the server certificate.
- Use the **VPN Server & Domain Wizard** in Admin Settings (`Admin → Settings → Domain & Server`) to automatically reissue the certificate or configure `leftid`.

### Issue: Stale Sessions or Duplicate Session Reconnection
- ZVPN features an automated stateful reconciler with a default 45-second grace period.
- If clients frequently roam across Wi-Fi and 4G, strongSwan automatically updates the IPsec SA via MOBIKE without dropping the connection.
- Check live sessions in `Admin → VPN Sessions` or via CLI:
  ```bash
  sudo swanctl --list-sas
  ```

---

## 3. Running Panel Diagnostics
Run the built-in doctor script to diagnose configuration, permissions, and database health:
```bash
sudo /opt/zvpn-panel/app/doctor.sh
```
