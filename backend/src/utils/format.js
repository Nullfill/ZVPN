export function bytes(v) {
  return v == null || v === '' ? null : Math.max(0, Math.floor(Number(v)));
}

export function tokenExpiry(days) {
  return new Date(Date.now() + days * 86400000);
}

export function userStatus(u) {
  if (u.provisioning_status === 'provisioning') return 'provisioning';
  if (u.provisioning_status === 'failed') return 'failed';
  if (!u.enabled) return 'disabled';
  if (u.quota_blocked) return u.quota_reason === 'daily_quota' ? 'quota_daily' : u.quota_reason === 'total_quota' ? 'quota_total' : 'disabled';
  if (u.activation_status === 'not_activated') return 'not_activated';
  if (u.expires_at && new Date(u.expires_at) <= new Date()) return 'expired';
  if (u.expires_at && (new Date(u.expires_at) - Date.now()) / 86400000 <= 7) return 'expiring_soon';
  return 'active';
}

export function sanitizeUser(u, sessions = []) {
  const online = sessions.filter((s) => s.remoteId === u.username).length;
  return {
    id: u.id, username: u.username, enabled: u.enabled, status: userStatus(u),
    activationStatus: u.activation_status, provisioningStatus: u.provisioning_status,
    provisioningError: u.provisioning_error, expiresAt: u.expires_at, durationDays: u.duration_days,
    firstConnectedAt: u.first_connected_at, dailyLimitBytes: u.daily_limit_bytes == null ? null : Number(u.daily_limit_bytes),
    totalLimitBytes: u.total_limit_bytes == null ? null : Number(u.total_limit_bytes),
    unlimitedTraffic: u.unlimited_traffic, maxDevices: u.max_devices,
    usageTotal: Number(u.usage_total), uploadBytes: Number(u.upload_bytes || 0), downloadBytes: Number(u.download_bytes || 0),
    todayBytes: Number(u.today_bytes || 0),
    remainingTraffic: u.unlimited_traffic || !u.total_limit_bytes ? null : Math.max(0, Number(u.total_limit_bytes) - Number(u.usage_total)),
    remainingDays: u.expires_at ? Math.max(0, Math.ceil((new Date(u.expires_at) - Date.now()) / 86400000)) : null,
    online, lastSeenAt: u.last_seen_at, downloadToken: u.download_token_revoked ? null : u.download_token,
    downloadTokenRevoked: u.download_token_revoked, note: u.note, createdAt: u.created_at, updatedAt: u.updated_at,
  };
}

export function downloadLinks(token) {
  const base = `${process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3300'}`.replace(/\/$/, '') + `/d/${token}`;
  return { landing: base, android: `${base}/android`, ios: `${base}/ios`, windows: `${base}/windows`, windowsLauncher: `${base}/windows-launcher` };
}
