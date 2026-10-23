import { applyIkeRelay } from '../src/services/ikeRelay.js';
import { closeDatabase } from '../src/db.js';

try {
  await applyIkeRelay({ enabled: true, hostname: process.env.ZVPN_IKE_RELAY_HOSTNAME || '',
    port: Number(process.env.ZVPN_IKE_RELAY_PORT || 14450), outboundTag: process.env.ZVPN_IKE_RELAY_OUTBOUND || 'direct' });
  console.log('Iran relay enabled. Complete the Iran-side setup from Settings > Iran IKEv2.');
} catch (error) {
  console.error('Iran relay was not enabled:', error.message);
  process.exitCode = 1;
} finally { await closeDatabase(); }
