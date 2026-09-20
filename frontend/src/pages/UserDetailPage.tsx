import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Copy, ExternalLink, RefreshCw, Ban, Power, Trash2, KeyRound, Plus, Clock, Wifi, Pencil } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api, DownloadLinks, VpnUser, normalizeLinks } from '../lib/api';
import { fmtBytes, fmtDate, statusLabel, statusBadge, gbToBytes, bytesToGb } from '../lib/format';
import { GlassCard, ProgressBar, ConfirmDialog, Modal, SkeletonGrid } from '../components/UI';
import { useToast } from '../components/Toast';

export default function UserDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<{ action: string; title: string; message: string } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revealPw, setRevealPw] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['user', id],
    queryFn: () => api<{ user: VpnUser; stats: { daily?: { usage_date: string; bytes: number }[] }; links: DownloadLinks | null }>(`/api/users/${id}`),
    refetchInterval: 10000,
    enabled: !!id,
  });

  if (isLoading || !data) return <SkeletonGrid n={3} />;
  const u = data.user;
  const links = normalizeLinks(data.links);
  const chartDaily = (data.stats?.daily || []).map((d) => ({
    date: d.usage_date,
    gb: Number(d.bytes) / 1024 ** 3,
  }));

  const action = async (path: string, method = 'POST', body?: object) => {
    setLoading(true);
    try {
      const res = await api<{ password?: string; links?: DownloadLinks }>(path, { method, body: body ? JSON.stringify(body) : undefined });
      qc.invalidateQueries({ queryKey: ['user', id] });
      qc.invalidateQueries({ queryKey: ['users'] });
      if (res.password) {
        setRevealPw(res.password);
        toast('رمز جدید ساخته شد', 'success');
      } else {
        toast('انجام شد', 'success');
      }
      return res;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'خطا', 'error');
      return null;
    } finally {
      setLoading(false);
      setConfirm(null);
    }
  };

  const copyLink = () => {
    if (links?.landing) {
      navigator.clipboard.writeText(links.landing);
      toast('لینک کپی شد', 'success');
    }
  };

  const totalPct = u.totalLimitBytes ? (u.usageTotal / u.totalLimitBytes) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/users" className="btn-ghost"><ArrowRight size={18} /> بازگشت</Link>
        <h2 className="text-xl font-bold">{u.username}</h2>
        <span className={statusBadge(u.status)}>{statusLabel(u.status)}</span>
        {u.online > 0 && <span className="badge-ok"><Wifi size={12} /> {u.online} آنلاین</span>}
        <button type="button" className="btn-ghost mr-auto" onClick={() => setEditOpen(true)}><Pencil size={16} /> ویرایش</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard>
          <h3 className="mb-3 font-bold">اطلاعات</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-slate-400">شناسه</dt><dd className="font-mono text-xs">{u.id.slice(0, 8)}…</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-400">ساخته شده</dt><dd>{fmtDate(u.createdAt)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-400">اولین اتصال</dt><dd>{fmtDate(u.firstConnectedAt)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-400">آخرین اتصال</dt><dd>{fmtDate(u.lastSeenAt)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-400">انقضا</dt><dd>{u.remainingDays != null ? `${u.remainingDays} روز` : fmtDate(u.expiresAt)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-400">دستگاه</dt><dd dir="ltr" className="font-mono">{u.online} / {u.maxDevices}</dd></div>
            {u.note && <div className="flex justify-between gap-4"><dt className="text-slate-400">یادداشت</dt><dd>{u.note}</dd></div>}
          </dl>
        </GlassCard>

        <GlassCard>
          <h3 className="mb-3 font-bold">مصرف ترافیک</h3>
          <div dir="ltr" className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-bold font-mono text-white">{fmtBytes(u.usageTotal)}</span>
            <span className="text-sm font-normal text-slate-400 font-mono">/ {u.totalLimitBytes ? fmtBytes(u.totalLimitBytes) : '∞'}</span>
          </div>
          <ProgressBar value={totalPct} />
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs text-slate-400 block mb-1">مصرف روزانه</span>
              <p dir="ltr" className="font-mono text-xs font-semibold">{fmtBytes(u.todayBytes)} <span className="text-slate-500">/ {u.dailyLimitBytes ? fmtBytes(u.dailyLimitBytes) : '∞'}</span></p>
            </div>
            <div>
              <span className="text-xs text-slate-400 block mb-1">باقیمانده کل</span>
              <p dir="ltr" className="font-mono text-xs font-semibold">{u.remainingTraffic != null ? fmtBytes(u.remainingTraffic) : '∞'}</p>
            </div>
            <div>
              <span className="text-xs text-slate-400 block mb-1">دانلود</span>
              <p dir="ltr" className="font-mono text-xs text-cyan-400">↓ {fmtBytes(u.downloadBytes)}</p>
            </div>
            <div>
              <span className="text-xs text-slate-400 block mb-1">آپلود</span>
              <p dir="ltr" className="font-mono text-xs text-indigo-400">↑ {fmtBytes(u.uploadBytes)}</p>
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <h3 className="mb-3 font-bold">لینک دانلود پروفایل</h3>
          {links ? (
            <>
              <div className="rounded-xl bg-black/30 p-3 text-xs break-all" dir="ltr">{links.landing}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-ghost" onClick={copyLink}><Copy size={16} /> کپی</button>
                <a className="btn-ghost" href={links.landing} target="_blank" rel="noreferrer"><ExternalLink size={16} /> باز</a>
                <button type="button" className="btn-ghost" onClick={() => setConfirm({ action: 'regenerate', title: 'بازتولید لینک', message: 'لینک قبلی فوراً invalid می‌شود.' })}><RefreshCw size={16} /></button>
                <button type="button" className="btn-ghost text-rose-400" onClick={() => setConfirm({ action: 'revoke', title: 'لغو لینک', message: 'لینک دانلود غیرفعال می‌شود.' })}><Ban size={16} /></button>
              </div>
            </>
          ) : <p className="text-sm text-slate-400">لینک لغو شده — بازتولید کنید</p>}
        </GlassCard>
      </div>

      <GlassCard>
        <h3 className="mb-4 font-bold">مصرف ۳۰ روز</h3>
        <div className="h-48">
          {chartDaily.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartDaily}>
                <Area type="monotone" dataKey="gb" stroke="#6366f1" fill="#6366f133" />
                <XAxis dataKey="date" fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip />
              </AreaChart>
            </ResponsiveContainer>
          ) : <p className="text-slate-400">داده‌ای نیست</p>}
        </div>
      </GlassCard>

      <GlassCard>
        <h3 className="mb-4 font-bold">عملیات</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" disabled={loading} onClick={() => action(`/api/users/${id}`, 'PATCH', { enabled: !u.enabled })}><Power size={16} /> {u.enabled ? 'غیرفعال' : 'فعال'}</button>
          <button type="button" className="btn-ghost" disabled={loading} onClick={() => action(`/api/users/${id}/disconnect`)}><Wifi size={16} /> قطع اتصال</button>
          <button type="button" className="btn-ghost" disabled={loading} onClick={() => action(`/api/users/${id}/extend`, 'POST', { days: 30 })}><Clock size={16} /> +۳۰ روز</button>
          <button type="button" className="btn-ghost" disabled={loading} onClick={() => action(`/api/users/${id}/add-traffic`, 'POST', { gigabytes: 10 })}><Plus size={16} /> +۱۰ GB</button>
          <button type="button" className="btn-ghost" disabled={loading} onClick={() => action(`/api/users/${id}/reset-password`)}><KeyRound size={16} /> رمز جدید</button>
          <button type="button" className="btn-ghost" disabled={loading} onClick={() => setConfirm({ action: 'reset-activation', title: 'ریست فعال‌سازی', message: 'first_connected_at پاک می‌شود. فقط برای کاربران با مدت از اولین اتصال.' })}>ریست فعال‌سازی</button>
          <button type="button" className="btn-ghost text-amber-400" disabled={loading} onClick={() => setConfirm({ action: 'reset-traffic', title: 'ریست ترافیک', message: 'حجم مصرفی کل و امروز کاربر صفر می‌شود و ترافیک حساب بازنشانی می‌گردد.' })}>ریست ترافیک</button>
          <button type="button" className="btn-ghost text-rose-400" disabled={loading} onClick={() => {
            const name = prompt(`برای حذف، نام کاربری «${u.username}» را وارد کنید:`);
            if (name === u.username) action(`/api/users/${id}`, 'DELETE').then(() => navigate('/users'));
          }}><Trash2 size={16} /> حذف</button>
        </div>
      </GlassCard>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        danger={confirm?.action === 'revoke' || confirm?.action === 'reset-traffic'}
        loading={loading}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm?.action === 'regenerate') await action(`/api/users/${id}/regenerate-link`);
          else if (confirm?.action === 'revoke') await action(`/api/users/${id}/revoke-link`);
          else if (confirm?.action === 'reset-activation') await action(`/api/users/${id}/reset-activation`);
          else if (confirm?.action === 'reset-traffic') await action(`/api/users/${id}/reset-traffic`);
        }}
      />

      <Modal open={!!revealPw} onClose={() => setRevealPw(null)}>
        <h3 className="text-lg font-bold">رمز جدید</h3>
        <div className="mt-4 rounded-xl bg-black/30 p-4 font-mono" dir="ltr">{revealPw}</div>
        <button type="button" className="btn-primary mt-4" onClick={() => { navigator.clipboard.writeText(revealPw || ''); toast('رمز کپی شد', 'success'); }}>کپی رمز</button>
      </Modal>

      <EditUserModal open={editOpen} user={u} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); qc.invalidateQueries({ queryKey: ['user', id] }); toast('ذخیره شد', 'success'); }} />
    </div>
  );
}

