#!/usr/bin/env python3
"""Add/remove one IKE identity without restarting production strongSwan."""
import fcntl
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import tempfile
import time

RUNTIME = Path('/opt/zvpn-panel/runtime')
MAIN = Path('/etc/ipsec.conf')
CONNECTION = Path('/etc/ipsec.d/zvpn-ike-relay.conf')
CERT = Path('/etc/ipsec.d/certs/zvpn-ike-relay-cert.pem')
STATE = Path('/etc/zvpn/ike-relay.json')
CA = Path('/etc/ipsec.d/cacerts/ikev2-ca-cert.pem')
CA_KEY = Path('/etc/ipsec.d/private/ikev2-ca-key.pem')
KEY = Path('/etc/ipsec.d/private/ikev2-server-key.pem')
INCLUDE = 'include /etc/ipsec.d/zvpn-ike-relay.conf'
HOST = re.compile(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}')


def validate(value):
    if not isinstance(value, dict) or set(value) != {'enabled', 'hostname', 'port', 'outboundTag'}:
        raise ValueError('Invalid relay policy')
    if type(value['enabled']) is not bool or type(value['port']) is not int or not 1024 <= value['port'] <= 65535:
        raise ValueError('Invalid relay state/port')
    if not isinstance(value['hostname'], str) or (value['hostname'] and not HOST.fullmatch(value['hostname'])):
        raise ValueError('Invalid relay hostname')
    if value['enabled'] and not value['hostname']:
        raise ValueError('Relay hostname required')
    if not isinstance(value['outboundTag'], str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', value['outboundTag']):
        raise ValueError('Invalid outbound tag')
    return value


def read_policy():
    fd = os.open(RUNTIME / 'ike-relay.json', os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != pwd.getpwnam('zvpn').pw_uid or info.st_mode & 0o077 or info.st_size > 4096:
            raise ValueError('Unsafe relay policy file')
        with os.fdopen(fd, 'r') as stream:
            fd = None
            return validate(json.load(stream))
    finally:
        if fd is not None:
            os.close(fd)


def run(args):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=20).stdout


def write(file, data, mode=0o600):
    file.parent.mkdir(parents=True, exist_ok=True)
    if file.is_symlink():
        raise ValueError('Refusing managed symlink')
    fd, temporary = tempfile.mkstemp(prefix='.ike-relay-', dir=file.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data if isinstance(data, bytes) else data.encode())
        os.replace(temporary, file)
    finally:
        Path(temporary).unlink(missing_ok=True)


def certificate_matches(hostname):
    if not CERT.is_file() or CERT.is_symlink():
        return False
    try:
        run(['openssl', 'verify', '-CAfile', str(CA), str(CERT)])
        run(['openssl', 'x509', '-in', str(CERT), '-checkend', '604800', '-noout'])
        certificate_key = run(['openssl', 'x509', '-in', str(CERT), '-pubkey', '-noout']).strip()
        server_key = run(['openssl', 'pkey', '-in', str(KEY), '-pubout']).strip()
        if certificate_key != server_key:
            return False
        san = run(['openssl', 'x509', '-in', str(CERT), '-noout', '-ext', 'subjectAltName'])
        return 'DNS:' + hostname in [v.strip() for v in san.splitlines()[-1].split(',')]
    except subprocess.SubprocessError:
        return False


def issue_certificate(hostname):
    # Keep the existing CA and key, so existing installations and migrated backups
    # trust the relay too. The production certificate is never overwritten.
    with tempfile.TemporaryDirectory(prefix='zvpn-ike-cert-') as directory:
        root = Path(directory)
        extension = root / 'extensions'
        extension.write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n'
                             'extendedKeyUsage=serverAuth,1.3.6.1.5.5.8.2.2\nsubjectAltName=DNS:' + hostname +
                             '\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n')
        run(['openssl', 'req', '-new', '-key', str(KEY), '-subj', '/CN=' + hostname, '-out', str(root / 'request')])
        run(['openssl', 'x509', '-req', '-in', str(root / 'request'), '-CA', str(CA), '-CAkey', str(CA_KEY),
             '-set_serial', '0x' + os.urandom(16).hex(), '-days', '365', '-sha256', '-extfile', str(extension), '-out', str(root / 'certificate')])
        write(CERT, (root / 'certificate').read_bytes(), 0o644)


