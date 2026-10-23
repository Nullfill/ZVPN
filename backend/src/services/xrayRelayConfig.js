import { ikeRelaySchema, relayHostname, mergeRelayTemplate } from './ikeRelayConfig.js';
import { xrayLink } from './xrayConfig.js';

export const XRAY_RELAY_DEFAULTS = { enabled: false, hostname: '', port: 14452, outboundTag: 'direct' };
export const xrayRelaySchema = ikeRelaySchema;
export function xrayRelayPolicy(value) {
  const policy = { ...XRAY_RELAY_DEFAULTS, ...xrayRelaySchema.parse(value) };
  if (policy.enabled && !policy.hostname) throw new Error('RELAY_HOSTNAME_REQUIRED');
  return policy;
}
export function xrayRelayLink(user, baseUrl, settings) {
  const policy = xrayRelayPolicy(settings || {});
  if (!policy.enabled) return null;
  const direct = new URL(xrayLink(user, baseUrl));
  if (direct.hostname === policy.hostname) throw new Error('RELAY_ORIGIN_MUST_DIFFER');
  direct.hostname = policy.hostname;
  direct.port = String(policy.port);
  direct.searchParams.set('host', direct.searchParams.get('sni'));
  direct.searchParams.set('path', '/zvpn-iran/');
  direct.hash = encodeURIComponent(`${user.username} — Iran Xray`);
  return direct.toString();
}
export function xrayRelayTemplate(value, baseUrl) {
  const policy = xrayRelayPolicy(value);
  const origin = new URL(baseUrl);
  relayHostname.parse(origin.hostname);
  if (!policy.hostname) throw new Error('RELAY_HOSTNAME_REQUIRED');
  if (origin.protocol !== 'https:' || !origin.hostname || origin.hostname === policy.hostname) throw new Error('INVALID_RELAY_ORIGIN');
  return {
    inbounds: [{ tag: 'zvpn-xray-iran', listen: '0.0.0.0', port: policy.port, protocol: 'tunnel',
      settings: { allowedNetwork: 'tcp', rewriteAddress: origin.hostname, rewritePort: Number(origin.port || 443), followRedirect: false },
      sniffing: { enabled: false } }],
    routing: { rules: [{ type: 'field', inboundTag: ['zvpn-xray-iran'], outboundTag: policy.outboundTag }] },
  };
}
export function mergeXrayRelayTemplate(original, fragment) {
  const copy = structuredClone(original);
  const legacy = copy?.inbounds?.find(v => v.tag === 'zvpn-xray-relay-test' && v.port === fragment.inbounds[0].port
    && v.protocol === 'tunnel' && v.settings?.allowedNetwork === 'tcp');
  if (legacy) {
    legacy.tag = 'zvpn-xray-iran';
    for (const rule of copy.routing?.rules || []) {
      if (rule.inboundTag) rule.inboundTag = rule.inboundTag.map(tag => tag === 'zvpn-xray-relay-test' ? legacy.tag : tag);
    }
  }
  return mergeRelayTemplate(copy, fragment);
}
