import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newestFirst,
  oldestFirst,
  selectExcessSessions,
  SessionReconciler,
} from '../src/services/sessionReconciler.js';

const sessions = [
  { ikeId: '10', remoteId: 'alice', established: 300 },
  { ikeId: '11', remoteId: 'alice', established: 20 },
  { ikeId: '12', remoteId: 'alice', established: 100 },
];

test('established is interpreted as age: lower is newer', () => {
  assert.deepEqual(newestFirst(sessions).map((s) => s.ikeId), ['11', '12', '10']);
  assert.deepEqual(oldestFirst(sessions).map((s) => s.ikeId), ['10', '12', '11']);
  assert.deepEqual(sessions.map((s) => s.ikeId), ['10', '11', '12'], 'input is not mutated');
});

test('disconnect_oldest keeps newest allowed sessions', () => {
  assert.deepEqual(
    selectExcessSessions(sessions, 1, 'disconnect_oldest').map((s) => s.ikeId),
    ['10', '12'],
  );
});

test('reject_newest keeps oldest allowed sessions', () => {
  assert.deepEqual(
    selectExcessSessions(sessions, 1, 'reject_newest').map((s) => s.ikeId),
    ['11', '12'],
  );
});

test('reconnect overlap is not terminated before grace period', async () => {
  let time = 1_000;
  const terminated = [];
  const reconciler = new SessionReconciler({
    graceMs: 45_000,
    terminate: async (id) => terminated.push(id),
    now: () => time,
  });

  const first = await reconciler.reconcile(sessions.slice(0, 2), { alice: 1 });
  assert.equal(first[0].type, 'grace');
  assert.deepEqual(terminated, []);

  time += 44_999;
  await reconciler.reconcile(sessions.slice(0, 2), { alice: 1 });
  assert.deepEqual(terminated, []);

  time += 1;
  await reconciler.reconcile(sessions.slice(0, 2), { alice: 1 });
  assert.deepEqual(terminated, ['10']);
});

test('startup snapshot safely cleans old duplicate after grace and keeps newest', async () => {
  let time = 10_000;
  const terminated = [];
  const reconciler = new SessionReconciler({
    graceMs: 10_000,
    terminate: async (id) => terminated.push(id),
    now: () => time,
  });
  const startupSnapshot = [
    { ikeId: 'old', remoteId: 'alice', established: 900 },
    { ikeId: 'new', remoteId: 'alice', established: 5 },
  ];

  await reconciler.reconcile(startupSnapshot, { alice: 1 }, 'disconnect_oldest');
  assert.deepEqual(terminated, []);
  time += 10_000;
  await reconciler.reconcile(startupSnapshot, { alice: 1 }, 'disconnect_oldest');
  assert.deepEqual(terminated, ['old']);
});

test('successful termination is idempotent until SA disappears', async () => {
  let time = 1_000;
  const terminated = [];
  const reconciler = new SessionReconciler({
    graceMs: 0,
    terminate: async (id) => terminated.push(id),
    now: () => time,
  });
  const overlap = sessions.slice(0, 2);

  await reconciler.reconcile(overlap, new Map([['alice', 1]]));
  time += 60_000;
  await reconciler.reconcile(overlap, new Map([['alice', 1]]));
  assert.deepEqual(terminated, ['10']);

  await reconciler.reconcile([overlap[1]], new Map([['alice', 1]]));
  await reconciler.reconcile(overlap, new Map([['alice', 1]]));
  assert.deepEqual(terminated, ['10', '10'], 'same id may be acted on after it disappeared and reappeared');
});

test('failed termination is retried only after retry interval', async () => {
  let time = 1_000;
  let attempts = 0;
  const reconciler = new SessionReconciler({
    graceMs: 0,
    retryMs: 30_000,
    terminate: async () => {
      attempts += 1;
      throw new Error('temporary VICI failure');
    },
    now: () => time,
  });

  await reconciler.reconcile(sessions.slice(0, 2), { alice: 1 });
  time += 29_999;
  await reconciler.reconcile(sessions.slice(0, 2), { alice: 1 });
  assert.equal(attempts, 1);
  time += 1;
  await reconciler.reconcile(sessions.slice(0, 2), { alice: 1 });
  assert.equal(attempts, 2);
});
