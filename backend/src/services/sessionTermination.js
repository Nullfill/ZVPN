/** A stale session snapshot must not turn an already disconnected SA into an error. */
export async function terminateIkeSession(id, { terminate, list }) {
  const ikeId = String(id);
  if (!/^\d+$/.test(ikeId)) throw new Error('Invalid IKE id');
  try {
    await terminate(ikeId);
    return { alreadyGone: false };
  } catch (error) {
    const output = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
    if (/\bno matching SAs to terminate found\b/i.test(output)) return { alreadyGone: true };
    // A disconnect can finish while swanctl reports a timeout/failure. Only
    // accept that outcome when a fresh, complete VICI snapshot confirms absence.
    // Do not use rawSas(), which turns a failed read into an empty string.
    try {
      const raw = await list();
      if (/\blist-sas reply\s*\{/.test(raw) && !/\blist-sas reply\s*\{[^}]*\bsuccess=no\b/.test(raw)) {
        const exists = raw.split(/\blist-sa event\s*/).slice(1)
          .some(block => /\buniqueid\s*=\s*(\d+)/.exec(block)?.[1] === ikeId);
        if (!exists) return { alreadyGone: true };
      }
    } catch { /* Preserve the original failure when VICI cannot confirm state. */ }
    throw error;
  }
}