def connection_text(policy):
    if not policy['enabled']:
        return '# Managed by ZVPN: relay disabled.\n'
    return ('# Managed by ZVPN; production connection is inherited, not replaced.\n'
            'conn zvpn-ike-relay\n    also=ikev2-vpn\n    leftid=' + policy['hostname'] +
            '\n    leftcert=zvpn-ike-relay-cert.pem\n    mobike=no\n    auto=add\n')


def apply(policy):
    policy = validate(policy)
    # A rollback includes every file touched; no system-wide service restart.
    files = [MAIN, CONNECTION, CERT, STATE]
    legacy = Path('/etc/ipsec.d/ir-ike-test.conf')
    adopt_legacy = (legacy.is_file() and not legacy.is_symlink() and
                    'leftcert=ir-ike-test-cert.pem' in legacy.read_text() and
                    ('leftid=' + policy['hostname']) in legacy.read_text() and policy['hostname'])
    if adopt_legacy:
        files.append(legacy)
    before = {p: (p.read_bytes(), stat.S_IMODE(p.stat().st_mode)) if p.exists() else None for p in files}
    for p in files:
        if p.is_symlink():
            raise ValueError('Refusing managed symlink')
    try:
        if policy['enabled'] and not certificate_matches(policy['hostname']):
            issue_certificate(policy['hostname'])
        text = MAIN.read_text()
        if not re.search(r'^conn\s+ikev2-vpn\s*$', text, re.M):
            raise ValueError('Production connection missing')
        if INCLUDE not in text.splitlines():
            text = text.rstrip() + '\n\n' + INCLUDE + '\n'
        if adopt_legacy:
            text = re.sub(r'^include /etc/ipsec.d/ir-ike-test.conf\s*$', '', text, flags=re.M)
            write(legacy, '# Superseded by the managed ZVPN relay.\n')
        write(CONNECTION, connection_text(policy))
        if text != MAIN.read_text():
            write(MAIN, text, before[MAIN][1])
        run(['ipsec', 'update'])
        run(['ipsec', 'rereadall'])
        if policy['enabled']:
            # starter processes update asynchronously; allow the new identity
            # to appear before considering a fresh installation unsuccessful.
            for attempt in range(11):
                if 'zvpn-ike-relay:' in run(['ipsec', 'statusall']):
                    break
                if attempt == 10:
                    raise ValueError('Relay connection was not loaded')
                time.sleep(0.5)
        if not policy['enabled']:
            # Only this identity is terminated; native users stay connected.
            subprocess.run(['ipsec', 'down', 'zvpn-ike-relay'], capture_output=True, timeout=15)
            if adopt_legacy or (legacy.is_file() and legacy.read_text().startswith('# Superseded by the managed ZVPN relay.')):
                subprocess.run(['ipsec', 'down', 'ikev2-ir-test'], capture_output=True, timeout=15)
        write(STATE, json.dumps(policy))
        info = run(['openssl', 'x509', '-in', str(CERT), '-noout', '-enddate', '-fingerprint', '-sha256']) if policy['enabled'] else None
        status = {**policy, 'ready': bool(policy['enabled']), 'certificate': info, 'error': None}
        write(RUNTIME / 'ike-relay-status.json', json.dumps(status), 0o644)
        return status
    except Exception:
        for file, previous in before.items():
            if previous is None:
                file.unlink(missing_ok=True)
            else:
                write(file, previous[0], previous[1])
        try:
            run(['ipsec', 'update'])
            run(['ipsec', 'rereadall'])
        except subprocess.SubprocessError:
            pass
        raise


def main():
    if os.geteuid() != 0:
        raise PermissionError('Root access required')
    Path('/run/lock').mkdir(exist_ok=True)
    with open('/run/lock/zvpn-ike-relay.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        print(json.dumps(apply(read_policy())))


if __name__ == '__main__':
    main()
