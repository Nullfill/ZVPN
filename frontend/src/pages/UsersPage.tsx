import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Settings, Power, Wifi, KeyRound, Trash2, Copy, ExternalLink, Users, Clock3, AlertCircle, ArrowLeft, SlidersHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, VpnUser, DownloadLinks, normalizeLinks } from '../lib/api';
import { fmtBytes, fmtDate, statusLabel, statusBadge, gbToBytes, bytesToGb } from '../lib/format';
import { GlassCard, EmptyState, Modal, ProgressBar, PageHeader } from '../components/UI';
import { useToast } from '../components/Toast';

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('newest');
  const [staleDays, setStaleDays] = useState(7);
  const [page, setPage] = useState(1);
  const [actionsUser, setActionsUser] = useState<VpnUser | null>(null);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editUser, setEditUser] = useState<VpnUser | null>(null);
  const [reveal, setReveal] = useState<{ title: string; password?: string; links?: DownloadLinks } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const qc = useQueryClient();
  const toast = useToast();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: VpnUser[] }>('/api/users'),
    refetchInterval: 15000,
  });

  const users = data?.users || [];
  const counts = {all:users.length, online:users.filter(u=>u.online>0).length,
    ended:users.filter(u=>u.ended).length, stale:users.filter(u=>u.stale).length};
  const matches = useMemo(() => {
    const q=search.trim().toLocaleLowerCase();
    const result=users.filter(u=>(!q || `${u.username} ${u.note||''}`.toLocaleLowerCase().includes(q)) && (
      !filter || (filter==='online' ? u.online>0 : filter==='ended' ? u.ended : filter==='stale' ? u.ended && u.endedDays!==null && u.endedDays>=staleDays :
      filter==='active' ? ['active','expiring_soon'].includes(u.status) : u.status===filter)));
    return result.sort((a,b)=>sort==='oldest-ended' ? (a.endedAt ? Date.parse(a.endedAt):Infinity)-(b.endedAt?Date.parse(b.endedAt):Infinity) :
      sort==='name' ? a.username.localeCompare(b.username,'fa') : sort==='last-seen' ? Date.parse(b.lastSeenAt||'1970-01-01')-Date.parse(a.lastSeenAt||'1970-01-01') : Date.parse(b.createdAt)-Date.parse(a.createdAt));
  }, [users,search,filter,sort,staleDays]);
  const managedUser=users.find(u=>u.id===actionsUser?.id)||null;
  const pages=Math.max(1,Math.ceil(matches.length/25));
  const currentPage=Math.min(page,pages);
  const filtered=matches.slice((currentPage-1)*25,currentPage*25);
  useEffect(()=>{setPage(1);},[search,filter,sort,staleDays]);
  useEffect(()=>{setSelected(prev=>new Set([...prev].filter(id=>users.some(u=>u.id===id))));},[data]);
  const selectVisible=()=>setSelected(prev=>{
    const next=new Set(prev);const all=filtered.length>0 && filtered.every(u=>next.has(u.id));
    filtered.forEach(u=>all?next.delete(u.id):next.add(u.id));return next;
  });

  const toggleSelect = (id: string) => {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const bulkAction = async (action: string) => {
    if (!selected.size) return;
    if (action === 'delete' && !confirm(`${selected.size} کاربر حذف شوند؟`)) return;
    try { await api('/api/users/bulk', { method: 'POST', body: JSON.stringify({ ids: [...selected], action }) }); }
    catch(e) { toast(e instanceof Error ? e.message : 'عملیات انجام نشد','error');return; }
    toast('عملیات گروهی انجام شد', 'success');
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ['users'] });
  };

  return (
    <div className="space-y-5">
      <PageHeader title="کاربران" description="مدیریت اشتراک‌ها، مصرف مشترک و حساب‌هایی که نیاز به تمدید دارند."
        action={<button type="button" className="btn-primary" onClick={()=>{setModal('create');setEditUser(null);}}><Plus size={18}/> ساخت کاربر</button>}/>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[{key:'',label:'همه کاربران',value:counts.all,Icon:Users,color:'text-sky-400'},
          {key:'online',label:'آنلاین همین الان',value:counts.online,Icon:Wifi,color:'text-emerald-400'},
          {key:'ended',label:'پایان زمان یا حجم',value:counts.ended,Icon:AlertCircle,color:'text-amber-400'},
          {key:'stale',label:'بیش از ۷ روز بدون تمدید',value:counts.stale,Icon:Clock3,color:'text-rose-400'}].map(item=>
          <button key={item.key} type="button" className={`glass flex items-center justify-between gap-2 p-4 text-right transition hover:border-sky-400/40 ${filter===item.key?'ring-1 ring-sky-400/40':''}`}
            onClick={()=>{setFilter(item.key);if(item.key==='stale'){setStaleDays(7);setSort('oldest-ended');}}}>
            <div><p className="text-xs text-muted">{item.label}</p><p className="mt-2 text-2xl font-bold tabular-nums">{item.value.toLocaleString('fa-IR')}</p></div>
            <item.Icon size={22} className={item.color}/>
          </button>)}
      </div>
      <GlassCard className="space-y-4 !p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" size={18}/>
            <input aria-label="جستجوی کاربران" className="input pr-10" placeholder="نام کاربری یا یادداشت…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <select aria-label="فیلتر وضعیت" className="input !w-auto" value={filter} onChange={e=>setFilter(e.target.value)}>
            <option value="">همه وضعیت‌ها</option><option value="active">اشتراک فعال</option><option value="online">آنلاین</option>
            <option value="ended">زمان یا حجم تمام‌شده</option><option value="stale">مدت‌ها بدون تمدید</option>
            <option value="expired">زمان تمام‌شده</option><option value="quota_total">حجم تمام‌شده</option>
            <option value="disabled">غیرفعال</option><option value="not_activated">در انتظار اولین اتصال</option>
          </select>
          <select aria-label="مرتب‌سازی کاربران" className="input !w-auto" value={sort} onChange={e=>setSort(e.target.value)}>
            <option value="newest">جدیدترین کاربران</option><option value="oldest-ended">قدیمی‌ترین پایان اشتراک</option>
            <option value="last-seen">آخرین فعالیت</option><option value="name">نام کاربری</option>
          </select>
        </div>
        {filter==='stale' && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-rose-500/5 p-3 text-sm">
          <Clock3 size={18} className="text-rose-400"/><span>حداقل زمان گذشته از پایان اشتراک:</span>
          <select aria-label="روزهای بدون تمدید" className="input !w-auto !py-1" value={staleDays} onChange={e=>setStaleDays(Number(e.target.value))}>
            <option value={7}>۷ روز</option><option value={14}>۱۴ روز</option><option value={30}>۳۰ روز</option><option value={60}>۶۰ روز</option>
          </select><span className="text-xs text-muted">حذف خودکار انجام نمی‌شود؛ ابتدا حساب‌ها را بررسی کن.</span>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>{matches.length.toLocaleString('fa-IR')} نتیجه از {users.length.toLocaleString('fa-IR')} کاربر</span>
          <span>پایان حجم روزانه، پایان اشتراک محسوب نمی‌شود.</span>
        </div>
      </GlassCard>
      {selected.size>0 && <div className="glass flex flex-wrap items-center gap-2 !border-sky-400/30 p-3">
        <strong className="ml-auto text-sm">{selected.size.toLocaleString('fa-IR')} کاربر انتخاب شده</strong>
        <button className="btn-ghost text-xs" onClick={()=>bulkAction('enable')}>فعال‌سازی</button>
        <button className="btn-ghost text-xs" onClick={()=>bulkAction('disable')}>غیرفعال‌سازی</button>
        <button className="btn-ghost !text-rose-400 text-xs" onClick={()=>bulkAction('delete')}><Trash2 size={14}/> حذف انتخاب‌شده‌ها</button>
        <button className="btn-ghost text-xs" onClick={()=>setSelected(new Set())}>لغو انتخاب</button>
      </div>}
      <GlassCard className="!p-0 overflow-hidden">
        <div className="hidden xl:grid xl:grid-cols-[28px_minmax(140px,1.2fr)_minmax(170px,1.2fr)_minmax(160px,1fr)_minmax(140px,1fr)_150px] items-center gap-4 border-b border-[var(--line)] bg-[var(--surface-2)] px-5 py-3 text-xs text-muted">
          <input type="checkbox" aria-label="انتخاب کاربران این صفحه" checked={filtered.length>0 && filtered.every(u=>selected.has(u.id))} onChange={selectVisible}/>
          <span>کاربر و اتصال</span><span>مصرف اشتراک</span><span>وضعیت و تمدید</span><span>آخرین فعالیت</span><span>مدیریت</span>
        </div>
        {isLoading ? <div className="space-y-3 p-5">{[1,2,3].map(n=><div key={n} className="skeleton h-20"/>)}</div> : isError ?
          <EmptyState text="دریافت کاربران ناموفق بود" action={<button className="btn-ghost" onClick={()=>refetch()}>تلاش دوباره</button>}/> : filtered.map(u=>(
          <article key={u.id} className={`grid grid-cols-[24px_1fr] items-start gap-4 border-b border-[var(--line)] p-5 transition last:border-0 hover:bg-[var(--surface-2)] xl:grid-cols-[28px_minmax(140px,1.2fr)_minmax(170px,1.2fr)_minmax(160px,1fr)_minmax(140px,1fr)_150px] xl:items-center ${selected.has(u.id)?'bg-sky-500/5':''}`}>
            <input type="checkbox" aria-label={`انتخاب ${u.username}`} className="mt-1 accent-sky-500" checked={selected.has(u.id)} onChange={()=>toggleSelect(u.id)}/>
            <div className="min-w-0"><Link to={`/users/${u.id}`} className="break-all font-bold transition hover:text-sky-400" dir="auto">{u.username}</Link>
              <p className="mt-1 truncate text-xs text-muted" title={u.note||''}>{u.note||'بدون یادداشت'}</p>
              <p className={`mt-2 text-xs ${u.online?'text-emerald-400':'text-muted'}`}>{u.online?`● ${u.online} اتصال IKEv2`:'○ آفلاین در IKEv2'}</p>
            </div>
            <div className="col-start-2 space-y-1 xl:col-start-auto">
              <div className="flex items-baseline justify-between gap-2 text-xs"><span className="text-muted xl:hidden">مصرف کل</span><span dir="ltr" className="font-mono"><b>{fmtBytes(u.usageTotal)}</b> <span className="text-muted">/ {u.unlimitedTraffic||!u.totalLimitBytes?'∞':fmtBytes(u.totalLimitBytes)}</span></span></div>
              {!u.unlimitedTraffic && !!u.totalLimitBytes && <ProgressBar value={u.usageTotal/u.totalLimitBytes*100}/>}
              <p className="pt-1 text-[11px] text-muted">امروز: {fmtBytes(u.todayBytes)}{u.dailyLimitBytes && !u.unlimitedTraffic?` از ${fmtBytes(u.dailyLimitBytes)}`:''}</p>
              <p className="text-[11px] text-muted" dir="ltr">IKEv2 {fmtBytes(u.ikeUsageBytes||0)} آ· Xray {fmtBytes(u.xrayUsageBytes||0)}</p>
            </div>
            <div className="col-start-2 space-y-2 xl:col-start-auto">
              <span className={statusBadge(u.status)}>{u.endedReason==='date_and_traffic'?'زمان و حجم تمام شده':statusLabel(u.status)}</span>
              {u.ended ? <><p className={`text-xs ${u.stale?'text-rose-400':'text-amber-400'}`}>{u.endedDays===null?'زمان پایان حجم ثبت نشده':u.endedDays===0?'کمتر از یک روز از پایان':`${u.endedDays.toLocaleString('fa-IR')} روز بدون تمدید`}</p>
                {u.endedAt && <p className="text-[11px] text-muted">پایان: {fmtDate(u.endedAt)}</p>}</> :
                <p className="text-xs text-muted">{u.remainingDays!==null && u.remainingDays!==undefined?`${u.remainingDays.toLocaleString('fa-IR')} روز باقی مانده`:u.status==='not_activated'?`${u.durationDays||'—'} روز از اولین اتصال`:'بدون محدودیت زمان'}</p>}
            </div>
            <div className="col-start-2 text-xs text-muted xl:col-start-auto"><span className="xl:hidden">آخرین فعالیت: </span>{fmtDate(u.lastSeenAt)}</div>
            <div className="col-start-2 flex items-center gap-2 xl:col-start-auto">
              <button className="btn-ghost text-xs" onClick={()=>setActionsUser(u)}><SlidersHorizontal size={14}/> مدیریت</button>
              <Link className="icon-button !p-2" to={`/users/${u.id}`} aria-label={`جزئیات ${u.username}`} title="جزئیات و تمدید"><ArrowLeft size={15}/></Link>
            </div>
          </article>
        ))}
        {!matches.length && !isLoading && !isError && <EmptyState text="کاربری با این شرایط پیدا نشد" action={<button className="btn-ghost" onClick={()=>{setSearch('');setFilter('');}}>نمایش همه کاربران</button>}/>}
        {matches.length>25 && <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] p-4 text-xs text-muted">
          <button className="btn-ghost" disabled={currentPage<=1} onClick={()=>setPage(currentPage-1)}><ChevronRight size={16}/> قبلی</button>
          <span>صفحه {currentPage.toLocaleString('fa-IR')} از {pages.toLocaleString('fa-IR')}</span>
          <button className="btn-ghost" disabled={currentPage>=pages} onClick={()=>setPage(currentPage+1)}>بعدی <ChevronLeft size={16}/></button>
        </div>}
      </GlassCard>
      <Modal open={!!managedUser} onClose={()=>setActionsUser(null)}>
        {managedUser && <div className="space-y-5"><h3 className="text-lg font-bold">مدیریت {managedUser!.username}</h3>
          <div className="flex flex-wrap gap-2"><button className="btn-primary" onClick={()=>{setEditUser(managedUser);setActionsUser(null);setModal('edit');}}><Settings size={16}/> ویرایش اشتراک</button>
          <Link className="btn-ghost" to={`/users/${managedUser!.id}`}>جزئیات و تمدید <ArrowLeft size={16}/></Link></div>
          <div className="grid grid-cols-2 gap-3"><UserActions u={managedUser} onReveal={r=>{setActionsUser(null);setReveal(r);}}/></div>
        </div>}
      </Modal>

      <UserFormModal
        open={modal !== null}
        mode={modal || 'create'}
        user={editUser}
        onClose={() => setModal(null)}
        onDone={(r) => {
          setModal(null);
          qc.invalidateQueries({ queryKey: ['users'] });
          if (r) setReveal({ ...r, links: normalizeLinks(r.links) });
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
  const qc=useQueryClient();const toast=useToast();
  const refresh=()=>qc.invalidateQueries({queryKey:['users']});
  const perform=async(action:()=>Promise<unknown>)=>{try {await action();}catch(e){toast(e instanceof Error?e.message:'عملیات انجام نشد','error');}};
  const toggle=useMutation({mutationFn:()=>api(`/api/users/${u.id}`,{method:'PATCH',body:JSON.stringify({enabled:!u.enabled})}),
    onSuccess:()=>{refresh();toast('وضعیت تغییر کرد','success');},onError:(e:Error)=>toast(e.message,'error')});
  const resetPw=async()=>{
    if(!confirm(`رمز ${u.username} عوض شود؟`))return;
    const d=await api<{password:string;links:DownloadLinks}>(`/api/users/${u.id}/reset-password`,{method:'POST',body:'{}'});
    onReveal({title:'رمز جدید',password:d.password,links:normalizeLinks(d.links)});refresh();
  };
  const del=async()=>{
    if(!confirm(`کاربر ${u.username} حذف شود؟`))return;
    await api(`/api/users/${u.id}`,{method:'DELETE'});refresh();toast('کاربر حذف شد','success');
  };
  return <>
    <button className="btn-ghost" disabled={toggle.isPending} onClick={()=>toggle.mutate()}><Power size={16}/>{u.enabled?'غیرفعال‌سازی':'فعال‌سازی'}</button>
    <button className="btn-ghost" onClick={()=>perform(()=>api(`/api/users/${u.id}/disconnect`,{method:'POST'}).then(()=>toast('قطع شد','success')))}><Wifi size={16}/>قطع اتصال</button>
    <button className="btn-ghost" onClick={()=>perform(resetPw)}><KeyRound size={16}/>رمز جدید</button>
    <button className="btn-ghost !text-rose-400" onClick={()=>perform(del)}><Trash2 size={16}/>حذف کاربر</button>
  </>;
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
        expiresAt: user.expiresAt ? new Date(new Date(user.expiresAt).getTime()-new Date(user.expiresAt).getTimezoneOffset()*60000).toISOString().slice(0, 16) : '',
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

  const f = form;
  const s = setForm;

  return (
    <Modal open={open} onClose={onClose} wide>
      <form onSubmit={submit} className="flex flex-col gap-0">
        <h3 className="text-lg font-bold mb-5">{mode === 'create' ? 'ساخت کاربر جدید' : `ویرایش ${user?.username}`}</h3>

        <div className="flex flex-col gap-5">

          {/* ─── اطلاعات کاربر ─── */}
          <fieldset className="rounded-xl border border-white/10 px-4 pt-3 pb-4">
            <legend className="px-1 text-xs font-semibold text-slate-400 tracking-wide">اطلاعات کاربر</legend>
            <label className="block mb-3">
              <span className="text-xs text-slate-400 mb-1 block">نام کاربری</span>
              <input className="input min-h-[44px]" disabled={mode !== 'create'} value={f.username}
                onChange={(e) => s({ ...f, username: e.target.value })} required
                autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck="false" />
            </label>
            {mode === 'create' && (
              <label className="block">
                <span className="text-xs text-slate-400 mb-1 block">رمز عبور (خالی = خودکار)</span>
                <input className="input min-h-[44px]" type="password" autoComplete="new-password" value={f.password}
                  onChange={(e) => s({ ...f, password: e.target.value })} placeholder="اختیاری" />
              </label>
            )}
          </fieldset>

          {/* ─── انقضا ─── */}
          <fieldset className="rounded-xl border border-white/10 px-4 pt-3 pb-4">
            <legend className="px-1 text-xs font-semibold text-slate-400 tracking-wide">انقضا</legend>
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
                  <button type="button" className="icon-button text-lg w-11 h-11 shrink-0" onClick={() => s({ ...f, durationDays: String(Math.max(1, Number(f.durationDays || 0) - 1)) })}>−</button>
                  <input className="input text-center flex-1 min-h-[44px]" inputMode="numeric" value={f.durationDays} onChange={(e) => s({ ...f, durationDays: e.target.value.replace(/\D/g, '') })} placeholder="۳۰" />
                  <button type="button" className="icon-button text-lg w-11 h-11 shrink-0" onClick={() => s({ ...f, durationDays: String(Number(f.durationDays || 0) + 1) })}>+</button>
                </div>
              </label>
            ) : (
              <label className="block">
                <span className="text-xs text-slate-400 mb-1 block">تاریخ انقضا</span>
                <input className="input min-h-[44px]" type="datetime-local" value={f.expiresAt} onChange={(e) => s({ ...f, expiresAt: e.target.value })} />
              </label>
            )}
          </fieldset>

          {/* ─── ترافیک ─── */}
          <fieldset className="rounded-xl border border-white/10 px-4 pt-3 pb-4">
            <legend className="px-1 text-xs font-semibold text-slate-400 tracking-wide">ترافیک</legend>
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
            {mode === 'edit' && (
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

        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:justify-end">
          <button type="button" className="btn-ghost min-h-[48px] text-base" onClick={onClose}>انصراف</button>
          <button type="submit" className="btn-primary min-h-[48px] text-base" disabled={saving}>{saving ? 'در حال ذخیره…' : mode === 'create' ? 'ساخت کاربر' : 'ذخیره'}</button>
        </div>
      </form>
    </Modal>
  );
}
