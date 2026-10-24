import { recordDailyActivity } from './dailyActivity.js';
import { ikeCounterDelta } from './ikeCounters.js';

export async function recordIkeSession(client, user, session, today, hour, pollMs) {
    // Match the Xray lock order so resets and simultaneous transports cannot
    // interleave an account balance with an inconsistent cursor update.
    const account = await client.query('SELECT id FROM vpn_users WHERE id=$1 FOR UPDATE', [user.id]);
    if (!account.rows.length) return;
    await recordDailyActivity(client, user.id, today);
    const snap = await client.query('SELECT * FROM sa_snapshots WHERE ike_id=$1 FOR UPDATE', [session.ikeId]);
    const prev = snap.rows[0];
    const { total: deltaTotal, incoming: deltaIn, outgoing: deltaOut, children } = ikeCounterDelta(session, prev, user.id, pollMs);
    await client.query(
      `INSERT INTO sa_snapshots(ike_id,user_id,last_bytes,last_bytes_in,last_bytes_out,last_seen_at,session_identity,child_counters)
       VALUES($1,$2,$3,$4,$5,now(),$6,$7::jsonb) ON CONFLICT(ike_id) DO UPDATE SET user_id=EXCLUDED.user_id,last_bytes=EXCLUDED.last_bytes,
       last_bytes_in=EXCLUDED.last_bytes_in, last_bytes_out=EXCLUDED.last_bytes_out, last_seen_at=now(),
       session_identity=EXCLUDED.session_identity,child_counters=EXCLUDED.child_counters`,
      [session.ikeId, user.id, session.bytesTotal, session.bytesIn, session.bytesOut, session.identity || null, children ? JSON.stringify(children) : null]
    );
    if (deltaTotal > 0) {
      const relayBytes = session.transport === 'ike-relay' ? deltaTotal : 0;
      // strongSwan bytes-in is uploaded by the client; bytes-out is downloaded.
      await client.query('UPDATE vpn_users SET usage_total=usage_total+$1, download_bytes=download_bytes+$2, upload_bytes=upload_bytes+$3, ike_relay_usage_bytes=ike_relay_usage_bytes+$5, updated_at=now() WHERE id=$4', [deltaTotal, deltaOut, deltaIn, user.id, relayBytes]);
      await client.query(`INSERT INTO usage_daily(user_id,usage_date,bytes,ike_relay_bytes) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,usage_date) DO UPDATE SET bytes=usage_daily.bytes+EXCLUDED.bytes, ike_relay_bytes=usage_daily.ike_relay_bytes+EXCLUDED.ike_relay_bytes`, [user.id, today, deltaTotal, relayBytes]);
      await client.query(`INSERT INTO usage_hourly(user_id,hour_ts,bytes,ike_relay_bytes) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,hour_ts) DO UPDATE SET bytes=usage_hourly.bytes+EXCLUDED.bytes, ike_relay_bytes=usage_hourly.ike_relay_bytes+EXCLUDED.ike_relay_bytes`, [user.id, hour, deltaTotal, relayBytes]);
    }
    await client.query(`UPDATE vpn_users SET last_seen_at=now(), last_public_ip=$1::inet, last_virtual_ip=CASE WHEN $2='' THEN last_virtual_ip ELSE $2::inet END WHERE id=$3`, [session.remoteHost || null, session.virtualIp || '', user.id]);
}
