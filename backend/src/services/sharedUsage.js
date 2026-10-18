import { recordDailyActivity } from './dailyActivity.js';
import { counterDelta } from './xrayConfig.js';

export async function recordXrayCounters(client, id, counter, epoch, today, hour) {
  // Lock the account, then the cursor: concurrent sync/worker cannot double charge.
  const { rows } = await client.query('SELECT * FROM vpn_users WHERE id=$1 FOR UPDATE', [id]);
  if (!rows.length) return;
  const user = rows[0];
  const previous = (await client.query('SELECT * FROM xray_usage_snapshots WHERE user_id=$1', [id])).rows[0];
  const sameEpoch = previous?.epoch === epoch;
  const upload = counterDelta(counter.uplink, previous?.uplink, sameEpoch);
  const download = counterDelta(counter.downlink, previous?.downlink, sameEpoch);
  const total = upload + download;
  if (total > 0n) {
    await recordDailyActivity(client, id, today);
    // One shared balance. A second protocol never grants a second allowance.
    await client.query(`UPDATE vpn_users SET usage_total=usage_total+$2, xray_usage_bytes=xray_usage_bytes+$2,
      upload_bytes=upload_bytes+$3, download_bytes=download_bytes+$4, last_seen_at=now(),
      first_connected_at=COALESCE(first_connected_at,now()), activation_status='activated',
      expires_at=CASE WHEN first_connected_at IS NULL AND duration_days IS NOT NULL AND expires_at IS NULL
        THEN now()+duration_days*interval '1 day' ELSE expires_at END, updated_at=now() WHERE id=$1`,
    [id, total.toString(), upload.toString(), download.toString()]);
    await client.query(`INSERT INTO usage_daily(user_id,usage_date,bytes) VALUES($1,$2,$3)
      ON CONFLICT(user_id,usage_date) DO UPDATE SET bytes=usage_daily.bytes+EXCLUDED.bytes`, [id, today, total.toString()]);
    await client.query(`INSERT INTO usage_hourly(user_id,hour_ts,bytes) VALUES($1,$2,$3)
      ON CONFLICT(user_id,hour_ts) DO UPDATE SET bytes=usage_hourly.bytes+EXCLUDED.bytes`, [id, hour, total.toString()]);
  }
  await client.query(`INSERT INTO xray_usage_snapshots(user_id,epoch,uplink,downlink) VALUES($1,$2,$3,$4)
    ON CONFLICT(user_id) DO UPDATE SET epoch=EXCLUDED.epoch,uplink=EXCLUDED.uplink,downlink=EXCLUDED.downlink,updated_at=now()`,
  [user.id, epoch, counter.uplink.toString(), counter.downlink.toString()]);
}
