#!/usr/bin/env python3
"""Restore a Telegram/local/GitHub full snapshot on a replacement Linux server."""
import argparse,getpass,gzip,hashlib,io,json,os,pathlib,re,secrets,shutil,subprocess,sys,tarfile,tempfile
import signal,time
from contextlib import contextmanager
from urllib.parse import urlparse,unquote
from importlib.util import spec_from_file_location,module_from_spec

def safe_extract(data, target):
    root=pathlib.Path(target).resolve()
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
        members=archive.getmembers()
        for member in members:
            path=root/member.name
            if not path.resolve().is_relative_to(root) or member.isdev() or member.isfifo():
                raise ValueError('Unsafe backup path')
            if member.issym() or member.islnk():
                link=(path.parent if member.issym() else root)/member.linkname
                if pathlib.Path(member.linkname).is_absolute() or not link.resolve().is_relative_to(root):
                    raise ValueError('Unsafe backup link')
        # Extract each path only after checking symlinks created by earlier members.
        for member in members:
            if not (root/member.name).resolve().is_relative_to(root): raise ValueError('Unsafe backup path')
            archive.extract(member,root)

def verify_snapshot(root):
    root=pathlib.Path(root)
    manifest=json.loads((root/'manifest.json').read_text())
    if manifest.get('format') != 'zvpn-full-backup' or manifest.get('formatVersion') != 1:
        raise ValueError('Unsupported full backup')
    for name,digest in manifest['checksums'].items():
        file=(root/name).resolve()
        if not file.is_relative_to(root.resolve()) or hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise ValueError('Backup integrity failure: '+name)
    for name in ('panel.env','database.sql.gz','ipsec.conf','ipsec.secrets',
                 'ipsec.d/cacerts/ikev2-ca-cert.pem','ipsec.d/private/ikev2-ca-key.pem',
                 'ipsec.d/certs/ikev2-server-cert.pem','ipsec.d/private/ikev2-server-key.pem'):
        if name not in manifest['checksums']: raise ValueError('Incomplete full backup: '+name)
    relay=root/'warp-policy/ike-relay.json'
    if (root/'firefox-account/account.enc').is_file() and 'warp-policy/firefox.key' not in manifest['checksums']:
        raise ValueError('Firefox backup missing encryption key')
    route=root/'warp-policy/warp.json'
    if route.is_file():
        policy=json.loads(route.read_text())
        if policy.get('enabled') and policy.get('provider') == 'psiphon' and 'warp-policy/psiphon.json' not in manifest['checksums']:
            raise ValueError('Incomplete Psiphon backup')
        if policy.get('enabled') and policy.get('provider') == 'firefox':
            for name in ('warp-policy/firefox.key', 'firefox-account/account.enc'):
                if name not in manifest['checksums']: raise ValueError('Incomplete Firefox backup')
    if relay.is_file() and json.loads(relay.read_text()).get('enabled'):
        for name in ('ipsec.d/zvpn-ike-relay.conf','ipsec.d/certs/zvpn-ike-relay-cert.pem'):
            if name not in manifest['checksums']:
                raise ValueError('Incomplete relay backup: '+name)
    return manifest

def decrypt_backup(data,password):
    if not data.startswith(b'ZVPNENC1'): return data
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt,iv,tag=data[8:24],data[24:36],data[36:52]
    key=hashlib.scrypt(password.encode(),salt=salt,n=16384,r=8,p=1,dklen=32)
    return AESGCM(key).decrypt(iv,data[52:]+tag,None)

def run(args,**kw):
    return subprocess.run(args,check=True,**kw)

POSTGRES = ['runuser', '-u', 'postgres', '--']
PSQL = POSTGRES + ['psql', '-X', '-p', '5432', '-v', 'ON_ERROR_STOP=1']


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def compatible_dump(dump, server_version):
    if server_version >= 170000:
        return dump
    # Only remove pg_dump's session setting from its header. A COPY row or
    # function body containing the same text must remain byte-for-byte intact.
    preamble = re.match(
        rb'\A--\r?\n-- PostgreSQL database dump\r?\n'
        rb'(?:(?:--[^\n]*|\\restrict [A-Za-z0-9]+|\r?)\r?\n)*'
        rb'SET statement_timeout = 0;\r?\n'
        rb'SET lock_timeout = 0;\r?\n'
        rb'SET idle_in_transaction_session_timeout = 0;\r?\n'
        rb'(SET transaction_timeout = 0;\r?\n)', dump)
    if not preamble:
        return dump
    start, end = preamble.span(1)
    return dump[:start] + dump[end:]


def postgres_sql(sql, database='postgres', **kwargs):
    return run(PSQL + ['-d', database], input=sql, **kwargs)


