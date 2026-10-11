import { syncSecrets as doSync } from '../vpn.js';
import { syncXray, stopXray, xrayAvailable } from './xray.js';
import { db } from '../db.js';

let pending = false;
let running = false;
let lastError = null;
let lastSuccess = null;
let tail = Promise.resolve();
let queued = 0;
let retryTimer = null;

function enqueueSync() {
  queued += 1;
  pending = queued > 0;
  const job = tail.then(async () => {
    queued -= 1;
    pending = queued > 0;
    running = true;
    try {
      await doSync();
      await syncXray();
      await db.query(`UPDATE vpn_users SET provisioning_status='active', provisioning_error=NULL WHERE provisioning_status IN ('provisioning','failed')`);
      lastError = null;
      lastSuccess = Date.now();
      clearTimeout(retryTimer);
      retryTimer = null;
    } catch (e) {
      lastError = e.message;
      if (await xrayAvailable()) await stopXray().catch(() => {});
      console.error('[sync-queue]', e.message);
      if (!retryTimer) retryTimer = setTimeout(() => {
        retryTimer = null;
        enqueueSync().catch(() => {});
      }, 15000).unref();
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
export async function syncSecretsNow(timeoutMs = 60000) {
  let timer;
  try {
    return await Promise.race([enqueueSync(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('sync timeout')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export function syncStatus() {
  return { running, pending, lastError, lastSuccess };
}
