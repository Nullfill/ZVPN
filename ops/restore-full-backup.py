#!/usr/bin/env python3
"""Restore a Telegram/local/GitHub full snapshot on a replacement Linux server."""
import argparse,getpass,gzip,hashlib,io,json,os,pathlib,shutil,subprocess,sys,tarfile,tempfile
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
    return manifest

def decrypt_backup(data,password):
    if not data.startswith(b'ZVPNENC1'): return data
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt,iv,tag=data[8:24],data[24:36],data[36:52]
    key=hashlib.scrypt(password.encode(),salt=salt,n=16384,r=8,p=1,dklen=32)
    return AESGCM(key).decrypt(iv,data[52:]+tag,None)

def run(args,**kw):
    return subprocess.run(args,check=True,**kw)

def copy_tree(source,destination):
    if source.exists():
        pathlib.Path(destination).mkdir(parents=True,exist_ok=True)
        shutil.copytree(source,destination,symlinks=True,dirs_exist_ok=True)

def restore(root):
    root=pathlib.Path(root)
    app=pathlib.Path('/opt/zvpn-panel/app')
    # The snapshot carries the exact release source, not whatever main contains later.
    copy_tree(root/'app-source',app)
    if not (app/'install.sh').is_file(): raise ValueError('Backup lacks installation source')
    # Import the env parser without running the backup executable.
    spec=spec_from_file_location('snapshot',app/'ops/full-backup.py'); module=module_from_spec(spec);spec.loader.exec_module(module)
    text=(root/'panel.env').read_text()
    database=urlparse(module.env_value(text,'DATABASE_URL'))
    if database.hostname not in ('127.0.0.1','localhost') or database.port not in (None,5432):
        raise ValueError('Automatic restore requires a local PostgreSQL database')
    username,password,dbname=unquote(database.username),unquote(database.password),unquote(database.path[1:])
    domain=urlparse(module.env_value(text,'PUBLIC_BASE_URL')).hostname
    if not shutil.which('node') or not shutil.which('nginx') or not shutil.which('psql') or not pathlib.Path('/usr/local/sbin/zvpn-helper').exists():
        env=os.environ.copy();env.update(ZVPN_NON_INTERACTIVE='1',ZVPN_DOMAIN=domain,
            ZVPN_DB_NAME=dbname,ZVPN_DB_USER=username)
        run(['bash',str(app/'install.sh')],env=env)
    run(['systemctl','stop','zvpn-panel','strongswan-starter'])
    subprocess.run(['systemctl','stop','xray'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    shutil.copy2(root/'panel.env',app/'backend/.env')
    run(['chown','zvpn:zvpn',str(app/'backend/.env')]);os.chmod(app/'backend/.env',0o600)
    ident=lambda value:'"'+value.replace('"','""')+'"'
    literal=lambda value:"'"+value.replace("'","''")+"'"
    sql=f"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname={literal(username)}) THEN CREATE ROLE {ident(username)} LOGIN; END IF; END $$; ALTER ROLE {ident(username)} WITH PASSWORD {literal(password)};"
    run(['runuser','-u','postgres','--','psql','-v','ON_ERROR_STOP=1'],input=sql.encode(),stdout=subprocess.DEVNULL)
    exists=subprocess.check_output(['runuser','-u','postgres','--','psql','-tAc',f'SELECT 1 FROM pg_database WHERE datname={literal(dbname)}']).strip()
    if exists != b'1': run(['runuser','-u','postgres','--','createdb','--owner',username,dbname])
    run(['runuser','-u','postgres','--','psql','-d',dbname,'-v','ON_ERROR_STOP=1'],
        input=(f'SET ROLE {ident(username)};\n'.encode()+gzip.decompress((root/'database.sql.gz').read_bytes())),stdout=subprocess.DEVNULL)
    for name,destination in [('ipsec.d','/etc/ipsec.d'),('letsencrypt','/etc/letsencrypt'),
                             ('nginx','/etc/nginx'),('xray','/usr/local/etc/xray'),
                             ('runtime','/opt/zvpn-panel/runtime'),('systemd','/etc/systemd/system')]:
        copy_tree(root/name,destination)
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
    run(['npm','ci','--omit=dev','--ignore-scripts'],cwd=app/'backend')
    run(['nginx','-t']);run(['systemctl','daemon-reload'])
    run(['systemctl','restart','strongswan-starter','zvpn-panel','nginx'])
    run(['systemctl','enable','strongswan-starter','zvpn-panel','xray','nginx'])
    run(['bash',str(app/'doctor.sh')])
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