@contextmanager
def stage_database(root, username, dbname):
    # Refuse identifiers PostgreSQL would truncate, including into a system name.
    if not dbname or len(dbname.encode()) > 63 or dbname in ('postgres', 'template0', 'template1'):
        raise ValueError('Invalid or reserved PostgreSQL database name')
    dump = gzip.decompress((root/'database.sql.gz').read_bytes())
    version = int(run(PSQL + ['-d', 'postgres', '-Atc', 'SHOW server_version_num'],
                      stdout=subprocess.PIPE).stdout.strip())
    sql = f"SET standard_conforming_strings = on; SELECT EXISTS (SELECT FROM pg_roles WHERE rolname={literal(username)});"
    exists = run(PSQL + ['-d', 'postgres', '-qAtc', sql], stdout=subprocess.PIPE).stdout.strip()
    if exists == b'f':
        postgres_sql(f'CREATE ROLE {identifier(username)} LOGIN;'.encode(), stdout=subprocess.DEVNULL)
    candidate = 'zvpn_import_' + secrets.token_hex(8)
    run(POSTGRES + ['createdb', '-p', '5432', '--template=template0', '--owner', username, '--', candidate])
    try:
        try:
            postgres_sql(
                f'BEGIN;\nSET ROLE {identifier(username)};\n'.encode()
                + compatible_dump(dump, version) + b'\nCOMMIT;\n',
                candidate, stdout=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            raise ValueError(
                f'Backup SQL is incompatible with destination PostgreSQL {version // 10000}, '
                'or the import failed. The existing database was not replaced. '
                'Review the PostgreSQL error above; a newer PostgreSQL may be required.'
            ) from None
        yield candidate
    finally:
        # After a successful swap the temporary name no longer exists.
        subprocess.run(POSTGRES + ['dropdb', '-p', '5432', '--if-exists', '--', candidate],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def activate_database(candidate, dbname, username, password):
    old = 'zvpn_previous_' + secrets.token_hex(8)
    sql = rf"""
BEGIN;
SET LOCAL standard_conforming_strings = on;
SELECT EXISTS (SELECT FROM pg_database WHERE datname={literal(dbname)}) AS has_previous \gset
\if :has_previous
ALTER DATABASE {identifier(dbname)} RENAME TO {identifier(old)};
ALTER DATABASE {identifier(old)} ALLOW_CONNECTIONS false;
\endif
ALTER DATABASE {identifier(candidate)} RENAME TO {identifier(dbname)};
ALTER ROLE {identifier(username)} WITH PASSWORD {literal(password)};
COMMIT;
"""
    postgres_sql(sql.encode(), stdout=subprocess.DEVNULL)
    print(f'Database import activated. Previous database, if present, retained as {old}.', flush=True)


def stop_legacy_panel(app):
    """Stop only the root backend started by the old upgrade fallback."""
    backend = (pathlib.Path(app)/'backend').resolve()

    def matches(process):
        try:
            if process.stat().st_uid != 0 or (process/'cwd').readlink() != backend:
                return False
            args = (process/'cmdline').read_bytes().rstrip(b'\x00').split(b'\x00')
            return len(args) == 2 and args[0].rsplit(b'/', 1)[-1] == b'node' and args[1] == b'src/server.js'
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            return False

    pending = []
    for process in pathlib.Path('/proc').iterdir():
        if process.name.isdecimal() and matches(process):
            try:
                os.kill(int(process.name), signal.SIGTERM)
                pending.append(process)
            except ProcessLookupError:
                pass
    for _ in range(20):
        pending = [process for process in pending if matches(process)]
        if not pending:
            return
        time.sleep(0.25)
    raise ValueError('The manually started ZVPN backend did not stop. Stop it before retrying.')


def copy_tree(source,destination):
    source,destination=pathlib.Path(source),pathlib.Path(destination)
    if source.is_symlink():
        if destination.is_dir() and not destination.is_symlink():
            raise ValueError('Refusing to replace directory with symlink: '+str(destination))
        if destination.exists() or destination.is_symlink(): destination.unlink()
        destination.parent.mkdir(parents=True,exist_ok=True)
        destination.symlink_to(os.readlink(source))
    elif source.is_dir():
        if destination.is_symlink(): destination.unlink()
        destination.mkdir(parents=True,exist_ok=True)
        for child in source.iterdir(): copy_tree(child,destination/child.name)
        shutil.copystat(source,destination)
    elif source.is_file():
        # Do not follow a destination symlink while overwriting a regular file.
        if destination.is_symlink(): destination.unlink()
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source,destination)

def apply_network_optimizations(app):
    for name in ('optimize-speed.sh', 'optimize-instagram.sh'):
        script=pathlib.Path(app)/'ops'/name
        if script.is_file():
            print('Applying network optimization: '+name,flush=True)
            run(['bash',str(script)])
        else:
            print('Warning: snapshot lacks optional network optimizer '+name,flush=True)


def prepare_application_source(source):
    # Older backups created these wrapper directories under a root-only umask.
    # rsync/copy_tree preserve their modes, but the installed app needs to be
    # accessible to PostgreSQL, nginx and the unprivileged panel user.
    for directory in (source, source/'backend', source/'frontend'):
        if directory.is_dir():
            if directory.is_symlink():
                raise ValueError('Invalid application source directory: '+directory.name)
            directory.chmod(0o755)


def restore(root):
    root=pathlib.Path(root)
    app=pathlib.Path('/opt/zvpn-panel/app')
    source=root/'app-source'
    if not (source/'install.sh').is_file(): raise ValueError('Backup lacks installation source')
    prepare_application_source(source)
    run(['systemctl','show','--property=Version','--value'],stdout=subprocess.DEVNULL)
    # Import the env parser without running the backup executable.
    spec=spec_from_file_location('snapshot',source/'ops/full-backup.py'); module=module_from_spec(spec);spec.loader.exec_module(module)
    text=(root/'panel.env').read_text()
    database=urlparse(module.env_value(text,'DATABASE_URL'))
    if database.hostname not in ('127.0.0.1','localhost') or database.port not in (None,5432):
        raise ValueError('Automatic restore requires a local PostgreSQL database')
    username,password,dbname=unquote(database.username or ''),unquote(database.password or ''),unquote(database.path[1:])
    if not username or len(username.encode()) > 63 or username == 'postgres':
        raise ValueError('Automatic restore requires a dedicated panel PostgreSQL role')
    if not dbname or len(dbname.encode()) > 63 or dbname in ('postgres','template0','template1'):
        raise ValueError('Invalid or reserved PostgreSQL database name')
    domain=urlparse(module.env_value(text,'PUBLIC_BASE_URL')).hostname
    installed = (pathlib.Path('/usr/local/sbin/zvpn-helper').is_file()
                 and pathlib.Path('/etc/systemd/system/zvpn-panel.service').is_file()
                 and (app/'backend/node_modules/pg/package.json').is_file()
                 and (app/'frontend/dist/index.html').is_file())
    if not shutil.which('node') or not shutil.which('nginx') or not shutil.which('psql') or not installed:
        env=os.environ.copy();env.update(ZVPN_NON_INTERACTIVE='1',ZVPN_DOMAIN=domain,
            ZVPN_DB_NAME=dbname,ZVPN_DB_USER=username)
        run(['bash',str(source/'install.sh')],env=env,umask=0o022)
    with stage_database(root, username, dbname) as candidate:
        # The import has succeeded before overwriting files or stopping services
        # on an installed destination.
        copy_tree(source,app)
        apply_network_optimizations(app)
        run(['systemctl','stop','zvpn-panel','strongswan-starter'])
        stop_legacy_panel(app)
        subprocess.run(['systemctl','stop','xray'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        subprocess.run(['systemctl','stop','zvpn-warp-router','warp-svc','zvpn-firefox'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        activate_database(candidate, dbname, username, password)
    shutil.copy2(root/'panel.env',app/'backend/.env')
    run(['chown','zvpn:zvpn',str(app/'backend/.env')]);os.chmod(app/'backend/.env',0o600)
    for name,destination in [('ipsec.d','/etc/ipsec.d'),('letsencrypt','/etc/letsencrypt'),
                             ('nginx','/etc/nginx'),('xray','/usr/local/etc/xray'),
                             ('runtime','/opt/zvpn-panel/runtime'),('systemd','/etc/systemd/system')]:
        copy_tree(root/name,destination)
    copy_tree(root/'legacy-public','/opt/zvpn-panel/backend/public')
    # Relay state is independent of whether WARP was installed on the source.
    if (root/'firefox-account/account.enc').is_file():
        copy_tree(root/'firefox-account','/var/lib/zvpn-panel/firefox')
        copy_tree(root/'warp-policy/firefox.key','/etc/zvpn/firefox.key')
    else:
        # Replacing an installation must not retain the destination's previous account.
        for name in ('account.enc', 'account.enc.tmp'):
            (pathlib.Path('/var/lib/zvpn-panel/firefox')/name).unlink(missing_ok=True)
    if (root/'warp-policy/ike-relay.json').is_file():
        copy_tree(root/'warp-policy/ike-relay.json','/etc/zvpn/ike-relay.json')
    # Optional WARP state is present only on servers where it was installed.
    # Copy before install-xray so its conditional installer recreates the proxy.
    # Never restore captured firewall rules or process counter cursors as live rules.
    if (root/'warp-policy/warp.json').is_file():
        copy_tree(root/'warp-policy','/etc/zvpn')
        for name,destination in [('warp-registration','/var/lib/cloudflare-warp'), ('warp-usage','/var/lib/zvpn-panel/warp')]:
            if (root/name).is_dir(): copy_tree(root/name,destination)
        state=pathlib.Path('/var/lib/zvpn-panel/warp')
        for name in ('rules.json','daemon.lock','status.json'):
            (state/name).unlink(missing_ok=True)
        usage=state/'usage.json'
        if usage.exists():
            data=json.loads(usage.read_text());data.pop('cursor',None)
            usage.write_text(json.dumps(data));os.chmod(usage,0o600)
    else:
        pathlib.Path('/etc/zvpn/warp.json').unlink(missing_ok=True)
        subprocess.run(['systemctl','disable','zvpn-warp-router'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for name in ('ipsec.conf','ipsec.secrets'): shutil.copy2(root/name,pathlib.Path('/etc')/name)
    # Never issue replacement certificates during restoration.
    for name in ('ipsec.d/cacerts/ikev2-ca-cert.pem','ipsec.d/certs/ikev2-server-cert.pem',
                 'ipsec.d/private/ikev2-ca-key.pem','ipsec.d/private/ikev2-server-key.pem'):
        assert hashlib.sha256((pathlib.Path('/etc')/name).read_bytes()).hexdigest() == hashlib.sha256((root/name).read_bytes()).hexdigest()
    run(['chown','-R','zvpn:zvpn','/opt/zvpn-panel/runtime'])
    run(['chmod','-R','go-rwx','/opt/zvpn-panel/runtime'])
    # Install root-owned helpers and the recorded version of Xray before panel sync.
    run(['install','-o','root','-g','root','-m','755',str(app/'ops/helper/zvpn-helper'),'/usr/local/sbin/zvpn-helper'])
    run(['bash',str(app/'ops/install-xray.sh')])
    run(['bash',str(app/'ops/install-helper-permissions.sh')])
    run(['npm','ci','--omit=dev','--ignore-scripts'],cwd=app/'backend',umask=0o022)
    run(['nginx','-t']);run(['systemctl','daemon-reload'])
    # Only restore the extra direct port on servers that had explicitly enabled it.
    if (root/'systemd/zvpn-ike-direct-port.service').is_file():
        run(['systemctl','enable','--now','zvpn-ike-direct-port.service'])
    run(['systemctl','restart','strongswan-starter','zvpn-panel','nginx'])
    run(['systemctl','enable','strongswan-starter','zvpn-panel','xray','nginx'])
    if (root/'warp-policy/warp.json').is_file():
        run(['systemctl','start','zvpn-warp-router'])
    run(['bash',str(app/'doctor.sh')])
    enabled = run(PSQL + ['-d', dbname, '-Atc',
        "SELECT COALESCE((SELECT value->>'enabled' FROM panel_settings WHERE key='xray'), 'true')"],
        stdout=subprocess.PIPE).stdout.strip() != b'false'
    health_checks = [
        ['systemctl', 'is-active', '--quiet', service]
        for service in ('strongswan-starter', 'zvpn-panel', 'nginx', *(['xray'] if enabled else []))
    ]
    health_checks.append(['curl', '-fsS', '--max-time', '4', 'http://127.0.0.1:3300/api/health'])
    if enabled:
        health_checks.append(['/usr/local/bin/xray', 'api', 'statsquery',
                              '--server=127.0.0.1:10086', '-pattern', 'user>>>'])
    for attempt in range(10):
        if all(subprocess.run(check, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
               for check in health_checks):
            break
        time.sleep(2)
    else:
        raise ValueError('Database restored, but destination services did not become healthy. '
                         'Check zvpn-panel, xray and strongswan-starter logs before changing DNS.')
    print('Restore complete. Existing certificates and account identities preserved. Update DNS to this server.')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('archives',nargs='+')
    parser.add_argument('--verify-only',action='store_true')
    parser.add_argument('--yes',action='store_true')
    args=parser.parse_args()
    data=b''.join(pathlib.Path(name).read_bytes() for name in sorted(args.archives))
    if data.startswith(b'ZVPNENC1'): data=decrypt_backup(data,getpass.getpass('Backup passphrase: '))
    with tempfile.TemporaryDirectory(prefix='zvpn-restore-') as work:
        safe_extract(data,work);verify_snapshot(work)
        print('Full backup integrity verified.')
        if args.verify_only: return
        if os.geteuid() != 0: raise ValueError('Root access required')
        if not args.yes and input('Replace local panel/database with this backup? Type RESTORE: ') != 'RESTORE': return
        restore(work)

if __name__ == '__main__': main()