function EditUserModal({ open, user, onClose, onSaved }: { open: boolean; user: VpnUser; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    expiresAt: '', durationDays: '', dailyGB: '', totalGB: '', maxDevices: '1', note: '', enabled: true, unlimited: false, mode: 'duration' as 'date' | 'duration',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({
      expiresAt: user.expiresAt ? new Date(user.expiresAt).toISOString().slice(0, 10) : '',
      durationDays: user.durationDays ? String(user.durationDays) : '',
      dailyGB: bytesToGb(user.dailyLimitBytes),
      totalGB: bytesToGb(user.totalLimitBytes),
      maxDevices: String(user.maxDevices),
      note: user.note || '',
      enabled: user.enabled,
      unlimited: user.unlimitedTraffic,
      mode: user.durationDays && !user.expiresAt ? 'duration' : 'date',
    });
    setError('');
  }, [open, user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        enabled: form.enabled,
        dailyLimitBytes: gbToBytes(form.dailyGB),
        totalLimitBytes: form.unlimited ? null : gbToBytes(form.totalGB),
        unlimitedTraffic: form.unlimited,
        maxDevices: Number(form.maxDevices),
        note: form.note,
      };
      if (form.mode === 'duration') {
        body.durationDays = form.durationDays ? Number(form.durationDays) : null;
        body.expiresAt = null;
      } else {
        body.expiresAt = form.expiresAt ? new Date(form.expiresAt).toISOString() : null;
        body.durationDays = null;
      }
      await api(`/api/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} wide>
      <form onSubmit={submit} className="flex flex-col gap-0">
        <h3 className="text-lg font-bold mb-5">ویرایش {user.username}</h3>
        <MobileFormFields form={form} setForm={setForm} showEnabled />
        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:justify-end">
          <button type="button" className="btn-ghost min-h-[48px] text-base" onClick={onClose}>انصراف</button>
          <button type="submit" className="btn-primary min-h-[48px] text-base" disabled={saving}>{saving ? 'در حال ذخیره…' : 'ذخیره'}</button>
        </div>
      </form>
    </Modal>
  );
}

function MobileFormFields({ form, setForm, showEnabled }: {
  form: { expiresAt: string; durationDays: string; dailyGB: string; totalGB: string; maxDevices: string; note: string; enabled: boolean; unlimited: boolean; mode: 'date' | 'duration' };
  setForm: (f: typeof form) => void;
  showEnabled?: boolean;
}) {
  const f = form;
  const s = setForm;

  return (
    <div className="flex flex-col gap-5">

      {/* ─── انقضا ─── */}
      <fieldset className="rounded-xl border border-white/10 px-4 pt-3 pb-4">
        <legend className="px-1 text-xs font-semibold text-slate-400 tracking-wide">انقضا</legend>

        {/* Toggle: نوع انقضا */}
        <div className="flex gap-2 mb-4">
          {(['duration', 'date'] as const).map((v) => (
            <button key={v} type="button"
              onClick={() => s({ ...f, mode: v })}
              className={`flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors ${f.mode === v ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-400'}`}>
              {v === 'duration' ? 'مدت (روز)' : 'تاریخ ثابت'}
            </button>
          ))}
        </div>

        {f.mode === 'duration' ? (
          <label className="block">
            <span className="text-xs text-slate-400 mb-1 block">تعداد روز از اولین اتصال</span>
            <div className="flex items-center gap-2">
              <button type="button" className="icon-button text-lg w-11 h-11 shrink-0" onClick={() => s({ ...f, durationDays: String(Math.max(1, Number(f.durationDays || 0) - 1) ) })}>−</button>
              <input className="input text-center flex-1 min-h-[44px]" inputMode="numeric" value={f.durationDays} onChange={(e) => s({ ...f, durationDays: e.target.value.replace(/\D/g, '') })} placeholder="۳۰" />
              <button type="button" className="icon-button text-lg w-11 h-11 shrink-0" onClick={() => s({ ...f, durationDays: String(Number(f.durationDays || 0) + 1) })}>+</button>
            </div>
          </label>
        ) : (
          <label className="block">
            <span className="text-xs text-slate-400 mb-1 block">تاریخ انقضا</span>
            <input className="input min-h-[44px]" type="date" value={f.expiresAt} onChange={(e) => s({ ...f, expiresAt: e.target.value })} />
          </label>
        )}
      </fieldset>

      {/* ─── ترافیک ─── */}
      <fieldset className="rounded-xl border border-white/10 px-4 pt-3 pb-4">
        <legend className="px-1 text-xs font-semibold text-slate-400 tracking-wide">ترافیک</legend>

        {/* نامحدود toggle */}
        <button type="button"
          onClick={() => s({ ...f, unlimited: !f.unlimited })}
          className={`mb-4 flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm font-medium transition-colors ${f.unlimited ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/40' : 'bg-white/5 text-slate-400 border border-white/10'}`}>
          <span>ترافیک نامحدود</span>
          <span className={`h-5 w-9 rounded-full transition-colors relative ${f.unlimited ? 'bg-emerald-500' : 'bg-slate-600'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${f.unlimited ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </span>
        </button>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-slate-400 mb-1 block">روزانه (GB)</span>
            <input className="input min-h-[44px]" inputMode="decimal" value={f.dailyGB} onChange={(e) => s({ ...f, dailyGB: e.target.value })} placeholder="نامحدود" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400 mb-1 block">کل (GB)</span>
            <input className="input min-h-[44px]" inputMode="decimal" disabled={f.unlimited} value={f.totalGB} onChange={(e) => s({ ...f, totalGB: e.target.value })} placeholder="نامحدود" />
          </label>
        </div>
      </fieldset>

      {/* ─── تنظیمات ─── */}
      <fieldset className="rounded-xl border border-white/10 px-4 pt-3 pb-4">
        <legend className="px-1 text-xs font-semibold text-slate-400 tracking-wide">تنظیمات</legend>

        <label className="block mb-3">
          <span className="text-xs text-slate-400 mb-1 block">حداکثر دستگاه همزمان</span>
          <div className="flex items-center gap-2">
            <button type="button" className="icon-button text-lg w-11 h-11 shrink-0" onClick={() => s({ ...f, maxDevices: String(Math.max(1, Number(f.maxDevices) - 1)) })}>−</button>
            <input className="input text-center flex-1 min-h-[44px]" inputMode="numeric" value={f.maxDevices} onChange={(e) => s({ ...f, maxDevices: e.target.value.replace(/\D/g, '') })} />
            <button type="button" className="icon-button text-lg w-11 h-11 shrink-0" onClick={() => s({ ...f, maxDevices: String(Math.min(10, Number(f.maxDevices) + 1)) })}>+</button>
          </div>
        </label>

        {showEnabled && (
          <button type="button"
            onClick={() => s({ ...f, enabled: !f.enabled })}
            className={`flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm font-medium transition-colors mb-3 ${f.enabled ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/40' : 'bg-rose-600/10 text-rose-400 border border-rose-500/30'}`}>
            <span>{f.enabled ? 'حساب فعال است' : 'حساب غیرفعال است'}</span>
            <span className={`h-5 w-9 rounded-full transition-colors relative ${f.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${f.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </span>
          </button>
        )}

        <label className="block">
          <span className="text-xs text-slate-400 mb-1 block">یادداشت (اختیاری)</span>
          <textarea className="input" rows={2} value={f.note} onChange={(e) => s({ ...f, note: e.target.value })} placeholder="مثلاً: مشتری تهران" />
        </label>
      </fieldset>
    </div>
  );
}
