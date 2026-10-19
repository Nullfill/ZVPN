import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, RefreshCw, Save, Search } from 'lucide-react';
import { api } from '../lib/api';
import { fmtBytes, fmtDate } from '../lib/format';
import { GlassCard } from './UI';
import { useToast } from './Toast';

type Policy = { enabled: boolean; scope: 'all' | 'selected'; userIds: string[]; domains: string[];
  excludedDomains: string[]; failureMode: 'block' | 'direct'; disableQuic: boolean };
type Status = { installed: boolean; state: string; healthy?: boolean; stale: boolean; totalBytes: number;
  todayBytes: number; uplinkBytes?: number; downlinkBytes?: number; country?: string; exitIp?: string;
  latencyMs?: number; updatedAt?: string; checkedAt?: string; activeIkeSessions?: number; error?: string;
  daily?: Record<string, number> };
const preset = ['gemini.google.com', 'gemini.google', 'bard.google.com', 'aistudio.google.com',
  'makersuite.google.com', 'ai.google.dev', 'alkalicore-pa.clients6.google.com',
  'alkalimakersuite-pa.clients6.google.com', 'webchannel-alkalimakersuite-pa.clients6.google.com',
  'geminiweb-pa.clients.google.com', 'geminiweb-pa.clients6.google.com', 'accounts.google.com',
  'apis.google.com', 'ogs.google.com', 'googleapis.com', 'googleusercontent.com', 'gstatic.com'];
const lines = (value: string) => [...new Set(value.split(/[\s,،]+/).map(x => x.trim().toLowerCase()).filter(Boolean))];

