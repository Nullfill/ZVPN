# ZVPN Security & Hardening Guide

## Security Model

### 1. Privilege Separation
The ZVPN web panel backend runs as the dedicated, unprivileged system user `zvpn`. It does not run as `root`.
All operations that require superuser privileges (modifying `/etc/ipsec.conf`, reading/writing strongSwan secrets, terminating IKE_SAs) are executed via `/usr/local/sbin/zvpn-helper`.

### 2. Sudoers Whitelisting
The `/etc/sudoers.d/zvpn-panel` configuration permits only exact commands:
```sudoers
zvpn ALL=(root) NOPASSWD: \
  /usr/local/sbin/zvpn-helper sync-secrets, \
  /usr/local/sbin/zvpn-helper reread-secrets, \
  /usr/local/sbin/zvpn-helper list-sas, \
  /usr/local/sbin/zvpn-helper terminate *, \
  /usr/local/sbin/zvpn-helper status, \
  /usr/local/sbin/zvpn-helper cert-info, \
  /usr/local/sbin/zvpn-helper resolve-host *, \
  /usr/local/sbin/zvpn-helper check-ike-ports, \
  /usr/local/sbin/zvpn-helper endpoint-backup, \
  /usr/local/sbin/zvpn-helper endpoint-rollback /var/lib/zvpn-panel/endpoint-backups/*, \
  /usr/local/sbin/zvpn-helper issue-server-cert *, \
  /usr/local/sbin/zvpn-helper set-leftid *, \
  /usr/local/sbin/zvpn-helper normalize-conn, \
  /usr/local/sbin/zvpn-helper restart-strongswan
```

### 3. Sudo Helper Defense in Depth
- **Path Traversal Guards**: Every file or directory path is checked using `realpath -e` and must strictly reside below the expected directory.
- **Input Whitelisting**: IDs and endpoints are validated against strict alphanumeric and IP/Domain regular expressions (`/^[A-Za-z0-9_.-]+$/`).
- **File Permissions**: Secret files are created with `0600` permissions (read/write only by `zvpn` or `root`).

### 4. Cryptographic Storage
- VPN passwords and private credentials in the database are encrypted with `AES-256-GCM`.
- Admin passwords are never stored in plaintext and are hashed using bcrypt with salt rounds >= 12.
- JWT tokens are signed using HMAC-SHA256 and validated against the `admin_sessions` table for immediate revocation support.
