#!/usr/bin/env python3
"""Optional WARP sidecar. Never changes the server's default route or SSH path."""
import argparse
import datetime
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import signal
import shlex
import subprocess
import time
from zoneinfo import ZoneInfo
from warp_policy import POLICY, read_policy, validate, gateway_config

STATE = Path('/var/lib/zvpn-panel/warp')
RUNTIME = Path('/run/zvpn-warp')
COMMENT = 'zvpn-warp-managed'
stopping = False


def command(args, check=True, timeout=10):
    return subprocess.run(args, capture_output=True, text=True, check=check, timeout=timeout)


def atomic(path, data, mode=0o600, group=0):
    path = Path(path)
    temp = path.with_name(path.name + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'w') as file:
        json.dump(data, file); file.flush(); os.fsync(file.fileno())
        os.fchmod(file.fileno(), mode); os.fchown(file.fileno(), 0, group)
    os.replace(temp, path)


def sync_policy():
    fd = os.open('/opt/zvpn-panel/runtime/warp.json', os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as file:
        stat = os.fstat(file.fileno())
        if stat.st_uid != pwd.getpwnam('zvpn').pw_uid or stat.st_mode & 0o077 or stat.st_size > 4 * 1024 * 1024:
            raise ValueError('Unsafe panel WARP policy')
        data = validate(json.load(file))
    POLICY.parent.mkdir(mode=0o755, exist_ok=True)
    atomic(POLICY, data)
    command(['systemctl', 'start', 'zvpn-warp-router.service'])


def peers(raw, usernames):
    result = set()
    for block in re.split(r'list-sa event', raw)[1:]:
        identity = re.search(r'remote-eap-id=([^\s}]+)', block) or re.search(r'remote-id=([^\s}]+)', block)
        vip = re.search(r'remote-vips=([^\s}]+)', block)
        if not identity or (usernames is not None and identity.group(1) not in usernames) or not vip:
            continue
        address = vip.group(1).strip('[]')
        try:
            ip = ipaddress.ip_address(address)
            if ip.version != 4 or ip not in ipaddress.ip_network('10.0.0.0/8'):
                continue
        except ValueError:
            continue
        for reqid in re.findall(r'\breqid=(\d+)', block):
            result.add((str(ip), int(reqid)))
    return sorted(result)


def firewall_rules(policy, raw):
    if not policy or not policy['enabled']:
        return []
    selected = peers(raw, {u['username'] for u in policy['users']})
    # Explicit inbound IPsec policy prevents public or LAN access to the gateway.
    rules = []
    matches = [['-s', vip + '/32', '-m', 'policy', '--dir', 'in', '--pol', 'ipsec', '--reqid', str(reqid)] for vip, reqid in selected]
    if policy['scope'] == 'all':
        # The shared IKE pool is matched immediately, including the very first
        # connection of a new user before the next session polling cycle.
        matches = [['-s', '10.0.0.0/8', '-m', 'policy', '--dir', 'in', '--pol', 'ipsec']]
    for match in matches:
        rules.append(('nat', 'PREROUTING', match + ['-p', 'tcp', '-m', 'multiport', '--dports', '80,443', '-j', 'REDIRECT', '--to-ports', '10087']))
        if policy['disableQuic']:
            # WARP proxy is TCP only. Selected accounts use HTTP/2 instead of HTTP/3.
            rules.append(('filter', 'FORWARD', match + ['-p', 'udp', '--dport', '443', '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable']))
    return rules


def remove_rules(rules):
    for table, chain, rule in reversed(rules):
        command(['iptables', '-w', '3', '-t', table, '-D', chain, '-m', 'comment', '--comment', COMMENT, *rule], check=False)


def guard(remove=False):
    if Path('/proc/net/if_inet6').exists():
        # Xray/Go may bind an IPv6 dual-stack wildcard even for 0.0.0.0.
        # IKE addresses in this installation are IPv4; no IPv6 listener is public.
        ipv6 = ['-p', 'tcp', '--dport', '10087', '-m', 'comment', '--comment', COMMENT + '-guard', '-j', 'REJECT', '--reject-with', 'tcp-reset']
        if remove:
            command(['ip6tables', '-w', '3', '-D', 'INPUT', *ipv6], check=False)
        elif command(['ip6tables', '-w', '3', '-C', 'INPUT', *ipv6], check=False).returncode:
            command(['ip6tables', '-w', '3', '-I', 'INPUT', '1', *ipv6])
    rules = [['-p', 'tcp', '--dport', '10087', '-j', 'REJECT']]
    for port in ('80', '443'):
        rules.append(['-s', '10.0.0.0/8', '-m', 'policy', '--dir', 'in', '--pol', 'ipsec',
                      '-p', 'tcp', '--dport', '10087', '-m', 'conntrack', '--ctorigdstport', port, '-j', 'ACCEPT'])
    for rule in (reversed(rules) if remove else rules):
        args = ['-m', 'comment', '--comment', COMMENT + '-guard', *rule]
        if remove:
            command(['iptables', '-w', '3', '-D', 'INPUT', *args], check=False)
        elif command(['iptables', '-w', '3', '-C', 'INPUT', *args], check=False).returncode:
            command(['iptables', '-w', '3', '-I', 'INPUT', '1', *args])


def cleanup():
    saved = STATE / 'rules.json'
    # Also recover a rule added just before a process/power failure prevented
    # its journal write. Only this exact comment belongs to this component.
    for table in ('filter', 'nat'):
        for line in command(['iptables-save', '-t', table]).stdout.splitlines():
            if not line.startswith('-A '): continue
            parts = shlex.split(line)
            if '--comment' not in parts or parts[parts.index('--comment') + 1] != COMMENT: continue
            command(['iptables', '-w', '3', '-t', table, '-D', *parts[1:]], check=False)
    saved.unlink(missing_ok=True)


def install_rules(rules):
    cleanup()
    installed = []
    try:
        for table, chain, rule in rules:
            command(['iptables', '-w', '3', '-t', table, '-I', chain, '1', '-m', 'comment', '--comment', COMMENT, *rule])
            installed.append((table, chain, rule))
            atomic(STATE / 'rules.json', installed)
    except Exception:
        remove_rules(installed)
        raise


def add_counters(state, stats, epoch, day):
    previous = state.get('cursor', {})
    same = previous.get('epoch') == epoch
    delta = {}
    for direction in ('uplink', 'downlink'):
        value = max(0, int(stats.get(direction, 0)))
        last = previous.get(direction, 0) if same else 0
        # A reset within one process is treated as a fresh counter.
        delta[direction] = value - last if value >= last else value
        state[direction] = state.get(direction, 0) + delta[direction]
    state['cursor'] = {**stats, 'epoch': epoch}
    daily = state.setdefault('daily', {})
    daily[day] = daily.get(day, 0) + sum(delta.values())
    state['daily'] = dict(sorted(daily.items())[-366:])
    return state


def read_counters():
    result = command(['/usr/local/bin/xray', 'api', 'statsquery', '--server=127.0.0.1:10089', '-pattern', 'outbound>>>warp>>>traffic>>>'], timeout=5)
    stats = {'uplink': 0, 'downlink': 0}
    for item in json.loads(result.stdout).get('stat', []):
        match = re.fullmatch(r'outbound>>>warp>>>traffic>>>(uplink|downlink)', item['name'])
        if match:
            stats[match.group(1)] = int(item.get('value', 0))
    return stats


def probe():
    start = time.monotonic()
    try:
        trace = command(['curl', '--fail', '--silent', '--show-error', '--max-time', '8', '--socks5', '127.0.0.1:40000', '-4', 'https://www.cloudflare.com/cdn-cgi/trace'], timeout=10).stdout
        fields = dict(line.split('=', 1) for line in trace.splitlines() if '=' in line)
        return {'healthy': fields.get('warp') == 'on', 'exitIp': fields.get('ip'), 'country': fields.get('loc'),
                'latencyMs': round((time.monotonic() - start) * 1000), 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'error': None}
    except Exception:
        return {'healthy': False, 'error': 'WARP probe failed', 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}


def rotate_ip():
    """Bounded reconnect attempt; preserve registration, policies and counters."""
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (STATE / 'rotate.lock').open('w') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return {'outcome': 'busy'}
        previous = {}
        result_file = STATE / 'rotation.json'
        if result_file.exists():
            try: previous = json.loads(result_file.read_text())
            except (ValueError, OSError): pass
        if time.time() - previous.get('timestamp', 0) < 60:
            return {'outcome': 'cooldown', 'retryAfter': max(1, round(60 - (time.time() - previous['timestamp'])))}
        before = probe()
        result = {'beforeIp': before.get('exitIp') if before.get('healthy') else None,
                  'outcome': 'failed', 'timestamp': time.time()}
        # Record the attempt before disruption so rapid retries cannot flap WARP.
        atomic(result_file, result)
        try:
            command(['warp-cli', '--accept-tos', 'disconnect'], timeout=8)
            time.sleep(1)
            command(['warp-cli', '--accept-tos', 'connect'], timeout=8)
            for _ in range(2):
                time.sleep(2)
                after = probe()
                if after.get('healthy') and after.get('exitIp'):
                    result.update(after)
                    result['afterIp'] = after['exitIp']
                    result['outcome'] = ('changed' if result['beforeIp'] != after['exitIp'] else 'unchanged') if result['beforeIp'] else 'connected'
                    break
        except Exception:
            # Always request recovery; do not reset identity or restart VPN cores.
            try: command(['warp-cli', '--accept-tos', 'connect'], check=False, timeout=8)
            except Exception: pass
        result['timestamp'] = time.time()
        atomic(result_file, result)
        return result


def rotating():
    with (STATE / 'rotate.lock').open('a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return True
        return False


def daemon():
    global stopping
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chown(STATE, 0, 0); os.chmod(STATE, 0o700)
    RUNTIME.mkdir(mode=0o750, parents=True, exist_ok=True)
    os.chown(RUNTIME, 0, pwd.getpwnam('xray').pw_gid)
    lock = (STATE / 'daemon.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    signal.signal(signal.SIGTERM, lambda *_: globals().update(stopping=True))
    signal.signal(signal.SIGINT, lambda *_: globals().update(stopping=True))
    saved = STATE / 'usage.json'
    usage = json.loads(saved.read_text()) if saved.exists() else {}
    child, epoch, old_config, old_rules = None, None, None, None
    health, last_probe = {'healthy': False}, 0
    error = None

    def meter():
        if child and child.poll() is None:
            day = datetime.datetime.now(ZoneInfo('Asia/Tehran')).date().isoformat()
            add_counters(usage, read_counters(), epoch, day)
            atomic(saved, usage)

    try:
        cleanup()
        while not stopping:
            policy, enabled, raw = None, False, ''
            try:
                policy = read_policy()
                enabled = bool(policy and policy['enabled'])
                if enabled and time.monotonic() - last_probe > 30 and not rotating():
                    health = probe(); last_probe = time.monotonic()
                    if not health['healthy']:
                        command(['warp-cli', '--accept-tos', 'connect'], check=False)
                desired = gateway_config(policy, health['healthy']) if enabled else None
                if desired != old_config or (enabled and (not child or child.poll() is not None)):
                    # Drain WARP counters before restarting this sidecar. Shared user
                    # quotas remain in the original IKE/Xray collectors throughout.
                    if child:
                        try: meter()
                        except Exception as exc: error = str(exc)
                        child.terminate()
                        try: child.wait(timeout=8)
                        except subprocess.TimeoutExpired: child.kill(); child.wait()
                        child = None
                    cleanup(); old_rules = None
                    if desired:
                        # Guard is installed before opening the public-facing
                        # transparent listener, and survives every rule refresh.
                        guard()
                        config = RUNTIME / 'gateway.json'
                        atomic(config, desired, 0o640, pwd.getpwnam('xray').pw_gid)
                        command(['/usr/local/bin/xray', 'run', '-test', '-format', 'json', '-config', str(config)])
                        child = subprocess.Popen(['runuser', '-u', 'xray', '--', '/usr/local/bin/xray', 'run', '-config', str(config)], stdout=subprocess.DEVNULL)
                        epoch = str(time.time_ns())
                        time.sleep(0.5)
                        if child.poll() is not None: raise RuntimeError('WARP gateway did not start')
                    old_config = desired
                raw = command(['/usr/sbin/swanctl', '--list-sas', '--raw']).stdout if enabled else ''
                rules = firewall_rules(policy, raw)
                if rules != old_rules:
                    install_rules(rules); old_rules = rules
                if enabled: meter()
                error = None
                state = 'disabled' if not enabled else ('connected' if health['healthy'] else 'degraded')
            except Exception as exc:
                error = str(exc)[:300]; state = 'error'
                print('WARP router: ' + error, flush=True)
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()
            today = datetime.datetime.now(ZoneInfo('Asia/Tehran')).date().isoformat()
            status = {'state': state, **health, 'error': error or health.get('error'), 'updatedAt': now,
                      'uplinkBytes': usage.get('uplink', 0), 'downlinkBytes': usage.get('downlink', 0),
                      'totalBytes': usage.get('uplink', 0) + usage.get('downlink', 0),
                      'todayBytes': usage.get('daily', {}).get(today, 0), 'daily': usage.get('daily', {}),
                      'activeIkeSessions': len(peers(raw, None if policy['scope'] == 'all' else {u['username'] for u in policy['users']})) if enabled else 0,
                      'metering': 'payload', 'sampleIntervalSeconds': 2}
            atomic(STATE / 'status.json', status)
            time.sleep(2)
    finally:
        cleanup()
        if child:
            try: meter()
            except Exception: pass
            child.terminate()
            try: child.wait(timeout=8)
            except subprocess.TimeoutExpired: child.kill(); child.wait()
        guard(remove=True)


def main():
    if os.geteuid() != 0: raise RuntimeError('Root required')
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['sync', 'daemon', 'cleanup', 'reconnect', 'rotate-ip', 'status'])
    args = parser.parse_args()
    if args.action == 'sync': sync_policy()
    elif args.action == 'cleanup': cleanup(); guard(remove=True)
    elif args.action == 'reconnect': command(['warp-cli', '--accept-tos', 'connect'])
    elif args.action == 'rotate-ip': print(json.dumps(rotate_ip()))
    elif args.action == 'status': print((STATE / 'status.json').read_text())
    else: daemon()


if __name__ == '__main__': main()
