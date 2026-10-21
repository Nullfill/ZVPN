import { connectionLinks } from './netlifyConfig.js';

const bytes = value => {
  try { const n = BigInt(value || 0); return n > 0n ? n : 0n; } catch { return 0n; }
};
export function subscriptionInfo(user, now = Date.now()) {
  const used = bytes(user.usage_total);
  const total = user.unlimited_traffic ? 0n : bytes(user.total_limit_bytes);
  const remaining = total > used ? total - used : 0n;
  const volume = user.unlimited_traffic || !total ? 'حجم نامحدود' : `حجم باقی: ${(Number(remaining) / 1024 ** 3).toFixed(2)} GB`;
  const expiry = user.expires_at ? Math.floor(new Date(user.expires_at).getTime() / 1000) : 0;
  const days = expiry ? Math.max(0, Math.ceil((expiry * 1000 - now) / 86400000)) : null;
  const time = days !== null ? (days ? `اعتبار: ${days} روز` : 'اعتبار تمام شده')
    : user.duration_days ? `${user.duration_days} روز پس از اولین اتصال` : 'بدون انقضای زمانی';
  const label = `ℹ️ ${volume} | ${time}`;
  // A clearly labelled, non-routable information row for clients that ignore
  // subscription-userinfo. Never send this entry to the server or provision it.
  const row = `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:9?encryption=none&type=tcp#${encodeURIComponent(label)}`;
  const upload = bytes(user.upload_bytes) > used ? used : bytes(user.upload_bytes);
  return { label, row, userinfo: `upload=${upload}; download=${used - upload}; total=${total}; expire=${expiry}` };
}

export function subscriptionLinks(user, baseUrl, settings, now = Date.now()) {
  const links = connectionLinks(user, baseUrl, settings);
  return links.length ? [...links, subscriptionInfo(user, now).row] : [];
}
