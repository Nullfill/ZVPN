# ZVPN Production Deployment Guide

## System Requirements
- **Operating System**: Ubuntu 20.04 / 22.04 / 24.04 LTS or Debian 11 / 12
- **Memory**: Minimum 1 GB RAM (2 GB recommended)
- **Disk**: 10 GB SSD
- **Ports Required**:
  - `UDP 500`: IKE (Internet Key Exchange)
  - `UDP 4500`: IPsec NAT-Traversal
  - `TCP 80 / 443`: HTTP/HTTPS Panel Web Interface

---

## 1. Fresh Installation

### Step 1: Clone or Download Release Package
```bash
git clone https://github.com/your-org/zvpn-panel.git /tmp/zvpn-release
cd /tmp/zvpn-release
```

### Step 2: Run Installer as Root
```bash
sudo bash install.sh
```

The script will automatically:
1. Check and install system packages (`nodejs`, `postgresql`, `strongswan`, `nginx`, `rsync`, `curl`).
2. Create system user `zvpn`.
3. Configure PostgreSQL database with a secure random password.
4. Generate `.env` with strong `JWT_SECRET` and `MASTER_KEY`.
5. Install and build frontend and backend.
6. Configure systemd service `zvpn-panel.service`.
7. Configure sudoers with restricted `/usr/local/sbin/zvpn-helper`.
8. Enable and start all services.

---

## 2. Setting Up SSL/TLS (HTTPS)

### Using Certbot for Let's Encrypt
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d panel.yourdomain.com
```

Certbot will automatically update the Nginx configuration located at `/etc/nginx/sites-available/zvpn-panel`.

---

## 3. Upgrading ZVPN

To upgrade an existing installation without losing any data or active client configurations:

```bash
cd /path/to/new-release
sudo bash upgrade.sh
```

The upgrade script:
- Creates an automatic pre-upgrade full backup.
- Applies pending database migrations.
- Updates helper scripts and sudoers permissions.
- Installs updated Node dependencies and rebuilds frontend.
- Restarts strongSwan and the panel with zero downtime for users.
