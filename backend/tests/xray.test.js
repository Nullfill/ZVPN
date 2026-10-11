import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { buildXrayConfig, xrayLink, parseXrayStats, counterDelta, eligibleUser } from '../src/services/xrayConfig.js';

process.env.DATABASE_URL ||= 'postgres://localhost/zvpn_test';
process.env.JWT_SECRET ||= 'test-jwt-secret-test-jwt-secret-test-jwt-secret';
process.env.MASTER_KEY ||= 'test-master-key-test-master-key-test-master-key';
const { encryptBackup, backupParts } = await import('../src/services/fullBackup.js');
const user = { id: '11111111-1111-4111-8111-111111111111', xray_uuid: '22222222-2222-4222-8222-222222222222', username: 'existing', enabled: true, quota_blocked: false, expires_at: '2030-01-01' };

test('only eligible accounts are provisioned and their UUID survives rebuilds', () => {
  const users = [user, {...user, enabled:false}, {...user,quota_blocked:true}, {...user,expires_at:'2020-01-01'}];
  const config = buildXrayConfig(users);
  assert.equal(config.inbounds[1].settings.clients.length, 1);
  assert.equal(config.inbounds[1].settings.clients[0].id,user.xray_uuid);
  assert.equal(buildXrayConfig(users).inbounds[1].settings.clients[0].id,user.xray_uuid);
  assert.equal(config.inbounds[1].listen,'127.0.0.1');
  assert.equal(buildXrayConfig(users,false).inbounds[1].settings.clients.length,0);
});

test('share link reuses HTTPS domain and rejects an insecure/IP-only endpoint', () => {
  const link = xrayLink(user,'https://vpn.example.com');
  assert.ok(link.startsWith(`vless://${user.xray_uuid}@vpn.example.com:443?`));
  assert.ok(link.includes('security=tls') && link.includes('type=xhttp'));
  assert.throws(()=>xrayLink(user,'http://vpn.example.com'));
  assert.throws(()=>xrayLink(user,'https://127.0.0.1'));
});

test('stats preserve 64-bit counters and ignore unrelated inbound/system stats', () => {
  const stats=parseXrayStats({stat:[{name:`user>>>zvpn-${user.id}>>>traffic>>>uplink`,value:'9007199254740993'},
    {name:`user>>>zvpn-${user.id}>>>traffic>>>downlink`,value:'50'},{name:'inbound>>>tag>>>traffic>>>uplink',value:'999'}]});
  assert.equal(stats.size,1);assert.equal(stats.get(user.id).uplink,9007199254740993n);
  assert.equal(counterDelta('9007199254740993','9007199254740992',true),1n);
  assert.equal(counterDelta(30,500,false),30n);
  assert.throws(()=>counterDelta(30,500,true));
});

test('full backup encryption authenticates bytes and fails on modification/wrong password', () => {
  const original=Buffer.from('existing certificate and database bytes');
  const sealed=encryptBackup(original,'independent-recovery-passphrase');
  const open=(password,data=sealed)=>{
    const key=scryptSync(password,data.subarray(8,24),32);
    const cipher=createDecipheriv('aes-256-gcm',key,data.subarray(24,36));cipher.setAuthTag(data.subarray(36,52));
    return Buffer.concat([cipher.update(data.subarray(52)),cipher.final()]);
  };
  assert.deepEqual(open('independent-recovery-passphrase'),original);
  assert.throws(()=>open('wrong'));
  const altered=Buffer.from(sealed);altered[altered.length-1]^=1;
  assert.throws(()=>open('independent-recovery-passphrase',altered));
  assert.deepEqual(encryptBackup(original,''),original);
  assert.deepEqual(Buffer.concat(backupParts(sealed,17)),sealed);
});
