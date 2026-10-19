import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

process.env.DATABASE_URL ||= 'postgres://localhost/zvpn_test';
process.env.JWT_SECRET ||= 'test-jwt-secret-test-jwt-secret-test-jwt-secret';
process.env.MASTER_KEY ||= 'test-master-key-test-master-key-test-master-key';

test('read-only optional WARP policy keeps IKE sync and the existing Xray service running', async (t) => {
  const { buildXrayConfig } = await import('../src/services/xrayConfig.js');
  const { db } = await import('../src/db.js');
  const calls = [];
  const fakeExec = () => {};
  fakeExec[promisify.custom] = async (_command, args) => {
    calls.push(args[1]);
    return { stdout: args[1] === 'xray-epoch' ? 'test-running-epoch' : '', stderr: '' };
  };
  const originalExec = childProcess.execFile;
  childProcess.execFile = fakeExec;
  syncBuiltinESMExports();
  t.after(() => { childProcess.execFile = originalExec; t.mock.restoreAll(); syncBuiltinESMExports(); });
  // Node 20's module loader also uses fs.promises.readFile: finish imports
  // before replacing that method with the runtime-file fixture.
  const { syncSecretsNow } = await import('../src/services/syncQueue.js');
  t.mock.method(db, 'query', async () => ({ rows: [], rowCount: 0 }));
  t.mock.method(fs, 'access', async () => {});
  t.mock.method(fs, 'readFile', async path => String(path).endsWith('/xray.json')
    ? JSON.stringify(buildXrayConfig([]), null, 2) + '\n' : '');
  t.mock.method(fs, 'writeFile', async path => {
    if (String(path).endsWith('/warp.json.tmp')) throw Object.assign(new Error('Read-only file system'), { code: 'EROFS' });
  });
  t.mock.method(fs, 'rename', async () => {});
  t.mock.method(fs, 'rm', async () => {});
  await assert.rejects(syncSecretsNow(), error => error.code === 'EROFS' && error.optionalWarp === true);
  assert.ok(calls.includes('sync-secrets'));
  assert.ok(calls.includes('normalize-conn'));
  assert.equal(calls.includes('stop-xray'), false);
  assert.equal(calls.includes('sync-xray'), false);
});
