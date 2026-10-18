import test from 'node:test';
import assert from 'node:assert/strict';
import {accountLifecycle} from '../src/utils/accountLifecycle.js';
import {userStatus} from '../src/utils/format.js';
const now=Date.parse('2026-10-18T12:00:00Z');
test('expired, disabled and exhausted accounts retain the true end reason',()=>{
  const u={enabled:false,expires_at:'2026-10-01T12:00:00Z',usage_total:200,total_limit_bytes:100};
  assert.deepEqual(accountLifecycle(u,now),{ended:true,endedReason:'date_and_traffic',endedAt:'2026-10-01T12:00:00.000Z',endedDays:17,stale:true});
  assert.equal(userStatus(u),'expired');
});
test('daily quotas, not activated and unlimited traffic are not stale subscriptions',()=>{
  for (const u of [{usage_total:20,daily_limit_bytes:10,quota_reason:'daily_quota'},
    {activation_status:'not_activated',duration_days:30}, {unlimited_traffic:true,usage_total:200,total_limit_bytes:100}]) {
    assert.equal(accountLifecycle(u,now).ended,false);
  }
});
test('unknown historical quota dates stay unknown and cannot be selected as stale',()=>{
 const result=accountLifecycle({usage_total:100,total_limit_bytes:100},now);
 assert.equal(result.ended,true);assert.equal(result.endedAt,null);assert.equal(result.stale,false);
});
test('renewing both limits clears stale eligibility; recent exhausted traffic uses its recorded date',()=>{
 const u={enabled:true,usage_total:100,total_limit_bytes:100,expires_at:'2026-12-01',traffic_exhausted_at:'2026-10-10T12:00:00Z'};
 assert.equal(accountLifecycle(u,now).endedDays,8);
 assert.equal(accountLifecycle({...u,total_limit_bytes:200},now).ended,false);
 assert.equal(accountLifecycle({...u,traffic_exhausted_at:'2026-10-17T12:00:00Z'},now).stale,false);
});
