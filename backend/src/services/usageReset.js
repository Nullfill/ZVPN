// Call inside the same transaction as the account update. Retain protocol
// cursors so traffic already billed before a reset cannot be charged again.
export async function resetUsage(client, id) {
  await client.query('UPDATE vpn_users SET usage_total=0, ike_relay_usage_bytes=0, xray_usage_bytes=0, xray_iran_usage_bytes=0, netlify_usage_bytes=0, xray_legacy_usage_bytes=0, upload_bytes=0, download_bytes=0 WHERE id=$1', [id]);
  await client.query('DELETE FROM usage_daily WHERE user_id=$1', [id]);
  await client.query('DELETE FROM usage_hourly WHERE user_id=$1', [id]);
}