export default function WarpSettings() {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<Policy | null>(null);
  const [domains, setDomains] = useState('');
  const [excluded, setExcluded] = useState('');
  const [search, setSearch] = useState('');
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<{ settings: { warp: Policy } }>('/api/settings') });
  const status = useQuery({ queryKey: ['warp-status'], queryFn: () => api<Status>('/api/warp/status'), refetchInterval: 10000 });
  const users = useQuery({ queryKey: ['warp-users'], queryFn: () => api<{ users: { id: string; username: string }[] }>('/api/warp/users') });
  useEffect(() => {
    if (!form && settings.data?.settings.warp) {
      const policy = settings.data.settings.warp;
      setForm(policy); setDomains(policy.domains.join('\n')); setExcluded(policy.excludedDomains.join('\n'));
    }
  }, [settings.data, form]);
  const save = useMutation({
    mutationFn: () => api('/api/settings/warp', { method: 'PATCH', body: JSON.stringify({ ...form,
      domains: lines(domains), excludedDomains: lines(excluded) }) }),
    onSuccess: () => { toast('تنظیمات WARP ذخیره و اعمال شد.', 'success'); qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['warp-status'] }); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const reconnect = useMutation({ mutationFn: () => api('/api/warp/reconnect', { method: 'POST', body: '{}' }),
    onSuccess: () => { toast('درخواست اتصال مجدد ارسال شد؛ وضعیت تا ۳۰ ثانیه به‌روز می‌شود.', 'success'); qc.invalidateQueries({ queryKey: ['warp-status'] }); },
    onError: (e: Error) => toast(e.message, 'error') });
  if (!form) return <GlassCard>در حال دریافت تنظیمات…</GlassCard>;
  const s = status.data;
  const states: Record<string, string> = { connected: 'متصل', disabled: 'خاموش', degraded: 'اتصال ناموفق', error: 'خطا', not_ready: 'آماده نیست' };
  const daily = Object.entries(s?.daily || {}).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7);
  return <div className="space-y-5">
    <GlassCard className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Cloud className="text-cyan-400" /><div><h3 className="font-bold text-lg">مسیر انتخابی WARP</h3><p className="text-muted text-xs mt-1">برای اتصال‌های IKEv2 و Xray؛ سایر سایت‌ها مستقیم باز می‌شوند.</p></div></div>
        <span className={`badge ${s?.healthy && !s.stale && s.state === 'connected' ? 'badge-ok' : 'badge-warn'}`}>{s?.stale ? 'وضعیت قدیمی' : states[s?.state || 'not_ready'] || s?.state}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['مصرف امروز', fmtBytes(s?.todayBytes)], ['کل مصرف ثبت‌شده', fmtBytes(s?.totalBytes)], ['ارسال', fmtBytes(s?.uplinkBytes)], ['دریافت', fmtBytes(s?.downlinkBytes)]].map(([label, value]) =>
          <div key={label} className="rounded-xl border border-[var(--line)] p-4"><p className="text-muted text-xs">{label}</p><p dir="ltr" className="font-bold text-xl mt-2 text-right">{value}</p></div>)}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
        <span>IP خروجی: <b dir="ltr">{s?.exitIp || '—'}</b></span><span>کشور: {s?.country || '—'}</span>
        <span>زمان پاسخ آزمایش: {s?.latencyMs ?? '—'} ms</span><span>سشن IKE مشمول: {s?.activeIkeSessions ?? 0}</span>
      </div>
      <p className="text-xs text-muted">آخرین بررسی اتصال: {fmtDate(s?.checkedAt)} · آمار ترافیک واقعی عبوری از WARP است و دوباره از سهمیه کاربر کم نمی‌شود. آمار از زمان فعال‌سازی ثبت می‌شود؛ هنگام قطع ناگهانی ممکن است چند ثانیه آخر ثبت نشود.</p>
      {s?.error && <p className="text-sm text-amber-400 break-words" dir="ltr">{s.error}</p>}
      {status.isError && <p className="text-amber-400 text-sm">دریافت وضعیت ناموفق بود؛ دسترسی یا سرویس را بررسی کنید.</p>}
      {s && !s.installed && <p className="text-amber-400 text-sm">WARP روی این سرور نصب نیست؛ نصب اختیاری باید توسط مدیر سرور انجام شود.</p>}
      <button className="btn-ghost" disabled={!s?.installed || reconnect.isPending} onClick={() => reconnect.mutate()}><RefreshCw size={16} /> اتصال مجدد</button>
    </GlassCard>
    <GlassCard className="space-y-5">
      <label className="flex items-center gap-3 font-bold"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} /> فعال‌سازی مسیر WARP</label>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="space-y-2"><label className="block font-bold text-sm" htmlFor="warp-domains">سایت‌های مشمول</label>
          <p className="text-xs text-muted">هر خط یک دامنه، بدون https یا مسیر؛ زیردامنه‌های آن هم شامل می‌شوند.</p>
          <textarea id="warp-domains" className="input w-full min-h-64 font-mono text-xs" dir="ltr" value={domains} onChange={e => setDomains(e.target.value)} />
          <button className="btn-ghost text-xs" onClick={() => setDomains([...new Set([...lines(domains), ...preset])].join('\n'))}>افزودن مجموعه Gemini و سرویس‌های لازم</button>
        </div>
        <div className="space-y-2"><label className="block font-bold text-sm" htmlFor="warp-excluded">سایت‌های مستثنا</label>
          <p className="text-xs text-muted">این دامنه‌ها همیشه مستقیم می‌روند و بر فهرست مشمول اولویت دارند.</p>
          <textarea id="warp-excluded" className="input w-full min-h-64 font-mono text-xs" dir="ltr" value={excluded} onChange={e => setExcluded(e.target.value)} placeholder="example.com" />
          <p className="text-xs text-muted">سرویس‌های ورود، googleapis، gstatic و googleusercontent بین چند محصول گوگل مشترک‌اند؛ با مجموعه Gemini، ترافیک آن‌ها هم از WARP عبور می‌کند.</p>
        </div>
      </div>
      <div className="space-y-3"><label className="block font-bold text-sm" htmlFor="warp-scope">کاربران مشمول</label>
        <select id="warp-scope" className="input" value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value as Policy['scope'] })}><option value="all">همه کاربران، شامل کاربران جدید</option><option value="selected">فقط کاربران انتخاب‌شده</option></select>
        {form.scope === 'selected' && <div className="space-y-3 rounded-xl border border-[var(--line)] p-4">
          <div className="flex items-center gap-2"><Search size={16} /><input className="input w-full" placeholder="جستجوی نام کاربری" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <p className="text-xs text-muted">{form.userIds.length} کاربر انتخاب شده</p>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-auto">{users.data?.users.filter(u => u.username.toLowerCase().includes(search.toLowerCase())).map(u =>
            <label key={u.id} className="flex gap-2 items-center min-w-0"><input type="checkbox" checked={form.userIds.includes(u.id)} onChange={e => setForm({ ...form, userIds: e.target.checked ? [...form.userIds, u.id] : form.userIds.filter(id => id !== u.id) })} /><span className="truncate" dir="ltr">{u.username}</span></label>)}</div>
          {users.isError && <p className="text-amber-400 text-sm">فهرست کاربران دریافت نشد.</p>}
        </div>}
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <label className="space-y-2"><span className="block font-bold text-sm">هنگام قطع WARP</span><select className="input w-full" value={form.failureMode} onChange={e => setForm({ ...form, failureMode: e.target.value as Policy['failureMode'] })}><option value="block">سایت‌های مشمول قطع بمانند</option><option value="direct">موقتاً از اینترنت مستقیم سرور استفاده شود</option></select><span className="block text-xs text-muted">این انتخاب روی سایت‌های دیگر و اتصال SSH اثر ندارد.</span></label>
        <label className="space-y-2"><span className="flex gap-2 items-center font-bold text-sm"><input type="checkbox" checked={form.disableQuic} onChange={e => setForm({ ...form, disableQuic: e.target.checked })} /> سازگاری HTTP/3</span><span className="block text-xs text-muted">برای جلوگیری از عبور مستقیم Gemini، در IKEv2 ارتباط UDP/443 کاربران مشمول بسته می‌شود تا مرورگر از TCP استفاده کند. این تغییر ممکن است HTTP/3 سایر سایت‌های همان کاربران را هم به HTTP/2 تبدیل کند. در Xray فقط دامنه‌های مشمول اعمال می‌شود.</span></label>
      </div>
      <p className="text-xs text-muted">تشخیص دامنه از اتصال رمزگذاری‌شده به SNI وابسته است؛ ECH یا برنامه‌هایی که نام سایت را پنهان می‌کنند ممکن است نیاز به تنظیم کلاینت داشته باشند. IP و کشور WARP قابل انتخاب نیست و دسترسی همیشگی به Gemini تضمین نمی‌شود.</p>
      <button className="btn-primary" disabled={save.isPending || !lines(domains).length || (!s?.installed && form.enabled)} onClick={() => save.mutate()}><Save size={16} />{save.isPending ? 'در حال اعمال…' : 'ذخیره و اعمال تنظیمات'}</button>
      <p className="text-xs text-muted">تغییر مسیر روی اتصال‌های جدید سایت‌ها اعمال می‌شود؛ پس از ذخیره، برنامه یا مرورگر را کامل ببندید و باز کنید.</p>
    </GlassCard>
    {daily.length > 0 && <GlassCard className="space-y-3"><h3 className="font-bold">مصرف روزهای اخیر · به وقت تهران</h3>{daily.map(([date, value]) => <div key={date} className="flex justify-between border-b border-[var(--line)] py-2"><span dir="ltr">{date}</span><b dir="ltr">{fmtBytes(value)}</b></div>)}</GlassCard>}
  </div>;
}
