import { GlassCard } from './UI';
import { fmtBytes } from '../lib/format';

export default function TrafficBreakdown({ total, ike, direct, netlify, legacy, title = 'آمار مصرف بر اساس مسیر اتصال' }:
  { total: number; ike: number; direct: number; netlify: number; legacy: number; title?: string }) {
  const parts = [
    { name: 'IKEv2', value: ike, color: '#818cf8' },
    { name: 'Xray مستقیم', value: direct, color: '#22d3ee' },
    { name: 'Netlify', value: netlify, color: '#34d399' },
    { name: 'Xray پیش از تفکیک', value: legacy, color: '#94a3b8' },
  ];
  return <GlassCard className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">{title}</h3><span className="text-sm text-muted">مصرف مشترک: <b dir="ltr">{fmtBytes(total)}</b></span></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{parts.map(part => <div key={part.name} className="rounded-xl border border-[var(--line)] p-3">
      <p className="text-xs text-muted"><span style={{ color: part.color }}>● </span>{part.name}</p>
      <p className="mt-2 text-lg font-bold" dir="ltr" style={{ color: part.color }}>{fmtBytes(part.value)}</p>
      <p className="mt-1 text-xs text-muted">{total ? (part.value / total * 100).toLocaleString('fa-IR', { maximumFractionDigits: 1 }) : '۰'}٪ از مصرف</p>
    </div>)}</div>
    <div className="flex h-3 overflow-hidden rounded-full bg-white/5" aria-label="سهم مسیرهای اتصال">{parts.map(part => <div key={part.name} title={`${part.name}: ${fmtBytes(part.value)}`} style={{ width: `${total ? part.value / total * 100 : 0}%`, background: part.color }} />)}</div>
    <p className="text-xs leading-6 text-muted">مصرف قدیمی Xray ممکن است شامل Netlify هم باشد؛ جداگانه نگه داشته شده تا تفکیک اشتباه نمایش داده نشود. مصرف جدید مسیرها جدا ثبت می‌شود و همگی از همان سهمیه مشترک کم می‌شوند.</p>
  </GlassCard>;
}
