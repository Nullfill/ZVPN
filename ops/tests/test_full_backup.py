import gzip,hashlib,importlib.util,io,json,pathlib,tarfile,tempfile,unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('restore',ROOT/'ops/restore-full-backup.py')
restore=importlib.util.module_from_spec(spec);spec.loader.exec_module(restore)

class FullBackupTests(unittest.TestCase):
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

    def test_missing_or_modified_private_key_is_a_failed_backup(self):
        data,_=self.snapshot()
        with tempfile.TemporaryDirectory() as folder:
            restore.safe_extract(data,folder)
            (pathlib.Path(folder)/'ipsec.d/private/ikev2-ca-key.pem').write_bytes(b'changed')
            with self.assertRaises(ValueError):restore.verify_snapshot(folder)

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
