"""Strict, bounded routing policy. No caller-supplied ports, paths or commands."""
import copy
import json
import os
import re
from pathlib import Path

POLICY = Path('/etc/zvpn/warp.json')
DOMAIN = re.compile(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}')
UUID = re.compile(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}')


def validate(data):
    if not isinstance(data, dict) or set(data) != {
        'enabled', 'scope', 'users', 'domains', 'excludedDomains', 'failureMode', 'disableQuic'
    }:
        raise ValueError('Invalid WARP policy fields')
    for field in ('enabled', 'disableQuic'):
        if type(data[field]) is not bool:
            raise ValueError('Invalid boolean')
    if data['scope'] not in ('all', 'selected') or data['failureMode'] not in ('block', 'direct'):
        raise ValueError('Invalid WARP mode')
    for field in ('domains', 'excludedDomains'):
        values = data[field]
        if not isinstance(values, list) or len(values) > 200:
            raise ValueError('Too many domains')
        for domain in values:
            if not isinstance(domain, str) or len(domain) > 253 or not DOMAIN.fullmatch(domain):
                raise ValueError('Use domain names without URLs, wildcards or paths')
    if not data['domains']:
        raise ValueError('At least one domain is required')
    if not isinstance(data['users'], list) or len(data['users']) > 10000:
        raise ValueError('Invalid user list')
    for user in data['users']:
        if not isinstance(user, dict) or set(user) != {'id', 'username'}:
            raise ValueError('Invalid user')
        if not isinstance(user['id'], str) or not UUID.fullmatch(user['id']):
            raise ValueError('Invalid user ID')
        if not isinstance(user['username'], str) or not 1 <= len(user['username']) <= 128 or any(ord(c) < 32 for c in user['username']):
            raise ValueError('Invalid username')
    return data


def read_policy(path=POLICY):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return None
    with os.fdopen(fd) as file:
        stat = os.fstat(file.fileno())
        if stat.st_uid != 0 or stat.st_mode & 0o022 or stat.st_size > 4 * 1024 * 1024:
            raise ValueError('Unsafe root WARP policy')
        return validate(json.load(file))


def sniffing():
    return {'enabled': True, 'destOverride': ['http', 'tls', 'quic'], 'routeOnly': True}


def main_xray(config, policy):
    """Called only after the original fixed-shape user config is validated."""
    data = copy.deepcopy(config)
    if not policy or not policy['enabled']:
        return data
    if policy['scope'] == 'selected' and not policy['users']:
        return data
    for inbound in data['inbounds']:
        if inbound['protocol'] == 'vless': inbound['sniffing'] = sniffing()
    data['outbounds'] += [
        {'tag': 'zvpn-warp-router', 'protocol': 'socks', 'settings': {
            'servers': [{'address': '127.0.0.1', 'port': 40001}]}},
        {'tag': 'zvpn-warp-quic', 'protocol': 'blackhole'},
    ]
    user = {} if policy['scope'] == 'all' else {'user': [prefix + u['id'] for u in policy['users'] for prefix in ('zvpn-', 'zvpn-netlify-')]}
    rules = data['routing']['rules']
    if policy['excludedDomains']:
        rules.append({'type': 'field', **user, 'domain': ['domain:' + d for d in policy['excludedDomains']], 'outboundTag': 'direct'})
    domain = ['domain:' + d for d in policy['domains']]
    if policy['disableQuic']:
        rules.append({'type': 'field', **user, 'domain': domain, 'network': 'udp', 'port': '443', 'outboundTag': 'zvpn-warp-quic'})
    rules.append({'type': 'field', **user, 'domain': domain, 'network': 'tcp', 'outboundTag': 'zvpn-warp-router'})
    return data


def gateway_config(policy, healthy=True):
    target = 'warp' if healthy or policy['failureMode'] == 'block' else 'direct'
    rules = [{'type': 'field', 'inboundTag': ['api-in'], 'outboundTag': 'api'}]
    if policy['excludedDomains']:
        rules.append({'type': 'field', 'domain': ['domain:' + d for d in policy['excludedDomains']], 'outboundTag': 'direct'})
    rules.append({'type': 'field', 'domain': ['domain:' + d for d in policy['domains']], 'outboundTag': target})
    return {
        'log': {'loglevel': 'warning'}, 'api': {'tag': 'api', 'services': ['StatsService']}, 'stats': {},
        'policy': {'system': {'statsOutboundUplink': True, 'statsOutboundDownlink': True}},
        'inbounds': [
            {'tag': 'ike-web', 'listen': '0.0.0.0', 'port': 10087, 'protocol': 'dokodemo-door',
             'settings': {'network': 'tcp', 'followRedirect': True}, 'sniffing': sniffing(),
             'streamSettings': {'sockopt': {'tproxy': 'redirect'}}},
            {'tag': 'xray-web', 'listen': '127.0.0.1', 'port': 40001, 'protocol': 'socks',
             'settings': {'auth': 'noauth', 'udp': False}, 'sniffing': sniffing()},
            {'tag': 'api-in', 'listen': '127.0.0.1', 'port': 10089, 'protocol': 'dokodemo-door',
             'settings': {'address': '127.0.0.1'}},
        ],
        'outbounds': [{'tag': 'direct', 'protocol': 'freedom'}, {'tag': 'warp', 'protocol': 'socks',
                      'settings': {'servers': [{'address': '127.0.0.1', 'port': 40000}]}}],
        'routing': {'rules': rules},
    }
