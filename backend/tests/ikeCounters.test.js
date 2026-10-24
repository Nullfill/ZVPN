import test from 'node:test';
import assert from 'node:assert/strict';
import { ikeCounterDelta } from '../src/services/ikeCounters.js';
import { parseSas } from '../src/services/saParser.js';

const session = (bytesIn, bytesOut, extra = {}) => ({ bytesIn, bytesOut, established: 2, identity: 'boot-a', ...extra });
const snapshot = (extra = {}) => ({ user_id: 'alice', session_identity: 'boot-a', last_bytes_in: 100, last_bytes_out: 200, ...extra });

test('IKE_AUTH attempts never activate an account or count as online', () => {
  const raw = state => `list-sa event {ikev2-vpn {uniqueid=1 state=${state} remote-id=alice child-sas {}}}`;
  assert.deepEqual(parseSas(raw('CONNECTING')), []);
  assert.equal(parseSas(raw('ESTABLISHED')).length, 1);
});

test('counter baseline and total/directions agree after a panel restart', () => {
  const baseline = ikeCounterDelta(session(1000, 5000, { established: 400 }), null, 'alice', 15000);
  assert.equal(baseline.total, 0);
  assert.equal(baseline.incoming + baseline.outgoing, 0);
  const next = ikeCounterDelta(session(110, 240), snapshot(), 'alice', 15000);
  assert.deepEqual([next.incoming, next.outgoing, next.total], [10, 40, 50]);
});

test('reused IKE identifiers cannot inherit another account or daemon cursor', () => {
  for (const previous of [snapshot({ user_id: 'bob' }), snapshot({ session_identity: 'boot-old' })]) {
    assert.equal(ikeCounterDelta(session(10, 20), previous, 'alice', 15000).total, 30);
  }
});

test('CHILD rekey overlap, retirement and reappearance do not double-charge', () => {
  const a = { key: 'a', bytesIn: 100, bytesOut: 200 };
  const b = { key: 'b', bytesIn: 10, bytesOut: 20 };
  let prev = snapshot({ child_counters: { a: { bytesIn: 100, bytesOut: 200 } } });
  let delta = ikeCounterDelta(session(110, 220, { children: [a, b] }), prev, 'alice', 15000);
  assert.equal(delta.total, 30);
  prev = snapshot({ child_counters: delta.children });
  delta = ikeCounterDelta(session(10, 20, { children: [b] }), prev, 'alice', 15000);
  assert.equal(delta.total, 0);
  delta = ikeCounterDelta(session(110, 220, { children: [a, b] }), snapshot({ child_counters: delta.children }), 'alice', 15000);
  assert.equal(delta.total, 0);
});

test('upgrading legacy aggregate cursors charges only the new bytes', () => {
  const next = ikeCounterDelta(session(110, 240, { children: [{ key: 'a', bytesIn: 110, bytesOut: 240 }] }), snapshot(), 'alice', 15000);
  assert.equal(next.total, 50);
  assert.equal(ikeCounterDelta(session(110, 240, { children: [{ key: 'a', bytesIn: 110, bytesOut: 240 }] }), snapshot({ child_counters: next.children }), 'alice', 15000).total, 0);
});

test('parser retains CHILD SPIs and IKE identity separately', () => {
  const s = parseSas('list-sa event {ikev2-vpn {uniqueid=41 state=ESTABLISHED remote-id=alice initiator-spi=aaa responder-spi=bbb child-sas {child {uniqueid=99 spi-in=ccc spi-out=ddd bytes-in=5 bytes-out=7}}}}')[0];
  assert.equal(s.identity, 'aaa:bbb');
  assert.deepEqual(s.children, [{ key: 'ccc:ddd', bytesIn: 5, bytesOut: 7 }]);
});
