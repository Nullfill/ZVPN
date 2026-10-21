import gzip,hashlib,importlib.util,io,json,os,pathlib,shutil,tarfile,tempfile,unittest
from unittest.mock import patch

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('restore',ROOT/'ops/restore-full-backup.py')
restore=importlib.util.module_from_spec(spec);spec.loader.exec_module(restore)

class FullBackupTests(unittest.TestCase):
    def test_relay_source_backup_excludes_cli_credentials_and_private_user_links(self):
        spec=importlib.util.spec_from_file_location('collector',ROOT/'ops/full-backup.py')
        collector=importlib.util.module_from_spec(spec);spec.loader.exec_module(collector)
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);app=root/'app';output=root/'backup'
            for name in ('netlify.toml', 'netlify/edge-functions/relay.js', '.netlify/state.json', '.env', 'private-user.txt', 'node_modules/token'):
                file=app/'deploy/netlify'/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('fixture')
            collector.copy_relay_source(app,output)
            copied={str(p.relative_to(output)).replace('\\','/') for p in output.rglob('*') if p.is_file()}
            self.assertEqual(copied, {'app-source/deploy/netlify/netlify.toml','app-source/deploy/netlify/netlify/edge-functions/relay.js'})

    @unittest.skipUnless(os.environ.get('TEST_DATABASE_URL') and shutil.which('pg_dump'), 'requires PostgreSQL client and test database')
    def test_collector_dumps_database_and_copies_current_certificates(self):
        spec=importlib.util.spec_from_file_location('collector',ROOT/'ops/full-backup.py')
        collector=importlib.util.module_from_spec(spec);spec.loader.exec_module(collector)
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder); fixture=root/'fixture';app=fixture/'opt/zvpn-panel/app'
            def mapped(value):
                text=str(value)
                return fixture/text.lstrip('/') if text.startswith(('/etc/','/opt/','/var/','/usr/local/')) else pathlib.Path(value)
            files={
                'opt/zvpn-panel/app/backend/.env':f'DATABASE_URL={os.environ["TEST_DATABASE_URL"]}\nPUBLIC_BASE_URL=https://vpn.example.com\nMASTER_KEY=fixture-only\n'.encode(),
                'etc/ipsec.conf':b'unchanged IKE config', 'etc/ipsec.secrets':b'unchanged secret',
                'etc/ipsec.d/cacerts/ikev2-ca-cert.pem':b'unchanged CA certificate',
                'etc/ipsec.d/private/ikev2-ca-key.pem':b'unchanged CA key',
                'etc/ipsec.d/certs/ikev2-server-cert.pem':b'unchanged server certificate',
                'etc/ipsec.d/private/ikev2-server-key.pem':b'unchanged server key',
                'etc/letsencrypt/archive/vpn.example.com/privkey1.pem':b'unchanged SSL key',
                'etc/nginx/sites-available/zvpn-panel':b'original HTTPS site',
                'usr/local/etc/xray/config.json':b'{"fixture":"no-production-files"}',
                'etc/zvpn/warp.json':b'{"enabled":true}',
                'var/lib/cloudflare-warp/reg.json':b'{"registration":"original-private-device-identity"}',
                'var/lib/zvpn-panel/warp/usage.json':b'{"uplink":123,"downlink":456,"daily":{"2026-10-19":579}}',
                'etc/systemd/system/zvpn-panel.service.d/warp.conf':b'[Service]\nReadWritePaths=/etc/zvpn\n',
            }
            for name,data in files.items():
                file=fixture/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
            link=fixture/'etc/letsencrypt/live/vpn.example.com/privkey.pem';link.parent.mkdir(parents=True)
            link.symlink_to('../../archive/vpn.example.com/privkey1.pem')
            link=fixture/'etc/nginx/sites-enabled/zvpn-panel';link.parent.mkdir(parents=True)
            link.symlink_to(fixture/'etc/nginx/sites-available/zvpn-panel')
            (app/'backend/scripts').mkdir(parents=True)
            shutil.copy2(ROOT/'backend/scripts/create-admin.js',app/'backend/scripts/create-admin.js')
            (app/'backend/public').mkdir(parents=True)
            (app/'backend/public/ZVPN-Windows-Client.exe').write_bytes(b'original client download')
            output=root/'snapshot'
            with patch.object(collector,'APP',app),patch.object(collector,'Path',mapped):collector.collect(output)
            restore.verify_snapshot(output)
            for name,data in files.items():
                target='panel.env' if name.endswith('/.env') else name.removeprefix('etc/')
                if name.startswith('etc/zvpn/'): target='warp-policy/'+name.removeprefix('etc/zvpn/')
                if name.startswith('var/lib/cloudflare-warp/'): target='warp-registration/'+name.removeprefix('var/lib/cloudflare-warp/')
                if name.startswith('var/lib/zvpn-panel/warp/'): target='warp-usage/'+name.removeprefix('var/lib/zvpn-panel/warp/')
                if name.startswith('etc/systemd/system/'): target='systemd/'+name.removeprefix('etc/systemd/system/')
                if name.startswith('usr/local/etc/xray/'): target='xray/'+name.removeprefix('usr/local/etc/xray/')
                self.assertEqual((output/target).read_bytes(),data)
            self.assertIn(b'PostgreSQL database dump',gzip.decompress((output/'database.sql.gz').read_bytes()))
            self.assertTrue((output/'app-source/backend/scripts/create-admin.js').is_file())
            self.assertEqual((output/'app-source/backend/public/ZVPN-Windows-Client.exe').read_bytes(),b'original client download')
            self.assertFalse((output/'nginx/sites-enabled/zvpn-panel').readlink().is_absolute())

    def snapshot(self):
        files={
            'panel.env':b'MASTER_KEY=preserved-original-key\nPUBLIC_BASE_URL=https://vpn.example.com\n',
            'database.sql.gz':gzip.compress(b'-- existing UUIDs and shared consumption'),
            'ipsec.conf':b'original IKE configuration', 'ipsec.secrets':b'original secret include',
            'ipsec.d/cacerts/ikev2-ca-cert.pem':b'original CA certificate bytes\n',
            'ipsec.d/private/ikev2-ca-key.pem':b'original CA private key bytes\n',
            'ipsec.d/certs/ikev2-server-cert.pem':b'original server certificate bytes\n',
            'ipsec.d/private/ikev2-server-key.pem':b'original server private key bytes\n',
            'letsencrypt/archive/vpn.example.com/privkey1.pem':b'original TLS private key bytes\n',
            'letsencrypt/archive/vpn.example.com/fullchain1.pem':b'original TLS chain bytes\n',
        }
        manifest={'format':'zvpn-full-backup','formatVersion':1,'checksums':{n:hashlib.sha256(v).hexdigest() for n,v in files.items()}}
        output=io.BytesIO()
        with tarfile.open(fileobj=output,mode='w:gz') as archive:
            for name,value in {**files,'manifest.json':json.dumps(manifest).encode()}.items():
                item=tarfile.TarInfo(name);item.size=len(value);archive.addfile(item,io.BytesIO(value))
            link=tarfile.TarInfo('letsencrypt/live/vpn.example.com/privkey.pem');link.type=tarfile.SYMTYPE
            link.linkname='../../archive/vpn.example.com/privkey1.pem';archive.addfile(link)
        return output.getvalue(),files

    def test_restore_preserves_existing_certificates_and_relative_tls_links(self):
        data,files=self.snapshot()
        with tempfile.TemporaryDirectory() as folder:
            restore.safe_extract(data,folder);restore.verify_snapshot(folder)
            for name,value in files.items():self.assertEqual((pathlib.Path(folder)/name).read_bytes(),value)
            self.assertEqual((pathlib.Path(folder)/'letsencrypt/live/vpn.example.com/privkey.pem').read_bytes(),
                             files['letsencrypt/archive/vpn.example.com/privkey1.pem'])

    def test_copy_over_installed_tls_links_is_repeatable_and_preserves_original_keys(self):
        data,files=self.snapshot()
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);snapshot=root/'snapshot';snapshot.mkdir()
            restore.safe_extract(data,snapshot)
            installed=root/'installed';live=installed/'live/vpn.example.com';live.mkdir(parents=True)
            archive=installed/'archive/vpn.example.com';archive.mkdir(parents=True)
            (archive/'privkey1.pem').write_bytes(b'fresh-install key')
            (live/'privkey.pem').symlink_to('../../archive/vpn.example.com/privkey1.pem')
            for _ in range(2):
                restore.copy_tree(snapshot/'letsencrypt',installed)
                self.assertEqual((live/'privkey.pem').readlink(),pathlib.Path('../../archive/vpn.example.com/privkey1.pem'))
                self.assertEqual((live/'privkey.pem').read_bytes(),files['letsencrypt/archive/vpn.example.com/privkey1.pem'])

    def test_copy_regular_file_does_not_follow_existing_destination_link(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);source=root/'source';source.mkdir();target=root/'target';target.mkdir()
            outside=root/'unrelated';outside.write_bytes(b'preserve this')
            (source/'file').write_bytes(b'restored');(target/'file').symlink_to(outside)
            restore.copy_tree(source,target)
            self.assertEqual(outside.read_bytes(),b'preserve this')
            self.assertFalse((target/'file').is_symlink())
            self.assertEqual((target/'file').read_bytes(),b'restored')

    def test_missing_or_modified_private_key_is_a_failed_backup(self):
        data,_=self.snapshot()
        with tempfile.TemporaryDirectory() as folder:
            restore.safe_extract(data,folder)
            (pathlib.Path(folder)/'ipsec.d/private/ikev2-ca-key.pem').write_bytes(b'changed')
            with self.assertRaises(ValueError):restore.verify_snapshot(folder)

    def test_restore_applies_both_network_optimizers_and_propagates_failure(self):
        import subprocess
        with tempfile.TemporaryDirectory() as folder:
            app=pathlib.Path(folder);(app/'ops').mkdir()
            names=('optimize-speed.sh','optimize-instagram.sh')
            for name in names:(app/'ops'/name).write_text('# fixture')
            with patch.object(restore,'run') as execute:
                restore.apply_network_optimizations(app)
                self.assertEqual(execute.call_args_list,[unittest.mock.call(['bash',str(app/'ops'/name)]) for name in names])
            with patch.object(restore,'run',side_effect=subprocess.CalledProcessError(1,['bash'])):
                with self.assertRaises(subprocess.CalledProcessError):restore.apply_network_optimizations(app)

    def test_extraction_refuses_paths_or_symlinks_outside_snapshot(self):
        for name,link in [('../outside',None),('link','/etc/passwd'),('link','../../outside')]:
            output=io.BytesIO()
            with tarfile.open(fileobj=output,mode='w:gz') as archive:
                item=tarfile.TarInfo(name)
                if link:item.type=tarfile.SYMTYPE;item.linkname=link
                archive.addfile(item)
            with tempfile.TemporaryDirectory() as folder:
                with self.assertRaises(ValueError):restore.safe_extract(output.getvalue(),folder)

if __name__=='__main__':unittest.main()
