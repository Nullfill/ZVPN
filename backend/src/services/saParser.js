import { relayTransport } from './ikeRelayConfig.js';

function sumMatches(text, regex) {
  let total = 0;
  for (const match of text.matchAll(regex)) total += Number(match[1] || 0);
  return total;
}

function rawValue(block, key) {
  // `swanctl --raw` output has used both key=value and key = value forms
  // across supported strongSwan releases. IDs may also be quoted.
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`(?:^|[\\s{])${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s}]+))`, 'm'));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function firstVirtualIp(block) {
  const value = rawValue(block, 'remote-vips');
  if (!value) return null;
  return value.replace(/^\[/, '').replace(/\]$/, '').split(',')[0].trim() || null;
}

/** Parse one or more `swanctl --list-sas --raw` events. */
export function parseSas(raw) {
  if (!raw) return [];
  return raw
    .split(/(?=list-sa\s+event\s*\{)/g)
    .map((block) => block.trim())
    .filter((block) => /^list-sa\s+event\s*\{/m.test(block))
    // An unauthenticated IKE_AUTH attempt is not a connection. In particular,
    // it must never start an account's first-connect subscription timer.
    .filter((block) => {
      const state = rawValue(block.split('child-sas')[0], 'state');
      return !state || state === 'ESTABLISHED' || state === 'REKEYING';
    })
    .map((block) => {
      const bytesIn = sumMatches(block, /\bbytes-in\s*=\s*(\d+)/g);
      const bytesOut = sumMatches(block, /\bbytes-out\s*=\s*(\d+)/g);
      const eapId = rawValue(block, 'remote-eap-id');
      const remoteId = rawValue(block, 'remote-id');
      const connection = /^list-sa\s+event\s*\{\s*([^\s{]+)\s*\{/.exec(block)?.[1];
      const initiator = rawValue(block, 'initiator-spi');
      const responder = rawValue(block, 'responder-spi');
      const children = [...block.matchAll(/\{([^{}]*)\}/g)].map(([, child]) => {
        const spiIn = rawValue(child, 'spi-in');
        const spiOut = rawValue(child, 'spi-out');
        return spiIn && spiOut ? { key: `${spiIn}:${spiOut}`, bytesIn: Number(rawValue(child, 'bytes-in') || 0),
          bytesOut: Number(rawValue(child, 'bytes-out') || 0) } : null;
      }).filter(Boolean);
      return {
        ...(initiator && responder ? { identity: `${initiator}:${responder}` } : {}),
        ...(children.length ? { children } : {}),
        ...(relayTransport(connection) === 'ike-relay' ? { transport: 'ike-relay' } : {}),
        ikeId: rawValue(block, 'uniqueid'),
        remoteId: eapId || remoteId,
        remoteHost: rawValue(block, 'remote-host'),
        remotePort: rawValue(block, 'remote-port'),
        // This is SA age in seconds, not an epoch timestamp. Lower is newer.
        established: Number(rawValue(block, 'established') || 0),
        virtualIp: firstVirtualIp(block),
        bytesIn,
        bytesOut,
        bytesTotal: bytesIn + bytesOut,
      };
    })
    .filter((session) => /^\d+$/.test(session.ikeId || '') && session.remoteId);
}

