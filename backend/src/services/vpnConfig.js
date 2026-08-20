import { config } from '../config.js';
import { getSetting } from './settings.js';

let cache = null;
let cacheAt = 0;
const TTL_MS = 3000;

/** VPN address used in all client profiles (Android/iOS/Windows). DB overrides .env */
export async function getVpnProfileConfig() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  const vpn = await getSetting('vpn');
  const serverAddress = (vpn.serverAddress || '').trim() || config.vpnServer;
  const remoteId = (vpn.remoteId || '').trim() || serverAddress || config.vpnRemoteId;
  cache = { serverAddress, remoteId };
  cacheAt = Date.now();
  return cache;
}

export function invalidateVpnConfigCache() {
  cache = null;
  cacheAt = 0;
}
