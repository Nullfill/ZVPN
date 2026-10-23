import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

if os.name == 'posix':
    spec = importlib.util.spec_from_file_location('ike_relay', Path(__file__).parents[1] / 'helper/ike-relay.py')
    relay = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(relay)


@unittest.skipUnless(os.name == 'posix', 'Linux helper')
class RelayTests(unittest.TestCase):
    def test_rejects_directives_paths_and_unexpected_fields(self):
        valid = dict(enabled=True, hostname='ir.example.com', port=14450, outboundTag='tunnel-1')
        self.assertEqual(relay.validate(valid), valid)
        for delta in [dict(hostname='ir.example.com\ninclude /root/*'), dict(port=True), dict(port=500), dict(outboundTag='$(id)'), dict(file='/etc/shadow')]:
            with self.assertRaises(ValueError):
                relay.validate({**valid, **delta})

    def test_additive_apply_preserves_production_certificate_and_rolls_back_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = dict(MAIN=root/'ipsec.conf', CONNECTION=root/'relay.conf', LEGACY=root/'legacy.conf', CERT=root/'relay-cert.pem', STATE=root/'state.json', RUNTIME=root/'runtime')
            paths['RUNTIME'].mkdir()
            main = b'config setup\nconn ikev2-vpn\n    leftcert=production.pem\n'
            paths['MAIN'].write_bytes(main)
            main_inode = paths['MAIN'].stat().st_ino
            paths['CERT'].write_bytes(b'unchanged relay certificate')
            policy = dict(enabled=True, hostname='ir.example.com', port=14450, outboundTag='tunnel-1')
            calls = []
            status_calls = 0
            def run(args):
                nonlocal status_calls
                calls.append(args)
                if args[:2] == ['ipsec', 'statusall']:
                    status_calls += 1
                    if status_calls == 1:
                        return 'starter is still applying update'
                    return 'zvpn-ike-relay: loaded'
                return 'certificate valid'
            with patch.multiple(relay, **paths), patch.object(relay, 'certificate_matches', return_value=True), patch.object(relay, 'run', side_effect=run), patch.object(relay.time, 'sleep') as sleep:
                relay.apply(policy)
                sleep.assert_called_once_with(0.5)
                self.assertIn(main, paths['MAIN'].read_bytes())
                self.assertEqual(paths['MAIN'].stat().st_ino, main_inode)
                self.assertEqual(paths['CERT'].read_bytes(), b'unchanged relay certificate')
                self.assertIn('also=ikev2-vpn', paths['CONNECTION'].read_text())
                self.assertTrue(json.loads((paths['RUNTIME']/'ike-relay-status.json').read_text())['ready'])
                self.assertFalse(any('restart' in call for call in calls))
                with patch.object(relay.subprocess, 'run') as terminate:
                    relay.apply({**policy, 'enabled': False})
                    terminate.assert_called_once_with(['ipsec', 'down', 'zvpn-ike-relay'], capture_output=True, timeout=15)
                self.assertNotIn('conn zvpn-ike-relay', paths['CONNECTION'].read_text())
                relay.apply(policy)
                self.assertEqual(paths['CERT'].read_bytes(), b'unchanged relay certificate')
                previous = paths['CONNECTION'].read_bytes()
                with patch.object(relay, 'run', side_effect=RuntimeError('reload failed')):
                    with self.assertRaises(RuntimeError):
                        relay.apply({**policy, 'hostname': 'new.example.com'})
                self.assertEqual(paths['CONNECTION'].read_bytes(), previous)
                self.assertEqual(paths['CERT'].read_bytes(), b'unchanged relay certificate')

    def test_main_file_update_does_not_rename_systemd_bind_mount(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'ipsec.conf'
            file.write_text('long original configuration')
            inode = file.stat().st_ino
            with patch.object(relay, 'MAIN', file), patch.object(relay.os, 'replace', side_effect=OSError('mount point busy')):
                relay.write(file, 'new')
            self.assertEqual(file.read_text(), 'new')
            self.assertEqual(file.stat().st_ino, inode)


if __name__ == '__main__':
    unittest.main()
