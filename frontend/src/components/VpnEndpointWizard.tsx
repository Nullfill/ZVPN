import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, AlertTriangle, Loader2, Server, Shield, Activity } from 'lucide-react';
import { api } from '../lib/api';
import { GlassCard } from '../components/UI';
import { useToast } from '../components/Toast';

type Validation = {
  endpoint: string;
  type: 'ip' | 'domain';
  serverAddress: string;
  remoteId: string;
  needsNewCert: boolean;
  unchanged?: boolean;
  dns: { ok: boolean; addresses: string[] };
  ports: { udp500: boolean; udp4500: boolean };
  certificate: { cn?: string; san?: string[]; notAfter?: string; leftid?: string; matches?: boolean };
  current: { serverAddress: string; remoteId: string };
  messages: string[];
};

export default function VpnEndpointWizard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [endpoint, setEndpoint] = useState('');
  const [step, setStep] = useState(1);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [confirmCert, setConfirmCert] = useState(false);
  const [applyResult, setApplyResult] = useState<{ health?: { ok: boolean; strongswan: boolean }; message?: string } | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['vpn-endpoint-status'],
    queryFn: () => api<{ current: Validation['current']; certificate: Validation['certificate']; ports: Validation['ports'] }>('/api/vpn-endpoint/status'),
  });

  useEffect(() => {
    if (status?.current?.serverAddress && !endpoint) {
      setEndpoint(status.current.serverAddress);
    }
  }, [status, endpoint]);

  const validate = useMutation({
    mutationFn: () => api<Validation>('/api/vpn-endpoint/validate', { method: 'POST', body: JSON.stringify({ endpoint: endpoint.trim() }) }),
    onSuccess: (d) => {
      setValidation(d);
      setConfirmCert(false);
      setApplyResult(null);
      setStep(2);
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  const apply = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string; health: { ok: boolean; strongswan: boolean } }>('/api/vpn-endpoint/apply', {
      method: 'POST',
      body: JSON.stringify({ endpoint: endpoint.trim(), confirmNewCert: confirmCert }),
    }),
    onSuccess: (d) => {
      setApplyResult(d);
      setStep(4);
      toast(d.message, 'success');
      qc.invalidateQueries({ queryKey: ['vpn-endpoint-status'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['vpn-config'] });
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  return (
    <GlassCard className="lg:col-span-2">
      <div className="mb-4 flex items-center gap-2">
        <Server className="text-sky-400" />
        <h3 className="font-bold">مدیریت VPN Endpoint (IKEv2)</h3>
      </div>
      <p className="mb-4 text-sm text-slate-400">
        تغییر IP به دامنه یا برعکس — پنل خودش گواهی سرور، <code className="text-sky-300">leftid</code> strongSwan و پروفایل‌های کلاینت را هماهنگ می‌کند.
      </p>

      {isLoading ? <div className="skeleton h-24" /> : status && (
        <div className="mb-4 grid gap-2 rounded-xl bg-black/20 p-4 text-sm sm:grid-cols-2">
          <div><span className="text-slate-400">Endpoint فعلی:</span> <b dir="ltr">{status.current.serverAddress}</b></div>
          <div><span className="text-slate-400">Remote ID:</span> <b dir="ltr">{status.current.remoteId}</b></div>
          <div><span className="text-slate-400">Certificate CN:</span> <b dir="ltr">{status.certificate.cn || '—'}</b></div>
          <div><span className="text-slate-400">leftid:</span> <b dir="ltr">{status.certificate.leftid || '—'}</b></div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={`rounded-full px-3 py-1 ${step >= n ? 'bg-sky-500/20 text-sky-300' : 'bg-white/5 text-slate-500'}`}>
            {n === 1 && 'Endpoint'}
            {n === 2 && 'بررسی'}
            {n === 3 && 'اعمال'}
            {n === 4 && 'Health'}
          </span>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm text-slate-400">Endpoint جدید (IP یا Domain)</span>
            <input className="input mt-1" dir="ltr" placeholder="ike.spinbox.ir یا 168.222.49.180"
              value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
          </label>
          <button type="button" className="btn-primary" disabled={!endpoint.trim() || validate.isPending}
            onClick={() => validate.mutate()}>
            {validate.isPending ? <><Loader2 className="animate-spin" size={18} /> در حال بررسی...</> : 'مرحله بعد — بررسی Certificate'}
          </button>
        </div>
      )}

      {step >= 2 && validation && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Stat icon={Shield} label="نوع" value={validation.type === 'ip' ? 'IP Address' : 'Domain'} />
            <Stat icon={validation.certificate.matches ? CheckCircle : AlertTriangle}
              label="Certificate"
              value={validation.needsNewCert ? 'نیاز به گواهی جدید' : 'معتبر'}
              warn={validation.needsNewCert} />
            <Stat icon={Activity} label="UDP 500" value={validation.ports.udp500 ? 'باز' : 'بسته'} warn={!validation.ports.udp500} />
            <Stat icon={Activity} label="UDP 4500" value={validation.ports.udp4500 ? 'باز' : 'بسته'} warn={!validation.ports.udp4500} />
          </div>

          {validation.type === 'domain' && (
            <div className="rounded-xl bg-white/5 p-3 text-sm">
              <b>DNS:</b>{' '}
              {validation.dns.ok
                ? validation.dns.addresses.join(', ')
                : <span className="text-amber-300">resolve نشد</span>}
            </div>
          )}

          <div className="rounded-xl bg-white/5 p-3 text-sm space-y-1">
            <div><b>CN فعلی:</b> <span dir="ltr">{validation.certificate.cn || '—'}</span></div>
            <div><b>SAN:</b> <span dir="ltr">{(validation.certificate.san || []).join(', ') || '—'}</span></div>
            {validation.certificate.notAfter && <div><b>انقضا:</b> {validation.certificate.notAfter}</div>}
          </div>

          {validation.messages.map((m) => (
            <p key={m} className={`text-sm ${validation.needsNewCert ? 'text-amber-300' : 'text-slate-300'}`}>{m}</p>
          ))}

          {step === 2 && (
            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn-ghost" onClick={() => setStep(1)}>بازگشت</button>
              <button type="button" className="btn-primary" disabled={validation.unchanged || (validation.type === 'domain' && !validation.dns.ok)}
                onClick={() => setStep(3)}>
                ادامه — Apply Changes
              </button>
            </div>
          )}
        </div>
      )}

      {step === 3 && validation && (
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Endpoint جدید: <b dir="ltr">{validation.endpoint}</b> — Remote ID: <b dir="ltr">{validation.remoteId}</b>
          </p>
          {validation.needsNewCert && (
            <label className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <input type="checkbox" checked={confirmCert} onChange={(e) => setConfirmCert(e.target.checked)} className="mt-1" />
              <span>
                گواهی فعلی با Endpoint جدید هماهنگ نیست. تأیید می‌کنم گواهی سرور جدید (با همان CA) ساخته شود،
                strongSwan restart شود و در صورت خطا rollback انجام شود.
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-ghost" onClick={() => setStep(2)}>بازگشت</button>
            <button type="button" className="btn-primary" disabled={apply.isPending || (validation.needsNewCert && !confirmCert)}
              onClick={() => apply.mutate()}>
              {apply.isPending ? <><Loader2 className="animate-spin" size={18} /> در حال اعمال...</> : 'Apply Changes'}
            </button>
          </div>
        </div>
      )}

      {step === 4 && applyResult && (
        <div className="space-y-3">
          <div className={`flex items-center gap-2 text-sm ${applyResult.health?.ok ? 'text-emerald-400' : 'text-amber-300'}`}>
            {applyResult.health?.ok ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
            {applyResult.health?.ok ? 'Health Check موفق — strongSwan و پورت‌های IKE فعال هستند.' : 'Health Check ناقص — لاگ strongSwan را بررسی کنید.'}
          </div>
          <p className="text-sm text-slate-400">{applyResult.message}</p>
          <p className="text-sm text-slate-400">کاربران با همان لینک دانلود قبلی، پروفایل Endpoint جدید را دریافت می‌کنند.</p>
          <button type="button" className="btn-ghost" onClick={() => { setStep(1); setValidation(null); setApplyResult(null); }}>تغییر Endpoint دیگر</button>
        </div>
      )}
    </GlassCard>
  );
}

function Stat({ icon: Icon, label, value, warn }: { icon: typeof Server; label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${warn ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-white/5'}`}>
      <div className="mb-1 flex items-center gap-2 text-xs text-slate-400"><Icon size={14} /> {label}</div>
      <b className="text-sm">{value}</b>
    </div>
  );
}
