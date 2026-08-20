export function fmtBytes(n = 0): string {
  let value = Number(n) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index < 2 ? 0 : 2)} ${units[index]}`;
}

export function fmtDate(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function fmtPercent(value?: number | null, digits = 0): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

export function gbToBytes(v: string | number | null | undefined): number | null {
  if (v === '' || v == null) return null;
  return Math.round(Number(v) * 1024 ** 3);
}

export function bytesToGb(v?: number | null): string {
  if (v == null) return '';
  return (Number(v) / 1024 ** 3).toFixed(2).replace(/\.00$/, '');
}

export function statusLabel(s: string): string {
  const map: Record<string, string> = {
    active: 'فعال',
    disabled: 'غیرفعال',
    expired: 'منقضی',
    not_activated: 'فعال نشده',
    provisioning: 'در حال ساخت',
    failed: 'خطا',
    quota_daily: 'سقف روزانه',
    quota_total: 'سقف کل',
    expiring_soon: 'نزدیک انقضا',
  };
  return map[s] || s;
}

export function statusBadge(s: string): string {
  if (s === 'active') return 'badge-ok';
  if (['expiring_soon', 'quota_daily', 'quota_total', 'provisioning'].includes(s)) return 'badge-warn';
  if (['disabled', 'expired', 'failed'].includes(s)) return 'badge-bad';
  return 'badge-muted';
}
