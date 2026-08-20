import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, WifiOff, Search, AlertTriangle, ShieldAlert, ArrowDown, ArrowUp, Clock } from 'lucide-react';
import { api, VpnSession } from '../lib/api';
import { fmtBytes, fmtDate } from '../lib/format';
import { EmptyState, GlassCard, Modal, PageHeader, SkeletonGrid, TableShell } from '../components/UI';
import { useToast } from '../components/Toast';

function fmtDuration(seconds?: number) {
  if (seconds == null || isNaN(seconds)) return '—';
  const sec = Math.floor(seconds);
  if (sec < 60) return `${sec} ثانیه`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} دقیقه`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr} ساعت ${remMin > 0 ? `و ${remMin} دقیقه` : ''}`;
}

export default function SessionsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [disconnectAllOpen, setDisconnectAllOpen] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<{ sessions: VpnSession[] }>('/api/sessions'),
    refetchInterval: 5_000,
  });

  const terminate = useMutation({
    mutationFn: (id: string) => api(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('نشست VPN با موفقیت قطع شد.', 'success');
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  const terminateAll = useMutation({
    mutationFn: () => api('/api/sessions/disconnect-all', { method: 'POST' }),
    onSuccess: (res: any) => {
      toast(`${res.disconnected || 0} نشست با موفقیت قطع شدند.`, 'success');
      setDisconnectAllOpen(false);
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  const sessions = data?.sessions || [];

  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      (s.username || s.remoteId || '').toLowerCase().includes(q) ||
      (s.remoteHost || '').toLowerCase().includes(q) ||
      (s.virtualIp || '').toLowerCase().includes(q) ||
      (s.ikeId || '').includes(q)
    );
  }, [sessions, search]);

  const totalIn = sessions.reduce((acc, s) => acc + (s.bytesIn || 0), 0);
  const totalOut = sessions.reduce((acc, s) => acc + (s.bytesOut || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="نشست‌های آنلاین VPN"
        description="فهرست و مشخصات اتصال‌های فعال IKEv2 به تفکیک آی‌پی، مصرف زنده و مدت اتصال."
        action={
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} /> بازخوانی
            </button>
            {sessions.length > 0 && (
              <button
                className="btn-ghost text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/30"
                onClick={() => setDisconnectAllOpen(true)}
              >
                <WifiOff size={16} /> قطع همه نشست‌ها
              </button>
            )}
          </div>
        }
      />

      {/* Metrics Header */}
      <div className="grid gap-4 sm:grid-cols-3">
        <GlassCard className="flex items-center gap-3">
          <div className="brand-mark">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-xs text-muted">سشن‌های آنلاین</p>
            <p className="text-xl font-bold">{sessions.length} کاربر فعال</p>
          </div>
        </GlassCard>

        <GlassCard className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-500/15 p-3 text-emerald-400">
            <ArrowDown size={20} />
          </div>
          <div>
            <p className="text-xs text-muted">حجم دانلود در سشن‌های زنده</p>
            <p className="text-xl font-bold text-emerald-400">{fmtBytes(totalIn)}</p>
          </div>
        </GlassCard>

        <GlassCard className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-500/15 p-3 text-indigo-400">
            <ArrowUp size={20} />
          </div>
          <div>
            <p className="text-xs text-muted">حجم آپلود در سشن‌های زنده</p>
            <p className="text-xl font-bold text-indigo-400">{fmtBytes(totalOut)}</p>
          </div>
        </GlassCard>
      </div>

      {/* Search Bar */}
      <GlassCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="relative flex-1 min-w-[240px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <input
              className="input pr-10"
              placeholder="جستجوی کاربر، آی‌پی پابلیک، آی‌پی مجازی یا شناسه..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <span className="status-pill"><i /> بازخوانی خودکار هر ۵ ثانیه</span>
        </div>
      </GlassCard>

      {/* Sessions Table */}
      {isLoading ? (
        <SkeletonGrid n={2} />
      ) : isError ? (
        <GlassCard>
          <p className="text-rose-300">دریافت session ها ناموفق بود.</p>
          <button className="btn-ghost mt-3" onClick={() => refetch()}>تلاش دوباره</button>
        </GlassCard>
      ) : (
        <GlassCard className="p-0">
          <TableShell>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>کاربر / شناسه IKE</th>
                  <th>IP پابلیک کلاینت</th>
                  <th>Virtual IP (اختصاصی)</th>
                  <th>مدت اتصال</th>
                  <th>مصرف ترافیک</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((session) => (
                  <tr key={session.ikeId} className="hover:bg-white/[0.02] transition-colors">
                    <td>
                      <div className="font-bold text-cyan-400">{session.username || session.remoteId || '—'}</div>
                      <div className="text-xs text-muted font-mono">IKE #{session.ikeId}</div>
                    </td>
                    <td dir="ltr" className="font-mono text-xs">{session.remoteHost || '—'}</td>
                    <td dir="ltr" className="font-mono text-xs text-emerald-400">{session.virtualIp || '—'}</td>
                    <td className="text-xs text-muted">
                      {fmtDuration(session.established)}
                    </td>
                    <td dir="ltr" className="text-xs whitespace-nowrap">
                      <span className="text-emerald-400">↓ {fmtBytes(session.bytesIn || 0)}</span> · <span className="text-indigo-400">↑ {fmtBytes(session.bytesOut || 0)}</span>
                    </td>
                    <td>
                      <span className="badge-ok">
                        {session.state || 'ESTABLISHED'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="icon-button text-xs py-1.5 px-3 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/30 flex items-center gap-1"
                        title="قطع این نشست"
                        onClick={() => terminate.mutate(session.ikeId)}
                        disabled={terminate.isPending}
                      >
                        <WifiOff size={14} /> قطع
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
          {!filteredSessions.length && (
            <EmptyState text={search ? 'نشستی با عبارت جستجو شده یافت نشد.' : 'هیچ نشست فعالی در حال حاضر متصل نیست.'} />
          )}
        </GlassCard>
      )}

      {/* Disconnect All Confirmation Modal */}
      <Modal open={disconnectAllOpen} onClose={() => setDisconnectAllOpen(false)}>
        <div className="space-y-4 text-center sm:text-right">
          <div className="flex items-center gap-3 text-rose-400">
            <ShieldAlert size={28} />
            <h3 className="text-lg font-bold">تایید قطع تمام نشست‌ها</h3>
          </div>
          <p className="text-sm text-muted">
            آیا مطمئن هستید که می‌خواهید تمام <b className="text-white">{sessions.length}</b> نشست فعال VPN را قطع کنید؟ کلاینت‌ها برای اتصال مجدد باید دوباره متصل شوند.
          </p>
          <div className="flex justify-end gap-3 pt-3">
            <button className="btn-ghost" onClick={() => setDisconnectAllOpen(false)}>
              انصراف
            </button>
            <button
              className="btn-primary bg-rose-600 hover:bg-rose-700 text-white"
              onClick={() => terminateAll.mutate()}
              disabled={terminateAll.isPending}
            >
              {terminateAll.isPending ? 'در حال قطع...' : 'بله، همه را قطع کن'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
