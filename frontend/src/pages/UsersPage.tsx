import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Settings, Power, Wifi, KeyRound, Trash2, Copy, ExternalLink } from 'lucide-react';
import { api, VpnUser, DownloadLinks } from '../lib/api';
import { fmtBytes, fmtDate, statusLabel, statusBadge, gbToBytes, bytesToGb } from '../lib/format';
import { GlassCard, EmptyState, Modal, ProgressBar } from '../components/UI';
import { useToast } from '../components/Toast';

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editUser, setEditUser] = useState<VpnUser | null>(null);
  const [reveal, setReveal] = useState<{ title: string; password?: string; links?: DownloadLinks } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const qc = useQueryClient();
  const toast = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['users', search, filter],
    queryFn: () => api<{ users: VpnUser[] }>(`/api/users?search=${encodeURIComponent(search)}&status=${filter}`),
    refetchInterval: 15000,
  });

  const users = data?.users || [];
  const filtered = useMemo(() => users, [users]);

  const toggleSelect = (id: string) => {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const bulkAction = async (action: string) => {
    if (!selected.size) return;
    if (action === 'delete' && !confirm(`${selected.size} کاربر حذف شوند؟`)) return;
    await api('/api/users/bulk', { method: 'POST', body: JSON.stringify({ ids: [...selected], action }) });
    toast('عملیات گروهی انجام شد', 'success');
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ['users'] });
  };

  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input className="input pr-10" placeholder="جستجو..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">همه</option>
          <option value="active">فعال</option>
          <option value="online">آنلاین</option>
          <option value="disabled">غیرفعال</option>
          <option value="expired">منقضی</option>
          <option value="not_activated">فعال‌نشده</option>
        </select>
        {selected.size > 0 && (
          <>
            <button type="button" className="btn-ghost" onClick={() => bulkAction('enable')}>فعال‌سازی</button>
            <button type="button" className="btn-ghost" onClick={() => bulkAction('disable')}>غیرفعال</button>
            <button type="button" className="btn-ghost text-rose-400" onClick={() => bulkAction('delete')}>حذف</button>
          </>
        )}
        <button type="button" className="btn-primary" onClick={() => { setModal('create'); setEditUser(null); }}>
          <Plus size={18} /> ساخت کاربر
        </button>
      </div>

      <GlassCard className="overflow-x-auto p-0">
        <div className="grid min-w-[900px] grid-cols-[auto_1.2fr_0.8fr_1fr_1fr_0.8fr_0.7fr_auto] gap-2 border-b border-white/10 px-4 py-3 text-xs text-slate-400">
          <span />
          <span>کاربر</span>
          <span>وضعیت</span>
          <span>مصرف کل</span>
          <span>روزانه</span>
          <span>انقضا</span>
          <span>اتصال</span>
          <span>عملیات</span>
        </div>
        {isLoading ? <div className="p-8"><div className="skeleton h-20" /></div> : filtered.map((u) => (
          <div key={u.id} className="grid min-w-[900px] grid-cols-[auto_1.2fr_0.8fr_1fr_1fr_0.8fr_0.7fr_auto] items-center gap-2 border-b border-white/5 px-4 py-3 text-sm hover:bg-white/[0.03]">
            <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSelect(u.id)} />
            <div>
              <Link to={`/users/${u.id}`} className="font-bold hover:text-sky-400">{u.username}</Link>
              <p className="text-xs text-slate-500">{u.note || '—'}</p>
            </div>
            <span className={statusBadge(u.status)}>{statusLabel(u.status)}</span>
            <div>
              <b>{fmtBytes(u.usageTotal)}</b>
              <span className="text-xs text-slate-400"> / {u.totalLimitBytes ? fmtBytes(u.totalLimitBytes) : '∞'}</span>
              {!!u.totalLimitBytes && <ProgressBar value={Number(u.usageTotal) / Number(u.totalLimitBytes) * 100} />}
            </div>
            <div><b>{fmtBytes(u.todayBytes)}</b><span className="text-xs text-slate-400"> / {u.dailyLimitBytes ? fmtBytes(u.dailyLimitBytes) : '∞'}</span></div>
            <span className="text-xs">{u.remainingDays != null ? `${u.remainingDays} روز` : fmtDate(u.expiresAt)}</span>
            <span className={u.online ? 'text-emerald-400' : 'text-slate-500'}>{u.online ? `${u.online} آنلاین` : 'آفلاین'}</span>
            <div className="flex gap-1">
              <button type="button" className="btn-ghost p-2" title="ویرایش" onClick={() => { setEditUser(u); setModal('edit'); }}><Settings size={16} /></button>
              <UserActions u={u} onReveal={setReveal} />
            </div>
          </div>
        ))}
        {!filtered.length && !isLoading && <EmptyState text="کاربری پیدا نشد" />}
      </GlassCard>

      <UserFormModal
        open={modal !== null}
        mode={modal || 'create'}
        user={editUser}
        onClose={() => setModal(null)}
        onDone={(r) => {
          setModal(null);
          qc.invalidateQueries({ queryKey: ['users'] });
          if (r) setReveal(r);
          toast(modal === 'create' ? 'کاربر با موفقیت ساخته شد' : 'تغییرات ذخیره شد', 'success');
        }}
      />

      <Modal open={!!reveal} onClose={() => setReveal(null)}>
        {reveal && (
          <>
            <h3 className="text-lg font-bold">{reveal.title}</h3>
            {reveal.password && <div className="mt-4 rounded-xl bg-black/30 p-4 font-mono" dir="ltr">{reveal.password}</div>}
            {reveal.links && (
              <div className="mt-4 space-y-2">
                <button type="button" className="btn-ghost w-full justify-between" onClick={() => { navigator.clipboard.writeText(reveal.links!.landing); toast('لینک کپی شد', 'success'); }}>
                  <span className="truncate text-xs" dir="ltr">{reveal.links.landing}</span><Copy size={16} />
                </button>
                <a className="btn-primary w-full" href={reveal.links.landing} target="_blank" rel="noreferrer"><ExternalLink size={16} /> باز کردن پورتال</a>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

function UserActions({ u, onReveal }: { u: VpnUser; onReveal: (r: { title: string; password?: string; links?: DownloadLinks }) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const toggle = useMutation({
    mutationFn: () => api(`/api/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !u.enabled }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast('وضعیت تغییر کرد', 'success'); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const resetPw = async () => {
    if (!confirm(`رمز ${u.username} عوض شود؟`)) return;
    const d = await api<{ password: string; links: DownloadLinks }>(`/api/users/${u.id}/reset-password`, { method: 'POST', body: '{}' });
    onReveal({ title: 'رمز جدید', password: d.password, links: d.links });
    qc.invalidateQueries({ queryKey: ['users'] });
  };
  const del = async () => {
    if (!confirm(`کاربر ${u.username} حذف شود؟`)) return;
    await api(`/api/users/${u.id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['users'] });
    toast('کاربر حذف شد', 'success');
  };
  return (
    <>
      <button type="button" className="btn-ghost p-2" title={u.enabled ? 'غیرفعال' : 'فعال'} onClick={() => toggle.mutate()} disabled={toggle.isPending}><Power size={16} /></button>
      <button type="button" className="btn-ghost p-2" title="قطع اتصال" onClick={() => api(`/api/users/${u.id}/disconnect`, { method: 'POST' }).then(() => toast('قطع شد', 'success'))}><Wifi size={16} /></button>
      <button type="button" className="btn-ghost p-2" title="رمز جدید" onClick={resetPw}><KeyRound size={16} /></button>
      <button type="button" className="btn-ghost p-2 text-rose-400" title="حذف" onClick={del}><Trash2 size={16} /></button>
    </>
  );
}

function UserFormModal({ open, mode, user, onClose, onDone }: {
  open: boolean; mode: 'create' | 'edit'; user: VpnUser | null;
  onClose: () => void; onDone: (r?: { title: string; password?: string; links?: DownloadLinks }) => void;
}) {
  const [form, setForm] = useState({
    username: '', password: '', expiresAt: '', durationDays: '', dailyGB: '', totalGB: '',
    maxDevices: '1', note: '', enabled: true, unlimited: false, mode: 'duration' as 'date' | 'duration',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    if (user && mode === 'edit') {
      setForm({
        username: user.username,
        password: '',
        expiresAt: user.expiresAt ? new Date(user.expiresAt).toISOString().slice(0, 16) : '',
        durationDays: user.durationDays ? String(user.durationDays) : '',
        dailyGB: bytesToGb(user.dailyLimitBytes),
        totalGB: bytesToGb(user.totalLimitBytes),
        maxDevices: String(user.maxDevices),
        note: user.note || '',
        enabled: user.enabled,
        unlimited: user.unlimitedTraffic,
        mode: user.durationDays && !user.expiresAt ? 'duration' : 'date',
      });
    } else if (mode === 'create') {
      setForm({ username: '', password: '', expiresAt: '', durationDays: '30', dailyGB: '', totalGB: '', maxDevices: '1', note: '', enabled: true, unlimited: false, mode: 'duration' });
    }
    setError('');
  }, [user, mode, open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
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
      if (mode === 'create') {
        body.username = form.username;
        if (form.password.trim()) body.password = form.password.trim();
        const d = await api<{ generatedPassword: string; links: DownloadLinks; syncOk?: boolean }>('/api/users', { method: 'POST', body: JSON.stringify(body) });
        if (d.syncOk === false) toast('کاربر ساخته شد اما sync VPN با تأخیر انجام می‌شود', 'info');
        onDone({ title: 'کاربر ساخته شد', password: d.generatedPassword, links: d.links });
      } else {
        body.enabled = form.enabled;
        await api(`/api/users/${user!.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        onDone();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} wide>
      <form onSubmit={submit}>
        <h3 className="text-lg font-bold">{mode === 'create' ? 'ساخت کاربر جدید' : `ویرایش ${user?.username}`}</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2"><span className="text-sm text-slate-400">نام کاربری</span>
            <input className="input mt-1" disabled={mode !== 'create'} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
          {mode === 'create' && (
            <label className="block sm:col-span-2"><span className="text-sm text-slate-400">رمز (خالی = خودکار)</span>
              <input className="input mt-1" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          )}
          <label className="block"><span className="text-sm text-slate-400">نوع انقضا</span>
            <select className="input mt-1" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as 'date' | 'duration' })}>
              <option value="duration">مدت از اولین اتصال</option>
              <option value="date">تاریخ ثابت</option>
            </select></label>
          {form.mode === 'duration' ? (
            <label className="block"><span className="text-sm text-slate-400">مدت (روز)</span>
              <input className="input mt-1" type="number" min="1" value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value })} /></label>
          ) : (
            <label className="block"><span className="text-sm text-slate-400">تاریخ انقضا</span>
              <input className="input mt-1" type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label>
          )}
          <label className="block"><span className="text-sm text-slate-400">حجم روزانه (GB)</span>
            <input className="input mt-1" type="number" step="0.1" value={form.dailyGB} onChange={(e) => setForm({ ...form, dailyGB: e.target.value })} placeholder="نامحدود" /></label>
          <label className="block"><span className="text-sm text-slate-400">حجم کل (GB)</span>
            <input className="input mt-1" type="number" step="0.1" disabled={form.unlimited} value={form.totalGB} onChange={(e) => setForm({ ...form, totalGB: e.target.value })} placeholder="نامحدود" /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.unlimited} onChange={(e) => setForm({ ...form, unlimited: e.target.checked })} /> نامحدود</label>
          <label className="block"><span className="text-sm text-slate-400">حداکثر دستگاه</span>
            <input className="input mt-1" type="number" min="1" max="10" value={form.maxDevices} onChange={(e) => setForm({ ...form, maxDevices: e.target.value })} /></label>
          <label className="block sm:col-span-2"><span className="text-sm text-slate-400">یادداشت</span>
            <textarea className="input mt-1" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          {mode === 'edit' && (
            <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> فعال</label>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'در حال ذخیره...' : 'ذخیره'}</button>
        </div>
      </form>
    </Modal>
  );
}
