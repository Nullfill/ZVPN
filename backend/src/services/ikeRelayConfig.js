import { z } from 'zod';
import { isIP } from 'node:net';

export const IKE_RELAY_DEFAULTS = Object.freeze({ enabled: false, hostname: '', port: 14450, outboundTag: 'direct' });
export const RELAY_CONNECTION = 'zvpn-ike-relay';
export const relayHostname = z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/);
export const ikeRelaySchema = z.object({
  enabled: z.boolean().optional(),
  hostname: z.union([z.literal(''), relayHostname]).optional(),
  port: z.number().int().min(1024).max(65535).optional(),
  outboundTag: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
}).strict();

export function relayPolicy(value) {
  const parsed = ikeRelaySchema.parse(value);
  const result = { ...IKE_RELAY_DEFAULTS, ...parsed };
  if (result.enabled && !result.hostname) throw new Error('RELAY_HOSTNAME_REQUIRED');
  return result;
}

export function relayTransport(connectionName) {
  return [RELAY_CONNECTION, 'ikev2-ir-test'].includes(connectionName) ? 'ike-relay' : 'ike';
}

/** A fragment to merge, never a replacement for the Iran panel's template. */
export function relayTemplate(policy, origin) {
  const p = relayPolicy(policy);
  if (isIP(origin) !== 4) relayHostname.parse(origin);
  const tag = RELAY_CONNECTION;
  return {
    inbounds: [{ tag, listen: '0.0.0.0', port: p.port, protocol: 'tunnel',
      settings: { allowedNetwork: 'udp', rewriteAddress: origin, rewritePort: 4500, followRedirect: false },
      sniffing: { enabled: false } }],
    routing: { rules: [{ type: 'field', inboundTag: [tag], outboundTag: p.outboundTag }] },
  };
}

export function mergeRelayTemplate(original, fragment) {
  if (!original || !Array.isArray(original.inbounds) || !Array.isArray(original.outbounds)
    || !Array.isArray(original.routing?.rules)) throw new Error('INVALID_XRAY_TEMPLATE');
  const next = structuredClone(original), inbound = fragment.inbounds[0];
  const owned = new Set([inbound.tag]);
  const legacy = next.inbounds.find(v => v.tag === `ir-ike-test-${inbound.port}` && v.protocol === 'tunnel'
    && v.settings?.allowedNetwork === 'udp' && v.settings?.rewritePort === 4500);
  if (legacy) owned.add(legacy.tag);
  if (!next.outbounds.some(v => v.tag === fragment.routing.rules[0].outboundTag)) throw new Error('RELAY_OUTBOUND_NOT_FOUND');
  if (next.inbounds.some(v => !owned.has(v.tag) && String(v.port) === String(inbound.port))) throw new Error('RELAY_PORT_IN_USE');
  next.inbounds = next.inbounds.filter(v => !owned.has(v.tag));
  next.inbounds.push(inbound);
  next.routing.rules = next.routing.rules.flatMap(rule => {
    if (!rule.inboundTag?.some(tag => owned.has(tag))) return [rule];
    const tags = rule.inboundTag.filter(tag => !owned.has(tag));
    return tags.length ? [{ ...rule, inboundTag: tags }] : [];
  });
  // The control API must retain its routing rule; our explicit route precedes general blocks.
  const at = next.routing.rules.findIndex(rule => rule.outboundTag !== 'api');
  next.routing.rules.splice(at < 0 ? next.routing.rules.length : at, 0, fragment.routing.rules[0]);
  return next;
}
