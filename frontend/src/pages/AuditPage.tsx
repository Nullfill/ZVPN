import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, Search, RefreshCw, AlertCircle, AlertTriangle, Info, Eye, X, Terminal, Server, Copy, Check } from 'lucide-react';
import { api, ObservabilityEventsResponse, ObservabilityStatsResponse, SystemEvent } from '../lib/api';
import { fmtDate } from '../lib/format';
import { EmptyState, GlassCard, Modal, PageHeader, SkeletonGrid, TableShell } from '../components/UI';
import { useToast } from '../components/Toast';

const PAGE_SIZE = 25;

export default function AuditPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'events' | 'strongswan'>('events');
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const [selectedEvent, setSelectedEvent] = useState<SystemEvent | null>(null);
  const [swanSearch, setSwanSearch] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: eventsData, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['observability-events', page, query, level],
    queryFn: () =>
      api<ObservabilityEventsResponse>(
        `/api/observability/events?page=${page}&pageSize=${PAGE_SIZE}&q=${encodeURIComponent(query)}&level=${level}`
      ),
    refetchInterval: 15_000,
    enabled: tab === 'events',
  });

  const { data: swanLogsData, isLoading: swanLoading, refetch: refetchSwan, isFetching: swanFetching } = useQuery({
    queryKey: ['strongswan-logs'],
    queryFn: () => api<{ logs: string }>('/api/observability/strongswan-logs'),
    refetchInterval: tab === 'strongswan' ? 5_000 : false,
    enabled: tab === 'strongswan',
  });

  const { data: statsData } = useQuery({
    queryKey: ['observability-stats'],
    queryFn: () => api<ObservabilityStatsResponse>('/api/observability/stats'),
    refetchInterval: 30_000,
  });

  const events = eventsData?.rows || [];
  const totalCount = eventsData?.total || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const stats = statsData?.stats || { error: 0, warn: 0, info: 0, debug: 0 };

  const filteredSwanLogs = useMemo(() => {
    const raw = swanLogsData?.logs || '';
    if (!swanSearch.trim()) return raw;
    const lines = raw.split('\n');
    const q = swanSearch.trim().toLowerCase();
    return lines.filter((l) => l.toLowerCase().includes(q)).join('\n');
  }, [swanLogsData, swanSearch]);

  const copySwanLogs = () => {
    if (swanLogsData?.logs) {
      navigator.clipboard.writeText(swanLogsData.logs);
      setCopied(true);
      toast('لاگ‌های strongSwan کپی شدند.', 'success');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  function levelBadge(lvl: string) {
    switch (lvl) {
      case 'error':
        return <span className="badge-bad flex items-center gap-1"><AlertCircle size={12} /> ERROR</span>;
      case 'warn':
        return <span className="badge-warn flex items-center gap-1"><AlertTriangle size={12} /> WARN</span>;
      case 'debug':
        return <span className="badge-muted flex items-center gap-1"><Terminal size={12} /> DEBUG</span>;
      case 'info':
      default:
        return <span className="badge-ok flex items-center gap-1"><Info size={12} /> INFO</span>;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="لاگ‌ها و Observability"
        description="رویدادهای امنیتی، تغییرات مدیریتی، لاگ‌های لایه شبکه strongSwan و سلامت سرور."
        action={
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost"
              onClick={() => {
                if (tab === 'events') refetch();
                else refetchSwan();
              }}
              disabled={isFetching || swanFetching}
            >
              <RefreshCw size={16} className={isFetching || swanFetching ? 'animate-spin' : ''} /> بازخوانی
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-[var(--line)] pb-3">
        <button
          className={`nav-item ${tab === 'events' ? 'active font-bold' : ''}`}
          onClick={() => setTab('events')}
        >
          <Terminal size={18} /> رویدادهای سیستم و ادمین
        </button>
        <button
          className={`nav-item ${tab === 'strongswan' ? 'active font-bold text-cyan-400' : ''}`}
          onClick={() => setTab('strongswan')}
        >
          <Server size={18} /> لاگ زنده دیمن strongSwan / Charon
        </button>
      </div>

      {tab === 'strongswan' && (
        <div className="space-y-4">
          <GlassCard className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold flex items-center gap-2">
                  <Server size={18} className="text-cyan-400" />
                  لاگ‌های لحظه‌ای سرویس strongSwan (IKEv2 Engine)
                </h3>
                <p className="text-xs text-muted mt-1">
                  مشاهده دلیل دقیق قطعی کلاینت‌ها (مانند DPD Timeout، AUTH_FAILED، تغییر IP، عدم تطابق رمز یا انقضای کلید).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-ghost text-xs" onClick={copySwanLogs}>
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />} کپی کل لاگ‌ها
                </button>
                <span className="status-pill"><i /> بازخوانی هر ۵ ثانیه</span>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
              <input
                className="input pr-9 text-xs"
                placeholder="جستجو در لاگ‌های strongSwan (مثلاً نام کاربر، DELETE، error، timeout)..."
                value={swanSearch}
                onChange={(e) => setSwanSearch(e.target.value)}
              />
            </div>

            {swanLoading ? (
              <SkeletonGrid n={1} />
            ) : (
              <pre className="max-h-[500px] overflow-auto rounded-xl bg-black/60 p-4 text-xs font-mono text-emerald-300 border border-[var(--line)] whitespace-pre-wrap leading-relaxed">
                {filteredSwanLogs || 'در حال دریافت لاگ‌ها یا هیچ لاگی یافت نشد.'}
              </pre>
            )}
          </GlassCard>
        </div>
      )}

      {tab === 'events' && (
        <>

      {/* KPI Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GlassCard className="flex items-center gap-3">
          <div className="rounded-xl bg-rose-500/15 p-3 text-rose-400">
            <AlertCircle size={24} />
          </div>
          <div>
            <p className="text-xs text-muted">خطاها (Error)</p>
            <p className="text-xl font-bold text-rose-400">{stats.error || 0}</p>
          </div>
        </GlassCard>

        <GlassCard className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-500/15 p-3 text-amber-400">
            <AlertTriangle size={24} />
          </div>
          <div>
            <p className="text-xs text-muted">هشدارها (Warn)</p>
            <p className="text-xl font-bold text-amber-400">{stats.warn || 0}</p>
          </div>
        </GlassCard>

        <GlassCard className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-500/15 p-3 text-emerald-400">
            <Info size={24} />
          </div>
          <div>
            <p className="text-xs text-muted">اطلاعات (Info)</p>
            <p className="text-xl font-bold text-emerald-400">{stats.info || 0}</p>
          </div>
        </GlassCard>

        <GlassCard className="flex items-center gap-3">
          <div className="brand-mark">
            <Terminal size={24} />
          </div>
          <div>
            <p className="text-xs text-muted">کل رویدادها</p>
            <p className="text-xl font-bold">{totalCount}</p>
          </div>
        </GlassCard>
      </div>

      {/* Filters & Search */}
      <GlassCard>
        <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <label className="relative block">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <input
              className="input pr-10"
              placeholder="جستجو در رویداد، کاربر، اکشن یا متن متادیتا..."
              value={query}
              onChange={(e) => {
                setPage(1);
                setQuery(e.target.value);
              }}
            />
          </label>
          <label className="relative block">
            <Filter className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <select
              className="input pr-10"
              value={level}
              onChange={(e) => {
                setPage(1);
                setLevel(e.target.value);
              }}
            >
              <option value="">همه سطوح (All Levels)</option>
              <option value="error">error (فقط خطاها)</option>
              <option value="warn">warn (هشدارها)</option>
              <option value="info">info (اطلاعات)</option>
              <option value="debug">debug (دیباگ)</option>
            </select>
          </label>
          <div className="flex items-center justify-between text-xs text-muted md:justify-end">
            <span>{totalCount} رویداد</span>
            <span className="status-pill mr-3"><i /> Live Stream</span>
          </div>
        </div>
      </GlassCard>

      {/* Log Stream Table */}
      {isLoading ? (
        <SkeletonGrid n={2} />
      ) : isError ? (
        <GlassCard>
          <p className="text-rose-300">دریافت لاگ‌ها ناموفق بود.</p>
          <button className="btn-ghost mt-3" onClick={() => refetch()}>تلاش دوباره</button>
        </GlassCard>
      ) : (
        <GlassCard className="p-0">
          <TableShell>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>سطح</th>
                  <th>زمان</th>
                  <th>رویداد / اکشن</th>
                  <th>فاعل (Actor)</th>
                  <th>وضعیت</th>
                  <th>جزئیات</th>
                </tr>
              </thead>
              <tbody>
                {events.map((log) => (
                  <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                    <td>{levelBadge(log.level)}</td>
                    <td className="whitespace-nowrap text-xs text-muted">{fmtDate(log.created_at)}</td>
                    <td>
                      <div className="font-semibold">{log.event || log.action}</div>
                      {log.action && log.action !== log.event && (
                        <div className="text-xs text-muted">{log.action}</div>
                      )}
                    </td>
                    <td>
                      {log.admin_username ? (
                        <span className="text-xs font-medium text-cyan-400">admin: {log.admin_username}</span>
                      ) : log.vpn_username ? (
                        <span className="text-xs font-medium text-indigo-400">user: {log.vpn_username}</span>
                      ) : (
                        <span className="text-xs text-muted">{log.source || 'system'}</span>
                      )}
                    </td>
                    <td>
                      <span className={log.status === 'failed' || log.status === 'error' ? 'badge-bad' : 'badge-ok'}>
                        {log.status || 'success'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="icon-button text-xs py-1 px-2.5 flex items-center gap-1.5"
                        onClick={() => setSelectedEvent(log)}
                        title="مشاهده متادیتا"
                      >
                        <Eye size={14} /> مشاهده
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
          {!events.length && <EmptyState text="رویدادی با فیلترهای انتخابی یافت نشد." />}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-3 text-sm text-muted">
              <span>صفحه {page} از {totalPages} (مجموع {totalCount} مورد)</span>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => setPage((v) => Math.max(1, v - 1))} disabled={page === 1}>
                  قبلی
                </button>
                <button className="btn-ghost" onClick={() => setPage((v) => Math.min(totalPages, v + 1))} disabled={page === totalPages}>
                  بعدی
                </button>
              </div>
            </div>
          )}
        </GlassCard>
      )}
      </>
      )}

      {/* Event Details Modal */}
      <Modal open={Boolean(selectedEvent)} onClose={() => setSelectedEvent(null)} wide>
        {selectedEvent && (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
              <div className="flex items-center gap-2">
                {levelBadge(selectedEvent.level)}
                <h3 className="text-lg font-bold">{selectedEvent.event}</h3>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              <div>
                <span className="text-muted">زمان ثبت: </span>
                <span className="font-mono">{fmtDate(selectedEvent.created_at)}</span>
              </div>
              <div>
                <span className="text-muted">وضعیت: </span>
                <span className="font-semibold">{selectedEvent.status}</span>
              </div>
              {selectedEvent.admin_username && (
                <div>
                  <span className="text-muted">ادمین: </span>
                  <span className="font-semibold text-cyan-400">{selectedEvent.admin_username}</span>
                </div>
              )}
              {selectedEvent.vpn_username && (
                <div>
                  <span className="text-muted">کاربر VPN: </span>
                  <span className="font-semibold text-indigo-400">{selectedEvent.vpn_username}</span>
                </div>
              )}
              {selectedEvent.request_id && (
                <div className="sm:col-span-2">
                  <span className="text-muted">Request ID: </span>
                  <span className="font-mono text-slate-400">{selectedEvent.request_id}</span>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted mb-1.5">JSON Payload & Metadata:</p>
              <pre className="max-h-80 overflow-auto rounded-xl bg-black/40 p-4 text-xs font-mono text-slate-200 border border-[var(--line)]">
                {JSON.stringify(selectedEvent.metadata || {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
