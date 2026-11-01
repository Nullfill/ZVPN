import copy
import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace

HELPER = Path(__file__).resolve().parents[1] / 'helper'
sys.path.insert(0, str(HELPER))
import warp_policy as policy


def sample():
    return {'enabled': True, 'scope': 'selected', 'users': [{'id': '11111111-1111-4111-8111-111111111111', 'username': 'hamednew'}],
            'domains': ['gemini.google.com', 'googleapis.com'], 'excludedDomains': ['other.googleapis.com'],
            'failureMode': 'block', 'disableQuic': True}


def core():
    return {'inbounds': [{'protocol':'dokodemo-door'}, {'protocol':'vless'}, {'protocol':'vless'}], 'outbounds': [{'tag': 'direct', 'protocol': 'freedom'}],
            'policy': {'levels': {'0': {'statsUserUplink': True, 'statsUserDownlink': True}}},
            'routing': {'rules': [{'type': 'field', 'inboundTag': ['api-in'], 'outboundTag': 'api'}]}}


class WarpPolicyTests(unittest.TestCase):
    def test_privileged_input_rejects_commands_paths_urls_and_unbounded_fields(self):
        for field, value in [('port', 22), ('domains', ['https://example.com/a']),
                             ('domains', ['*.example.com']), ('domains', ['a.com;reboot']),
                             ('domains', []), ('enabled', 1), ('scope', 'shell'),
                             ('users', [{'id': '../root', 'username': 'x'}])]:
            data = sample(); data[field] = value
            with self.assertRaises(ValueError): policy.validate(data)
        self.assertEqual(policy.validate(sample()), {**sample(), 'provider': 'warp', 'antigravityViaWarp': False})

    def test_antigravity_stream_override_respects_exclusions_scope_and_failure_policy(self):
        data = policy.validate({**sample(), 'provider': 'psiphon', 'antigravityViaWarp': True,
                                'domains': ['gemini.google.com'], 'excludedDomains': ['cloudcode-pa.googleapis.com']})
        config = policy.gateway_config(data)
        self.assertEqual(config['routing']['rules'][1]['outboundTag'], 'direct')
        self.assertEqual(config['routing']['rules'][2]['outboundTag'], 'antigravity-warp')
        self.assertEqual(config['routing']['rules'][3]['outboundTag'], 'warp')
        self.assertEqual(config['outbounds'][-1]['settings']['servers'][0]['port'], 40000)
        applied = policy.main_xray(core(), data)
        self.assertIn('domain:daily-cloudcode-pa.googleapis.com', applied['routing']['rules'][-1]['domain'])
        self.assertEqual(len(applied['routing']['rules'][-1]['user']), 3)
        data['failureMode'] = 'direct'
        self.assertEqual(policy.gateway_config(data, warp_healthy=False)['routing']['rules'][2]['outboundTag'], 'direct')
        data['antigravityViaWarp'] = 'yes'
        with self.assertRaises(ValueError): policy.validate(data)

    def test_provider_selects_only_fixed_local_proxy_and_preserves_domain_rules(self):
        for provider, port in [('warp', 40000), ('psiphon', 40002)]:
            data = policy.validate({**sample(), 'provider': provider})
            config = policy.gateway_config(data)
            self.assertEqual(config['outbounds'][1]['settings']['servers'], [{'address': '127.0.0.1', 'port': port}])
            self.assertEqual(config['routing']['rules'][-1]['domain'], ['domain:gemini.google.com', 'domain:googleapis.com'])
            self.assertEqual(config['routing']['rules'][1]['outboundTag'], 'direct')
        for provider in ['shell', '127.0.0.1:22', None]:
            with self.assertRaises(ValueError): policy.validate({**sample(), 'provider': provider})

    def test_selected_users_exclusions_api_and_quota_accounting_are_preserved(self):
        original = core(); applied = policy.main_xray(original, sample())
        self.assertEqual(original, core())
        self.assertEqual(applied['policy'], original['policy'])
        self.assertEqual(applied['routing']['rules'][0], original['routing']['rules'][0])
        self.assertEqual(applied['outbounds'][0], original['outbounds'][0])
        self.assertEqual(applied['routing']['rules'][1]['outboundTag'], 'direct')
        for rule in applied['routing']['rules'][1:]:
            self.assertEqual(rule['user'], ['zvpn-11111111-1111-4111-8111-111111111111', 'zvpn-netlify-11111111-1111-4111-8111-111111111111', 'zvpn-iran-11111111-1111-4111-8111-111111111111'])
        self.assertTrue(applied['inbounds'][1]['sniffing']['routeOnly'])
        self.assertTrue(applied['inbounds'][2]['sniffing']['routeOnly'])
        empty = sample(); empty['users'] = []
        self.assertEqual(policy.main_xray(original, empty), original)
        disabled = sample(); disabled['enabled'] = False
        self.assertEqual(policy.main_xray(original, disabled), original)

    def test_all_includes_future_users_and_failover_never_changes_default_route(self):
        data = sample(); data['scope'] = 'all'
        applied = policy.main_xray(core(), data)
        self.assertTrue(all('user' not in r for r in applied['routing']['rules']))
        config = policy.gateway_config(data, healthy=False)
        self.assertEqual(config['routing']['rules'][-1]['outboundTag'], 'warp')
        data['failureMode'] = 'direct'
        self.assertEqual(policy.gateway_config(data, healthy=False)['routing']['rules'][-1]['outboundTag'], 'direct')
        self.assertEqual(config['outbounds'][0]['tag'], 'direct')

    def test_ike_recovers_hostname_for_upstream_while_vless_keeps_destination(self):
        data = policy.validate(sample())
        gateway = policy.gateway_config(data)
        ike = next(i for i in gateway['inbounds'] if i['tag'] == 'ike-web')
        self.assertFalse(ike['sniffing']['routeOnly'])
        self.assertEqual(ike['sniffing']['destOverride'], ['http', 'tls', 'quic'])
        self.assertTrue(ike['settings']['followRedirect'])
        socks = next(i for i in gateway['inbounds'] if i['tag'] == 'xray-web')
        self.assertTrue(socks['sniffing']['routeOnly'])
        self.assertEqual(gateway['routing']['rules'][1]['outboundTag'], 'direct')
        self.assertEqual(gateway['routing']['rules'][-1]['outboundTag'], 'warp')


