import { isIP } from 'node:net';

export const XRAY_PORT = 10085;
export const XRAY_API_PORT = 10086;
export const XRAY_TAG = 'zvpn-vless';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function eligibleUser(user, now = Date.now()) {
  return user.enabled && !user.quota_blocked &&
    (!user.expires_at || new Date(user.expires_at).getTime() > now);
}

export function xrayIdentity(user) {
  if (!UUID_RE.test(user.id) || !UUID_RE.test(user.xray_uuid)) throw new Error('INVALID_XRAY_IDENTITY');
  return { id: user.xray_uuid, email: `zvpn-${user.id}`, level: 0 };
}

export function buildXrayConfig(users, enabled = true) {
  return {
    log: { loglevel: 'warning' },
    api: { tag: 'api', services: ['StatsService'] },
    stats: {},
    policy: { levels: { '0': { statsUserUplink: true, statsUserDownlink: true } } },
    inbounds: [
      { tag: 'api-in', listen: '127.0.0.1', port: XRAY_API_PORT, protocol: 'dokodemo-door', settings: { address: '127.0.0.1' } },
      { tag: XRAY_TAG, listen: '127.0.0.1', port: XRAY_PORT, protocol: 'vless',
        settings: { clients: enabled ? users.filter((u) => eligibleUser(u)).map(xrayIdentity) : [], decryption: 'none' },
        streamSettings: { network: 'xhttp', security: 'none', xhttpSettings: { path: '/zvpn-xhttp/', mode: 'auto' } } },
    ],
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [{ type: 'field', inboundTag: ['api-in'], outboundTag: 'api' }] },
  };
}

export function xrayLink(user, baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || isIP(url.hostname)) throw new Error('XRAY_REQUIRES_HTTPS_DOMAIN');
  const id = xrayIdentity(user).id;
  const query = new URLSearchParams({ encryption: 'none', security: 'tls', sni: url.hostname,
    type: 'xhttp', path: '/zvpn-xhttp/', mode: 'packet-up', alpn: 'h2,http/1.1' });
  return `vless://${id}@${url.hostname}:${url.port || 443}?${query}#${encodeURIComponent(`ZVPN ${user.username}`)}`;
}

export function parseXrayStats(data) {
  const result = new Map();
  for (const stat of data.stat || []) {
    const match = /^user>>>zvpn-([0-9a-f-]{36})>>>traffic>>>(uplink|downlink)$/.exec(stat.name || '');
    if (!match || !UUID_RE.test(match[1])) continue;
    if (typeof stat.value === 'number' && !Number.isSafeInteger(stat.value)) throw new Error('INVALID_XRAY_COUNTER');
    const value = BigInt(stat.value ?? 0);
    if (value < 0n) throw new Error('INVALID_XRAY_COUNTER');
    const item = result.get(match[1]) || { uplink: 0n, downlink: 0n };
    item[match[2]] = value;
    result.set(match[1], item);
  }
  return result;
}

export function counterDelta(current, previous, sameEpoch) {
  const count = BigInt(current);
  const last = sameEpoch ? BigInt(previous || 0) : 0n;
  if (count < last) throw new Error('XRAY_COUNTER_REGRESSED');
  return count - last;
}
