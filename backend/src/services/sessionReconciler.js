/**
 * Reconciles the IKE_SAs reported by strongSwan with the panel's
 * max-devices policy.
 *
 * strongSwan reports `established` as the age of the SA in seconds.  A
 * smaller value is therefore newer; sorting by this field in ascending order
 * gives newest-first and descending gives oldest-first.  Keeping this logic
 * here (instead of in the poller) prevents the old/new inversion from being
 * reintroduced by another caller.
 */

function ageOf(session) {
  const value = Number(session?.established);
  return Number.isFinite(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER;
}

function idOf(session) {
  return String(session?.ikeId ?? '');
}

function numericOrStrCompare(a, b) {
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isFinite(numA) && Number.isFinite(numB)) {
    return numA - numB;
  }
  return String(a).localeCompare(String(b));
}

/** Return a stable copy sorted newest first. */
export function newestFirst(sessions) {
  return [...sessions].sort((a, b) => ageOf(a) - ageOf(b) || numericOrStrCompare(idOf(b), idOf(a)));
}

/** Return a stable copy sorted oldest first. */
export function oldestFirst(sessions) {
  return [...sessions].sort((a, b) => ageOf(b) - ageOf(a) || numericOrStrCompare(idOf(a), idOf(b)));
}

/**
 * Select sessions to terminate once `sessions.length > maxDevices`.
 * `disconnect_oldest` keeps the newest sessions and removes the oldest ones;
 * `reject_newest` does the inverse.  The result is deterministic.
 */
export function selectExcessSessions(sessions, maxDevices, policy = 'disconnect_oldest') {
  const max = Math.max(1, Number(maxDevices) || 1);
  if (!Array.isArray(sessions) || sessions.length <= max) return [];
  const excess = sessions.length - max;
  const sorted = newestFirst(sessions);
  return policy === 'reject_newest'
    ? sorted.slice(0, excess)
    : oldestFirst(sessions).slice(0, excess);
}

/**
 * Stateful, idempotent reconciler.  A user must remain over the limit for
 * `graceMs` before an SA is terminated.  Successful termination commands are
 * remembered until the SA disappears from a later snapshot, so a slow
 * strongSwan response cannot result in repeated terminate commands.
 */
export class SessionReconciler {
  constructor({
    graceMs = 45000,
    retryMs = 30000,
    terminate,
    loadState,
    saveState,
    deleteState,
    now = () => Date.now(),
  } = {}) {
    if (typeof terminate !== 'function') throw new TypeError('terminate function is required');
    this.graceMs = Math.max(0, Number(graceMs) || 0);
    this.retryMs = Math.max(1000, Number(retryMs) || 1000);
    this.terminate = terminate;
    this.loadState = typeof loadState === 'function' ? loadState : null;
    this.saveState = typeof saveState === 'function' ? saveState : null;
    this.deleteState = typeof deleteState === 'function' ? deleteState : null;
    this.now = now;
    this.users = new Map();
  }

  /**
   * Reconcile one complete swanctl snapshot.
   * @param {Array<object>} sessions
   * @param {Map<string, number>|object|function} limits max devices by user
   * @param {string} policy
   * @returns {Promise<Array<object>>} actions (grace/terminate/retry/error)
   */
  async reconcile(sessions, limits, policy = 'disconnect_oldest') {
    const now = this.now();
    const byUser = new Map();
    for (const session of Array.isArray(sessions) ? sessions : []) {
      const username = String(session?.remoteId || '').trim();
      const ikeId = idOf(session);
      if (!username || !ikeId) continue;
      if (!byUser.has(username)) byUser.set(username, []);
      byUser.get(username).push(session);
    }
    const actions = [];

    // Drop state for users which no longer have SAs and forget SAs that have
    // disappeared.  This also permits a future reconnect using the same IKE
    // id (rare, but possible after a daemon restart).
    for (const [username, state] of this.users) {
      const current = new Set((byUser.get(username) || []).map(idOf));
      for (const id of state.terminations.keys()) if (!current.has(id)) state.terminations.delete(id);
      if (!byUser.has(username)) this.users.delete(username);
      if (!byUser.has(username) && this.deleteState) await this.deleteState(username).catch(() => {});
    }

    for (const [username, mine] of byUser) {
      const max = resolveLimit(limits, username);
      if (mine.length <= max) {
        this.users.delete(username);
        if (this.deleteState) await this.deleteState(username).catch(() => {});
        continue;
      }
      let state = this.users.get(username);
      if (!state) {
        const persisted = this.loadState ? await this.loadState(username).catch(() => null) : null;
        const since = persisted?.overLimitSince instanceof Date
          ? persisted.overLimitSince.getTime()
          : (typeof persisted?.overLimitSince === 'string'
            ? Date.parse(persisted.overLimitSince)
            : Number(persisted?.overLimitSince || now));
        state = { overLimitSince: Number.isFinite(since) ? since : now, terminations: new Map() };
        this.users.set(username, state);
      }
      const age = now - state.overLimitSince;
      if (age < this.graceMs) {
        actions.push({ type: 'grace', username, count: mine.length, max, remainingMs: this.graceMs - age });
        continue;
      }

      const extras = selectExcessSessions(mine, max, policy);
      for (const session of extras) {
        const ikeId = idOf(session);
        const previous = state.terminations.get(ikeId);
        if (previous?.ok) continue;
        if (previous && now - previous.at < this.retryMs) continue;
        try {
          await this.terminate(ikeId);
          state.terminations.set(ikeId, { ok: true, at: now });
          actions.push({ type: 'terminate', username, ikeId, policy });
        } catch (error) {
          state.terminations.set(ikeId, { ok: false, at: now });
          actions.push({ type: 'terminate_error', username, ikeId, error });
        }
      }
      if (this.saveState) await this.saveState(username, {
        overLimitSince: new Date(state.overLimitSince), lastSeenAt: new Date(now),
      }).catch(() => {});
    }
    return actions;
  }

  clear() {
    this.users.clear();
  }
}

function resolveLimit(limits, username) {
  let value;
  if (typeof limits === 'function') value = limits(username);
  else if (limits instanceof Map) value = limits.get(username);
  else value = limits?.[username];
  return Math.max(1, Number(value) || 1);
}