@unittest.skipUnless(os.name == 'posix', 'Linux router tests')
class WarpRouterTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(self.router, 'read_policy', return_value={'provider': 'warp'})
        patcher.start(); self.addCleanup(patcher.stop)

    def test_psiphon_rotation_restarts_only_the_selected_proxy(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder, patch.object(self.router, 'STATE', Path(folder)), \
             patch.object(self.router, 'read_policy', return_value={'provider': 'psiphon'}), \
             patch.object(self.router, 'atomic', side_effect=lambda p, data: p.write_text(__import__('json').dumps(data))), \
             patch.object(self.router.time, 'sleep'), patch.object(self.router, 'command') as run, \
             patch.object(self.router, 'probe', side_effect=[{'healthy': True, 'exitIp': '172.237.1.1'}, {'healthy': True, 'exitIp': '172.237.1.2'}]):
            self.assertEqual(self.router.rotate_ip()['outcome'], 'changed')
            self.assertEqual(run.call_args_list[0].args[0], ['systemctl', 'restart', 'zvpn-psiphon.service'])
            self.assertEqual(len(run.call_args_list), 1)

    def test_ip_rotation_reports_change_and_does_not_reset_registration(self):
        import tempfile
        for old, new, expected in [('104.28.1.1', '104.28.1.2', 'changed'), ('104.28.1.1', '104.28.1.1', 'unchanged')]:
            with tempfile.TemporaryDirectory() as folder, patch.object(self.router, 'STATE', Path(folder)), \
                 patch.object(self.router, 'atomic', side_effect=lambda p, data: p.write_text(__import__('json').dumps(data))), \
                 patch.object(self.router.time, 'sleep'), patch.object(self.router, 'command') as run, \
                 patch.object(self.router, 'probe', side_effect=[{'healthy': True, 'exitIp': old}, {'healthy': True, 'exitIp': new}]):
                result = self.router.rotate_ip()
                self.assertEqual(result['outcome'], expected)
                self.assertEqual(result['beforeIp'], old)
                self.assertEqual(result['afterIp'], new)
                self.assertEqual([call.args[0][-1] for call in run.call_args_list], ['disconnect', 'connect'])
                self.assertEqual(self.router.rotate_ip()['outcome'], 'cooldown')

    def test_ip_rotation_failure_requests_recovery_and_keeps_registration(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder, patch.object(self.router, 'STATE', Path(folder)), \
             patch.object(self.router, 'atomic', side_effect=lambda p, data: p.write_text(__import__('json').dumps(data))), \
             patch.object(self.router.time, 'sleep'), patch.object(self.router, 'command') as run, \
             patch.object(self.router, 'probe', return_value={'healthy': False}):
            run.side_effect = [RuntimeError('disconnect failed'), SimpleNamespace(stdout='')]
            self.assertEqual(self.router.rotate_ip()['outcome'], 'failed')
            self.assertEqual(run.call_args_list[-1].args[0][-1], 'connect')

    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('router', HELPER / 'warp-router.py')
        cls.router = importlib.util.module_from_spec(spec); spec.loader.exec_module(cls.router)

    def test_peer_selection_uses_eap_identity_and_ipsec_reqid_not_ike_id(self):
        raw = 'list-sa event {vpn {uniqueid=3 remote-id=192.168.1.2 remote-eap-id=hamednew remote-vips=[10.20.0.3] child-sas {vpn {reqid=2}}}}'
        self.assertEqual(self.router.peers(raw, {'hamednew'}), [('10.20.0.3', 2)])
        self.assertEqual(self.router.peers(raw, {'another-user'}), [])
        rules = self.router.firewall_rules(sample(), raw)
        nat = next(rule for table, chain, rule in rules if table == 'nat')
        self.assertIn('2', nat); self.assertIn('ipsec', nat)
        self.assertIn('10.20.0.3/32', nat)
        self.assertEqual(self.router.firewall_rules(None, raw), [])

    def test_usage_is_idempotent_across_restarts_and_persisted_recovery(self):
        state = {}
        for _ in range(2): self.router.add_counters(state, {'uplink': 100, 'downlink': 200}, 'boot1', '2026-10-19')
        self.assertEqual(state['daily']['2026-10-19'], 300)
        self.router.add_counters(state, {'uplink': 20, 'downlink': 30}, 'boot2', '2026-10-19')
        self.assertEqual(state['uplink'] + state['downlink'], 350)
        self.router.add_counters(state, {'uplink': 25, 'downlink': 35}, 'boot2', '2026-10-20')
        self.assertEqual(state['daily']['2026-10-20'], 10)

    def test_protobuf_zero_counter_may_omit_value_field(self):
        with patch.object(self.router, 'command', return_value=SimpleNamespace(stdout='{"stat":[{"name":"outbound>>>warp>>>traffic>>>uplink"}]}')):
            self.assertEqual(self.router.read_counters(), {'uplink': 0, 'downlink': 0})

    def test_both_provider_counters_are_summed_without_counting_direct_traffic(self):
        stats = '{"stat":[{"name":"outbound>>>warp>>>traffic>>>uplink","value":10},{"name":"outbound>>>antigravity-warp>>>traffic>>>uplink","value":7},{"name":"outbound>>>direct>>>traffic>>>uplink","value":1000}]}'
        with patch.object(self.router, 'command', return_value=SimpleNamespace(stdout=stats)):
            self.assertEqual(self.router.read_counters(), {'uplink': 17, 'downlink': 0})


if __name__ == '__main__': unittest.main()
