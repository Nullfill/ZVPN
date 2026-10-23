import { recordDailyActivity } from './dailyActivity.js';

export async function recordIkeSession(client, user, session, today, hour, pollMs) {
    await recordDailyActivity(client, user.id, today);
    const snap = await client.query('SELECT last_bytes, last_bytes_in, last_bytes_out FROM sa_snapshots WHERE ike_id=$1 FOR UPDATE', [session.ikeId]);
    const prev = snap.rows[0];
    const prevTotal = prev?.last_bytes;
    const prevIn = Number(prev?.last_bytes_in || 0);
    const prevOut = Number(prev?.last_bytes_out || 0);
    const deltaTotal = prevTotal == null
      ? (session.established <= Math.ceil(pollMs / 1000) * 2 ? session.bytesTotal : 0)
      : (session.bytesTotal >= Number(prevTotal) ? session.bytesTotal - Number(prevTotal) : session.bytesTotal);
    const deltaIn = session.bytesIn >= prevIn ? session.bytesIn - prevIn : session.bytesIn;
    const deltaOut = session.bytesOut >= prevOut ? session.bytesOut - prevOut : session.bytesOut;
    await client.query(
      `INSERT INTO sa_snapshots(ike_id,user_id,last_bytes,last_bytes_in,last_bytes_out,last_seen_at)
       VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(ike_id) DO UPDATE SET last_bytes=EXCLUDED.last_bytes,
       last_bytes_in=EXCLUDED.last_bytes_in, last_bytes_out=EXCLUDED.last_bytes_out, last_seen_at=now()`,
      [session.ikeId, user.id, session.bytesTotal, session.bytesIn, session.bytesOut]
    );
    if (deltaTotal > 0) {
      const relayBytes = session.transport === 'ike-relay' ? deltaTotal : 0;
      await client.query('UPDATE vpn_users SET usage_total=usage_total+$1, download_bytes=download_bytes+$2, upload_bytes=upload_bytes+$3, ike_relay_usage_bytes=ike_relay_usage_bytes+$5, updated_at=now() WHERE id=$4', [deltaTotal, deltaIn, deltaOut, user.id, relayBytes]);
      await client.query(`INSERT INTO usage_daily(user_id,usage_date,bytes,ike_relay_bytes) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,usage_date) DO UPDATE SET bytes=usage_daily.bytes+EXCLUDED.bytes, ike_relay_bytes=usage_daily.ike_relay_bytes+EXCLUDED.ike_relay_bytes`, [user.id, today, deltaTotal, relayBytes]);
      await client.query(`INSERT INTO usage_hourly(user_id,hour_ts,bytes,ike_relay_bytes) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,hour_ts) DO UPDATE SET bytes=usage_hourly.bytes+EXCLUDED.bytes, ike_relay_bytes=usage_hourly.ike_relay_bytes+EXCLUDED.ike_relay_bytes`, [user.id, hour, deltaTotal, relayBytes]);
    }
    await client.query(`UPDATE vpn_users SET last_seen_at=now(), last_public_ip=$1::inet, last_virtual_ip=CASE WHEN $2='' THEN last_virtual_ip ELSE $2::inet END WHERE id=$3`, [session.remoteHost || null, session.virtualIp || '', user.id]);
}
