import test from 'node:test';
import assert from 'node:assert/strict';
import { terminateIkeSession } from '../src/services/sessionTermination.js';

test('a completed termination succeeds and never reads another snapshot', async () => {
  let requested;
  assert.deepEqual(await terminateIkeSession(243, {
    terminate: async id => { requested = id; },
    list: async () => { throw new Error('Should not read'); },
  }), { alreadyGone: false });
  assert.equal(requested, '243');
});

test('a session already gone is an idempotent success', async () => {
  const result = await terminateIkeSession('243', {
    terminate: async () => { throw Object.assign(new Error('Command failed'), { stdout: 'terminate failed: no matching SAs to terminate found\n' }); },
    list: async () => { throw new Error('Not needed'); },
  });
  assert.deepEqual(result, { alreadyGone: true });
});

test('a generic failure is resolved only by a complete fresh snapshot without that IKE SA', async () => {
  const failure = new Error('terminate failed: terminating SA failed');
  const terminate = async () => { throw failure; };
  for (const raw of ['list-sas reply {}',
    'list-sa event {vpn {uniqueid=999 child-sas {vpn {uniqueid=243}}}}\nlist-sas reply {}']) {
    assert.deepEqual(await terminateIkeSession('243', { terminate, list: async () => raw }), { alreadyGone: true });
  }
  for (const raw of ['', 'connection to VICI failed', 'list-sas reply {success=no errmsg=unavailable}',
    'list-sa event {vpn {uniqueid=243 remote-id=alice}}\nlist-sas reply {}']) {
    await assert.rejects(terminateIkeSession('243', { terminate, list: async () => raw }), error => error === failure);
  }
  await assert.rejects(terminateIkeSession('243', { terminate, list: async () => { throw Error('VICI unavailable'); } }), error => error === failure);
});

test('invalid IKE identifiers never reach the privileged helper', async () => {
  for (const id of ['--all', '1;reboot', '', '-2']) {
    await assert.rejects(terminateIkeSession(id, { terminate: async () => assert.fail('Unexpected helper call') }), /Invalid IKE id/);
  }
});
