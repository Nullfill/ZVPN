import os,pathlib,shutil,subprocess,unittest,uuid
from urllib.parse import urlparse,urlunparse

ROOT=pathlib.Path(__file__).resolve().parents[2]

@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL') and shutil.which('pg_dump') and shutil.which('psql'), 'requires disposable PostgreSQL')
class DatabaseRecoveryTests(unittest.TestCase):
    def test_replacement_preserves_accounts_and_works_with_new_database_owner(self):
        suffix=uuid.uuid4().hex
        source='zvpn_source_'+suffix;target='zvpn_restore_'+suffix;role='zvpn_owner_'+suffix
        admin=os.environ['TEST_DATABASE_URL']
        url=lambda name:urlunparse(urlparse(admin)._replace(path='/'+name))
        def sql(database,text):
            return subprocess.check_output(['psql',database,'-v','ON_ERROR_STOP=1','-At'],input=text.encode(),stderr=subprocess.DEVNULL)
        try:
            sql(admin,f'CREATE ROLE {role} LOGIN;')
            sql(admin,f'CREATE DATABASE {source};')
            sql(admin,f'CREATE DATABASE {target} OWNER {role};')
            sql(url(source),(ROOT/'ops/schema.sql').read_text())
            for migration in sorted((ROOT/'ops/migrations').glob('*.sql')):sql(url(source),migration.read_text())
            sql(url(source),"""INSERT INTO vpn_users(username,secret_enc,download_token,expires_at,usage_total,xray_uuid)
              VALUES('existing-user','original-encrypted-secret','original-download-token','2030-01-01',123456,
                '22222222-2222-4222-8222-222222222222');""")
            before=sql(url(source),'SELECT username,secret_enc,download_token,expires_at,usage_total,xray_uuid FROM vpn_users;')
            dump=subprocess.check_output(['pg_dump',url(source),'--clean','--if-exists','--no-owner','--no-privileges'])
            # Exactly the restore contract: empty database, account role, owner-free dump.
            sql(url(target),f'SET ROLE {role};\n'+dump.decode())
            after=sql(url(target),'SELECT username,secret_enc,download_token,expires_at,usage_total,xray_uuid FROM vpn_users;')
            self.assertEqual(before,after)
            self.assertEqual(sql(url(target),"SELECT tableowner FROM pg_tables WHERE tablename='vpn_users';").strip().decode(),role)
        finally:
            for name in (source,target):
                subprocess.run(['dropdb','--maintenance-db',admin,'--if-exists','--force',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
            sql(admin,f'DROP ROLE IF EXISTS {role};')

if __name__=='__main__':unittest.main()
