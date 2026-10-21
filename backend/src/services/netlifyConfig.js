import { isIP } from 'node:net';
import { xrayLink } from './xrayConfig.js';

export const NETLIFY_DEFAULTS = { enabled: false, hostname: '' };
export const RELAY_EXTRA = Object.freeze({
  xPaddingObfsMode: true, xPaddingPlacement: 'header',
  xPaddingHeader: 'X-Relay-Padding', xPaddingMethod: 'repeat-x',
  xPaddingBytes: '100-1000', scMaxEachPostBytes: '1000000',
});

export function validRelayHostname(host) {
  return typeof host === 'string' && host.length <= 253 && !isIP(host) &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host);
}

export function netlifyLink(user, baseUrl, settings) {
  if (settings?.enabled !== true) return null;
  const host = settings.hostname;
  if (!validRelayHostname(host) || host === new URL(baseUrl).hostname) throw Error('INVALID_RELAY_HOSTNAME');
  // Reuse the existing identity: provisioning, expiry and quota stay with Xray.
  const direct = new URL(xrayLink(user, baseUrl));
  const query = new URLSearchParams({ encryption: 'none', security: 'tls', sni: host,
    host, type: 'xhttp', path: '/zvpn-xhttp/', mode: 'packet-up', alpn: 'h2,http/1.1',
    fp: 'chrome', extra: JSON.stringify(RELAY_EXTRA) });
  return `vless://${direct.username}@${host}:443?${query}#${encodeURIComponent(`${user.username} — Netlify`)}`;
}

export function connectionLinks(user, baseUrl, settings) {
  if (settings?.xray?.enabled === false) return [];
  const direct = xrayLink(user, baseUrl);
  const relay = netlifyLink(user, baseUrl, settings?.netlify);
  return relay ? [direct, relay] : [direct];
}
