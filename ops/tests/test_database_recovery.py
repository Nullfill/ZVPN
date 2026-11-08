import gzip,importlib.util,os,pathlib,shutil,subprocess,tempfile,unittest,uuid
from unittest.mock import patch
from urllib.parse import unquote,urlparse,urlunparse

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('restore',ROOT/'ops/restore-full-backup.py')
restore=importlib.util.module_from_spec(spec);spec.loader.exec_module(restore)

@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL') and shutil.which('pg_dump') and shutil.which('psql'), 'requires disposable PostgreSQL')
class DatabaseRecoveryTests(unittest.TestCase):
    def test_replacement_preserves_accounts_and_works_with_new_database_owner(self):
        suffix=uuid.uuid4().hex
        source='zvpn_source_'+suffix;target='zvpn_restore_'+suffix;role='zvpn_owner_'+suffix
        admin=os.environ['TEST_DATABASE_URL']
        connection=urlparse(admin)
        url=lambda name:urlunparse(urlparse(admin)._replace(path='/'+name))
        def sql(database,text):
            return subprocess.check_output(['psql',database,'-v','ON_ERROR_STOP=1','-At'],input=text.encode(),stderr=subprocess.DEVNULL)
        old_database = 'zvpn_previous_' + suffix[:16]
        try:
            sql(admin,f'CREATE ROLE {role} LOGIN;')
            sql(admin,f'CREATE DATABASE {source};')
            sql(admin,f'CREATE DATABASE {target} OWNER {role};')
            sql(url(source),(ROOT/'ops/schema.sql').read_text())
            for migration in sorted((ROOT/'ops/migrations').glob('*.sql')):sql(url(source),migration.read_text())
            relay_policy='{"enabled":true,"hostname":"relay.example.com"}'
            sql(url(source),f"UPDATE panel_settings SET value='{relay_policy}'::jsonb WHERE key='netlify';")
            sql(url(source),"""INSERT INTO vpn_users(username,secret_enc,download_token,expires_at,usage_total,xray_uuid,netlify_usage_bytes,xray_legacy_usage_bytes)
              VALUES('existing-user','original-encrypted-secret','original-download-token','2030-01-01',123456,
                '22222222-2222-4222-8222-222222222222',4567,1234);""")
            before=sql(url(source),'SELECT username,secret_enc,download_token,expires_at,usage_total,xray_uuid,netlify_usage_bytes,xray_legacy_usage_bytes FROM vpn_users;')
            dump=subprocess.check_output(['pg_dump',url(source),'--clean','--if-exists','--no-owner','--no-privileges'])
            # CI's PostgreSQL 16 can exercise the newer header using its real
            # dump and restore programs, without requiring a second cluster.
            timeout_setting=b'SET transaction_timeout = 0;\n'
            if timeout_setting not in dump:
                marker=b'SET idle_in_transaction_session_timeout = 0;\n'
                self.assertIn(marker,dump)
                dump=dump.replace(marker,marker+timeout_setting,1)
            sql(url(target), "CREATE TABLE previous_installation (value text); INSERT INTO previous_installation VALUES ('still here');")
            env = {'PGHOST': unquote(connection.hostname), 'PGUSER': connection.username,
                   'PGPASSWORD': connection.password or ''}
            with tempfile.TemporaryDirectory() as work, patch.dict(os.environ, env), \
                 patch.object(restore, 'POSTGRES', []), \
                 patch.object(restore, 'PSQL', ['psql', '-X', '-p', '5432', '-v', 'ON_ERROR_STOP=1']):
                root=pathlib.Path(work)
                snapshot=root/'database.sql.gz'
                snapshot.write_bytes(gzip.compress(dump + b'\nSELECT deliberate_restore_error;\n'))
                with self.assertRaisesRegex(ValueError, 'existing database was not replaced'):
                    with restore.stage_database(root,role,target):
                        self.fail('A failed SQL import must never reach the swap')
                self.assertEqual(sql(url(target),'TABLE previous_installation;'),b'still here\n')
                snapshot.write_bytes(gzip.compress(dump))
                with restore.stage_database(root,role,target) as candidate:
                    with patch.object(restore.secrets, 'token_hex', return_value=suffix[:16]):
                        restore.activate_database(candidate,target,role,'fixture-only')
                self.assertEqual(sql(admin,f"SELECT datallowconn FROM pg_database WHERE datname='{old_database}';"),b'f\n')
                sql(admin,f'ALTER DATABASE {old_database} ALLOW_CONNECTIONS true;')
                self.assertEqual(sql(url(old_database),'TABLE previous_installation;'),b'still here\n')
            after=sql(url(target),'SELECT username,secret_enc,download_token,expires_at,usage_total,xray_uuid,netlify_usage_bytes,xray_legacy_usage_bytes FROM vpn_users;')
            self.assertEqual(before,after)
            self.assertEqual(sql(url(source),"SELECT value FROM panel_settings WHERE key='netlify';"),
                             sql(url(target),"SELECT value FROM panel_settings WHERE key='netlify';"))
            self.assertEqual(sql(url(target),"SELECT tableowner FROM pg_tables WHERE tablename='vpn_users';").strip().decode(),role)
        finally:
            for name in (source,target,old_database):
                subprocess.run(['dropdb','--maintenance-db',admin,'--if-exists','--force',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
            sql(admin,f'DROP ROLE IF EXISTS {role};')

if __name__=='__main__':unittest.main()
