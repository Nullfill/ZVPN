import { getIkeRelayStatus } from '../src/services/ikeRelay.js';
import { closeDatabase } from '../src/db.js';
try {
  const status = await getIkeRelayStatus();
  console.log(status.enabled ? `Iran IKE relay: ${status.hostname}:${status.port}; origin ${status.ready ? 'ready' : 'not ready'}. Test the Iran route separately.` : 'Iran IKE relay disabled; enable from Settings when needed.');
  if (status.enabled && !status.ready) process.exitCode = 1;
} finally { await closeDatabase(); }
