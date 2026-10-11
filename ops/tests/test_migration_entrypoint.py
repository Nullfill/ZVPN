"""Check the public one-file entry point without touching either server."""
import io,os,pathlib,shutil,subprocess,tarfile,tempfile,unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]

@unittest.skipIf(os.name == 'nt', 'requires Linux bash and sudo')
class MigrationEntrypointTests(unittest.TestCase):
    def invoke(self, script, env):
        command=['bash',str(script),'192.0.2.10','2222']
        if os.geteuid() != 0:
            command=['sudo','-n','env','PATH='+env['PATH'],'TEST_ARCHIVE='+env.get('TEST_ARCHIVE','')]+command
        return subprocess.run(command,env=env,capture_output=True,text=True,timeout=15,check=True).stdout

    def test_repository_entrypoint_preserves_arguments(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder)
            shutil.copy2(ROOT/'ops/migrate-server.sh',root/'migrate-server.sh')
            (root/'migrate-full-server.sh').write_text('printf "LOCAL:%s:%s\\n" "$1" "$2"\n')
            self.assertIn('LOCAL:192.0.2.10:2222',self.invoke(root/'migrate-server.sh',dict(os.environ)))

    def test_downloaded_entrypoint_fetches_companions_and_preserves_arguments(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);bin_dir=root/'bin';bin_dir.mkdir()
            script=root/'migrate.sh';shutil.copy2(ROOT/'ops/migrate-server.sh',script)
            archive=root/'fixture.tar.gz'
            with tarfile.open(archive,'w:gz') as tar:
                for name in ('migrate-full-server.sh','full-backup.py','restore-full-backup.py','restore-full-backup.sh'):
                    body=(b'test -f "$(dirname "$0")/full-backup.py"\n'
                          b'test -f "$(dirname "$0")/restore-full-backup.py"\n'
                          b'test -f "$(dirname "$0")/restore-full-backup.sh"\n'
                          b'printf "DOWNLOADED:%s:%s\\n" "$1" "$2"\n') if name=='migrate-full-server.sh' else b'# fixture\n'
                    info=tarfile.TarInfo('ZVPN-main/ops/'+name);info.size=len(body);tar.addfile(info,io.BytesIO(body))
            curl=bin_dir/'curl';curl.write_text('#!/bin/bash\ncp "$TEST_ARCHIVE" "${@: -1}"\n');curl.chmod(0o755)
            env=dict(os.environ,PATH=str(bin_dir)+os.pathsep+os.environ['PATH'],TEST_ARCHIVE=str(archive))
            self.assertIn('DOWNLOADED:192.0.2.10:2222',self.invoke(script,env))
