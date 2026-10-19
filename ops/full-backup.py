#!/usr/bin/env python3
"""Root-only, byte-preserving disaster recovery snapshot; stdout is an archive."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile

APP = Path('/opt/zvpn-panel/app')

def env_value(text, name):
    for line in text.splitlines():
        if line.startswith(name + '='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise RuntimeError('Required configuration missing: ' + name)

def collect(destination):
    destination = Path(destination)
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    env = APP / 'backend/.env'
    # Never produce a green "complete" backup with missing private keys.
    required = [env, Path('/etc/ipsec.conf'), Path('/etc/ipsec.secrets'),
                Path('/etc/ipsec.d/cacerts/ikev2-ca-cert.pem'),
                Path('/etc/ipsec.d/private/ikev2-ca-key.pem'),
                Path('/etc/ipsec.d/certs/ikev2-server-cert.pem'),
                Path('/etc/ipsec.d/private/ikev2-server-key.pem')]
    for file in required:
        if not file.is_file() or not os.access(file, os.R_OK):
            raise RuntimeError('Incomplete backup: required file unavailable: ' + str(file))
    sources = {
        'panel.env': env,
        'ipsec.conf': Path('/etc/ipsec.conf'), 'ipsec.secrets': Path('/etc/ipsec.secrets'),
        'ipsec.d': Path('/etc/ipsec.d'), 'letsencrypt': Path('/etc/letsencrypt'),
        'nginx': Path('/etc/nginx'), 'xray': Path('/usr/local/etc/xray'),
        'runtime': Path('/opt/zvpn-panel/runtime'),
        'legacy-public': Path('/opt/zvpn-panel/backend/public'),
        'warp-policy': Path('/etc/zvpn'),
        'warp-usage': Path('/var/lib/zvpn-panel/warp'),
    }
    if env_value(env.read_text(), 'PUBLIC_BASE_URL').startswith('https://'):
        tls = Path('/etc/letsencrypt/live')
        if not tls.exists() or not any(tls.glob('*/privkey.pem')):
            raise RuntimeError('Incomplete backup: HTTPS certificate/private key unavailable')
    for name, source in sources.items():
        target = destination / name
        if source.is_dir():
            shutil.copytree(source, target, symlinks=True, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns('*.tmp', '*.log', 'endpoint-backups', 'webview'))
            # Nginx sites-enabled often uses absolute links. Make links relative
            # inside the archive so restoration never follows /etc on extraction.
            for link in target.rglob('*'):
                if link.is_symlink():
                    resolved=(source/link.relative_to(target)).resolve()
                    if not resolved.is_relative_to(source.resolve()):
                        # Distro Nginx modules-enabled points into /usr/share.
                        # Copy the referenced configuration rather than an unsafe link.
                        if name == 'nginx' and resolved.is_file():
                            link.unlink();shutil.copy2(resolved,link);continue
                        raise RuntimeError('Backup link points outside its directory: '+str(link))
                    relative=os.path.relpath(target/resolved.relative_to(source.resolve()),link.parent)
                    link.unlink();link.symlink_to(relative)
        elif source.is_file():
            shutil.copy2(source, target)
    if Path('/etc/zvpn/warp.json').is_file():
        registration = Path('/var/lib/cloudflare-warp')
        if json.loads(Path('/etc/zvpn/warp.json').read_text()).get('enabled') and not (registration/'reg.json').is_file():
            raise RuntimeError('Incomplete backup: WARP registration unavailable')
        target = destination/'warp-registration'; target.mkdir(mode=0o700, exist_ok=True)
        for name in ('reg.json', 'settings.json', 'conf.json', 'warp.db'):
            source = registration/name
            if not source.is_file(): continue
            if name.endswith('.db') and source.read_bytes()[:16] == b'SQLite format 3\x00':
                # Include committed WAL content without stopping active users.
                with sqlite3.connect('file:'+str(source)+'?mode=ro', uri=True) as db:
                    with sqlite3.connect(target/name) as output: db.backup(output)
                os.chmod(target/name,0o600)
            else: shutil.copy2(source,target/name)
    systemd = destination / 'systemd'; systemd.mkdir(exist_ok=True)
    for name in ('zvpn-panel.service', 'xray.service', 'zvpn-warp-router.service'):
        src = Path('/etc/systemd/system') / name
        if src.is_file(): shutil.copy2(src, systemd / name)
        dropins = Path('/etc/systemd/system') / (name + '.d')
        if dropins.is_dir(): shutil.copytree(dropins, systemd / (name + '.d'), symlinks=True, dirs_exist_ok=True)
    # Source required for restoration if the release branch later changes.
    for name in ('backend/src', 'backend/scripts', 'backend/public', 'frontend/dist', 'ops', 'backend/package.json',
                 'backend/package-lock.json', 'frontend/package.json','frontend/package-lock.json',
                 'frontend/src','frontend/index.html','frontend/vite.config.ts','frontend/tsconfig.json',
                 'frontend/tailwind.config.js','frontend/postcss.config.js',
                 'install.sh', 'upgrade.sh', 'doctor.sh','VERSION'):
        src = APP / name; dst = destination / 'app-source' / name
        if src.is_dir(): shutil.copytree(src, dst, symlinks=True, dirs_exist_ok=True)
        elif src.is_file(): dst.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(src, dst)
    with (destination / 'database.sql.gz').open('wb') as output:
        dump = subprocess.Popen(['pg_dump', env_value(env.read_text(), 'DATABASE_URL'), '--clean', '--if-exists', '--no-owner', '--no-privileges'], stdout=subprocess.PIPE)
        try:
            gzip = subprocess.run(['gzip', '-9'], stdin=dump.stdout, stdout=output, check=True)
        finally:
            dump.stdout.close()
        if dump.wait() != 0: raise RuntimeError('Database dump failed')
    checksums = {}
    for file in sorted(destination.rglob('*')):
        if file.is_file() and not file.is_symlink():
            checksums[str(file.relative_to(destination))] = hashlib.sha256(file.read_bytes()).hexdigest()
    manifest = {'format': 'zvpn-full-backup', 'formatVersion': 1, 'checksums': checksums}
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2))

def main():
    if os.geteuid() != 0: raise RuntimeError('Root access required')
    parser = argparse.ArgumentParser()
    parser.add_argument('--collect', help='Populate the local root-only backup directory')
    args = parser.parse_args()
    if args.collect:
        collect(args.collect); return
    with tempfile.TemporaryDirectory(prefix='zvpn-backup-') as work:
        collect(work)
        with tarfile.open(fileobj=sys.stdout.buffer, mode='w|gz') as archive:
            for file in sorted(Path(work).iterdir()): archive.add(file, arcname=file.name)

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('Full backup failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
