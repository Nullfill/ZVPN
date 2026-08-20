import { syncSecrets as doSync } from '../vpn.js';

let pending = false;
let running = false;
let lastError = null;
let lastSuccess = null;
let tail = Promise.resolve();
let queued = 0;

function enqueueSync() {
  queued += 1;
  pending = queued > 0;
  const job = tail.then(async () => {
    queued -= 1;
    pending = queued > 0;
    running = true;
    try {
      await doSync();
      lastError = null;
      lastSuccess = Date.now();
    } catch (e) {
      lastError = e.message;
      console.error('[sync-queue]', e.message);
      throw e;
    } finally {
      running = false;
      pending = queued > 0;
    }
  });
  // Keep the serialization chain usable after an individual failure while
  // returning the original promise so blocking callers still see the error.
  tail = job.catch(() => {});
  return job;
}

/** Non-blocking secret sync — PATCH/POST won't hang on sudo/helper */
export function queueSyncSecrets() {
  setImmediate(() => enqueueSync().catch(() => {}));
}

/** Blocking sync for provisioning — with timeout */
export async function syncSecretsNow(timeoutMs = 15000) {
  return Promise.race([
    enqueueSync(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('sync timeout')), timeoutMs)),
  ]);
}

export function syncStatus() {
  return { running, pending, lastError, lastSuccess };
}
