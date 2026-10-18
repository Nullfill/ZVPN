export function accountLifecycle(user, now = Date.now()) {
  const expires = user.expires_at ? new Date(user.expires_at).getTime() : NaN;
  const expired = Number.isFinite(expires) && expires <= now;
  const exhausted = !user.unlimited_traffic && Number(user.total_limit_bytes)>0 && Number(user.usage_total)>=Number(user.total_limit_bytes);
  const trafficDate = exhausted && user.traffic_exhausted_at ? new Date(user.traffic_exhausted_at).getTime() : NaN;
  const dates = [expired ? expires : NaN, trafficDate].filter(Number.isFinite).filter(d=>d<=now);
  const endedAt = dates.length ? new Date(Math.min(...dates)).toISOString() : null;
  const endedDays = endedAt ? Math.floor((now-new Date(endedAt).getTime())/86400000) : null;
  return {ended:expired||exhausted, endedReason:expired&&exhausted?'date_and_traffic':expired?'date':exhausted?'traffic':null,
    endedAt, endedDays, stale:endedDays!==null && endedDays>=7};
}
