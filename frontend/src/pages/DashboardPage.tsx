import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, Database, HardDrive, Cpu, Server, Users, Wifi, ShieldCheck, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtBytes, fmtDate } from '../lib/format';
import { GlassCard, PageHeader, SkeletonGrid, StatCard, ProgressBar, EmptyState } from '../components/UI';

interface DashboardResponse {
  totals: {
    users: number;
    active: number;
    expired: number;
    online: number;
    todayBytes: number;
    monthBytes: number;
    bytes: number;
  };
  system?: {
    load?: number;
    memoryUsed?: number;
    memoryTotal?: number;
    uptime?: number;
    disk?: { size: number; used: number; avail: number; percent: string } | null;
    strongswan?: string;
    cpuCount?: number;
  };
  recent?: Array<{
    username: string;
    last_seen_at?: string;
    usage_total: number | string;
    created_at: string;
  }>;
  sessions?: Array<unknown>;
}

export default function DashboardPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardResponse>('/api/dashboard'),
    refetchInterval: 10_000,
  });

  if (isLoading) return <SkeletonGrid n={4} />;
  if (isError || !data) {
    return (
      <GlassCard>
        <p className="text-rose-300">دریافت وضعیت داشبورد ناموفق بود.</p>
        <button className="btn-ghost mt-3" onClick={() => refetch()} disabled={isFetching}>تلاش دوباره</button>
      </GlassCard>
    );
  }

  const totals = data.totals || { users: 0, active: 0, expired: 0, online: 0, todayBytes: 0, monthBytes: 0, bytes: 0 };
  const system = data.system || {};
  const memUsed = system.memoryUsed || 0;
  const memTotal = system.memoryTotal || 1;
  const memPercent = Math.round((memUsed / memTotal) * 100);
  const diskPercentNum = parseInt(system.disk?.percent || '0', 10);
  const uptimeHours = system.uptime ? Math.floor(system.uptime / 3600) : 0;
  const uptimeDays = Math.floor(uptimeHours / 24);

  return (
    <div className="space-y-6">
      <PageHeader
        title="داشبورد مدیریت ZVPN"
        description="وضعیت اتصال‌ها، مصرف پهنای باند و سلامت سرور strongSwan."
        action={
          <button className="btn-ghost" onClick={() => refetch()} disabled={isFetching}>
            به‌روزرسانی
          </button>
        }
      />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Users}
          label="کاربران VPN"
          value={totals.users}
          sub={`${totals.active} فعال / ${totals.expired || 0} منقضی`}
        />
        <StatCard
          icon={Wifi}
          label="اتصال‌های زنده (Online)"
          value={totals.online}
          sub="نشست‌های فعال IKEv2"
        />
        <StatCard
          icon={Activity}
          label="مصرف ترافیک امروز"
          value={fmtBytes(totals.todayBytes)}
          sub={`ماه جاری: ${fmtBytes(totals.monthBytes || 0)}`}
        />
        <StatCard
          icon={Database}
          label="مجموع ترافیک مصرفی"
          value={fmtBytes(totals.bytes)}
          sub="کل حجم دانلود و آپلود"
        />
      </div>

      {/* System Health & Resources */}
      <div className="grid gap-6 lg:grid-cols-3">
        <GlassCard className="lg:col-span-2 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Server size={20} className="text-cyan-400" />
                <h2 className="text-lg font-bold">سلامت سرور و منابع سخت‌افزاری</h2>
              </div>
              <p className="mt-1 text-xs text-muted">
                وضعیت پردازنده، حافظه رم، فضای دیسک و سرویس strongSwan IKEv2
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`status-pill ${system.strongswan === 'active' || system.strongswan === 'running' ? '' : 'text-rose-400'}`}>
                <i className={system.strongswan === 'active' || system.strongswan === 'running' ? 'bg-emerald-400' : 'bg-rose-400'} />
                strongSwan: {system.strongswan || 'running'}
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {/* CPU Load */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <div className="flex items-center justify-between text-xs text-muted mb-2">
                <span className="flex items-center gap-1.5"><Cpu size={15} /> بار پردازنده (Load)</span>
                <span>{system.cpuCount || 1} Cores</span>
              </div>
              <p className="text-2xl font-bold font-mono">
                {Number(system.load || 0).toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-muted">میانگین بار ۱ دقیقه</p>
            </div>

            {/* RAM Utilization */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <div className="flex items-center justify-between text-xs text-muted mb-1">
                <span className="flex items-center gap-1.5"><Activity size={15} /> حافظه رم (RAM)</span>
                <span className="font-semibold text-slate-200">{memPercent}%</span>
              </div>
              <ProgressBar value={memPercent} />
              <p className="mt-2 text-xs text-muted">
                {fmtBytes(memUsed)} از {fmtBytes(memTotal)}
              </p>
            </div>

            {/* Disk Storage */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <div className="flex items-center justify-between text-xs text-muted mb-1">
                <span className="flex items-center gap-1.5"><HardDrive size={15} /> حافظه دیسک (Disk)</span>
                <span className="font-semibold text-slate-200">{system.disk?.percent || 'N/A'}</span>
              </div>
              <ProgressBar value={diskPercentNum || 0} />
              <p className="mt-2 text-xs text-muted">
                {system.disk ? `${fmtBytes(system.disk.used)} مصرف از ${fmtBytes(system.disk.size)}` : 'در دسترس نیست'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 text-xs text-muted border-t border-[var(--line)]">
            <Clock size={14} />
            <span>مدت زمان روشن بودن سرور (Uptime): {uptimeDays > 0 ? `${uptimeDays} روز و ` : ''}{uptimeHours % 24} ساعت</span>
          </div>
        </GlassCard>

        {/* Quick Operations */}
        <GlassCard className="space-y-4">
          <div className="border-b border-[var(--line)] pb-3">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <ShieldCheck size={20} className="text-indigo-400" />
              میانبرهای عملیاتی
            </h2>
            <p className="mt-1 text-xs text-muted">دسترسی سریع به بخش‌های اصلی پنل</p>
          </div>

          <div className="flex flex-col gap-2.5">
            <Link className="btn-ghost justify-between hover:border-cyan-500/40" to="/users">
              <span className="font-medium">مدیریت کاربران و صدور اکانت</span>
              <ArrowRight size={16} />
            </Link>
            <Link className="btn-ghost justify-between hover:border-cyan-500/40" to="/sessions">
              <span className="font-medium">سشن‌های آنلاین ({totals.online})</span>
              <ArrowRight size={16} />
            </Link>
            <Link className="btn-ghost justify-between hover:border-cyan-500/40" to="/logs">
              <span className="font-medium">لاگ‌ها و رویدادهای سیستم</span>
              <ArrowRight size={16} />
            </Link>
            <Link className="btn-ghost justify-between hover:border-cyan-500/40" to="/settings">
              <span className="font-medium">تنظیمات سرور و دامنه VPN</span>
              <ArrowRight size={16} />
            </Link>
          </div>
        </GlassCard>
      </div>

      {/* Recent Users Table */}
      {data.recent && data.recent.length > 0 && (
        <GlassCard className="p-0">
          <div className="flex items-center justify-between border-b border-[var(--line)] p-4">
            <h3 className="font-bold">آخرین کاربران ثبت‌شده</h3>
            <Link to="/users" className="text-xs text-cyan-400 hover:underline flex items-center gap-1">
              مشاهده همه <ArrowRight size={12} />
            </Link>
          </div>
          <div className="table-wrap border-0 rounded-none bg-transparent">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>نام کاربری</th>
                  <th>ترافیک مصرفی</th>
                  <th>آخرین اتصال</th>
                  <th>تاریخ ایجاد</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((u) => (
                  <tr key={u.username} className="hover:bg-white/[0.02]">
                    <td className="font-semibold text-cyan-400">{u.username}</td>
                    <td>{fmtBytes(Number(u.usage_total || 0))}</td>
                    <td className="text-xs text-muted">{u.last_seen_at ? fmtDate(u.last_seen_at) : 'هنوز متصل نشده'}</td>
                    <td className="text-xs text-muted">{fmtDate(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
