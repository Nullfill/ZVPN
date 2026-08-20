import { useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { LucideIcon, X } from 'lucide-react';

export function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`glass p-5 ${className}`}>{children}</section>;
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="page-kicker">ZVPN Panel</p>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="brand-mark"><Icon size={20} /></div>
        <span className="text-xs text-muted">Live</span>
      </div>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </motion.div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const color = value >= 100 ? 'bg-rose-500' : value >= 80 ? 'bg-amber-400' : 'bg-[var(--accent)]';
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-500/20">
      <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function SkeletonGrid({ n = 4 }: { n?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="glass p-5">
          <div className="skeleton mb-4 h-10 w-10" />
          <div className="skeleton h-7 w-24" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center text-muted">
      <p>{text}</p>
      {action}
    </div>
  );
}

export function TableShell({ children }: { children: React.ReactNode }) {
  return <div className="table-wrap">{children}</div>;
}

export function Modal({ open, onClose, children, wide }: { open: boolean; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-4 backdrop-blur-sm sm:items-center" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        initial={{ y: 18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className={`surface relative max-h-[90vh] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} overflow-y-auto p-6`}
      >
        <button className="icon-button absolute left-4 top-4" onClick={onClose} aria-label="بستن">
          <X size={17} />
        </button>
        {children}
      </motion.div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'تأیید',
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm text-muted">{message}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button className="btn-ghost" onClick={onClose}>انصراف</button>
        <button className={danger ? 'btn-primary !from-rose-500 !to-rose-600' : 'btn-primary'} onClick={onConfirm} disabled={loading}>
          {loading ? '...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function SectionChip({ children }: { children: React.ReactNode }) {
  return <span className="section-chip">{children}</span>;
}

export function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
