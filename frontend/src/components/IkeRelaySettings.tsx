import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, Save, Copy } from 'lucide-react';
import { api } from '../lib/api';
import { GlassCard } from './UI';
import { useToast } from './Toast';

type Policy = { enabled: boolean; hostname: string; port: number; outboundTag: string };
type Template = { inbounds: any[]; outbounds?: any[]; routing: { rules: any[] }; [key: string]: any };

export default function IkeRelaySettings() {
  const toast = useToast(), qc = useQueryClient();
  const [form, setForm] = useState<Policy | null>(null);
  const [original, setOriginal] = useState(''), [result, setResult] = useState('');
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<{ settings: { ikeRelay: Policy } }>('/api/settings') });
  const status = useQuery({ queryKey: ['ike-relay-status'], queryFn: () => api<Policy & { ready: boolean }>('/api/ike-relay/status') });
  useEffect(() => { if (!form && settings.data?.settings.ikeRelay) setForm(settings.data.settings.ikeRelay); }, [form, settings.data]);
  const save = useMutation({
    mutationFn: () => api<{ settings: Policy }>('/api/settings/ikeRelay', { method: 'PATCH', body: JSON.stringify(form) }),
    onSuccess: response => { setForm(response.settings); setResult(''); toast('تنظیمات مسیر ایران ذخیره شد.', 'success'); qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['ike-relay-status'] }); },
    onError: () => toast('اعمال تنظیمات انجام نشد؛ دامنه و وضعیت سرور را بررسی کنید. اتصال اصلی برقرار می‌ماند.', 'error'),
  });
  const generate = useMutation({
    mutationFn: () => api<{ fragment: Template }>('/api/ike-relay/template'),
    onSuccess: ({ fragment }) => {
      try {
        const input = JSON.parse(original) as Template;
        if (!Array.isArray(input.inbounds) || !Array.isArray(input.outbounds) || !Array.isArray(input.routing?.rules)) throw new Error();
        const inbound = fragment.inbounds[0], rule = fragment.routing.rules[0];
        const owned = new Set([inbound.tag]);
        const legacy = input.inbounds.find(v => v.tag === `ir-ike-test-${inbound.port}` && v.protocol === 'tunnel'
          && v.settings?.rewriteAddress === inbound.settings.rewriteAddress && v.settings?.rewritePort === 4500);
        if (legacy) owned.add(legacy.tag);
        if (!input.outbounds.some(v => v.tag === rule.outboundTag)) return toast('خروجی انتخاب‌شده در تنظیمات پنل ایران وجود ندارد.', 'error');
        if (input.inbounds.some(v => !owned.has(v.tag) && String(v.port) === String(inbound.port))) return toast('این پورت در قالب فعلی استفاده شده است؛ پورت دیگری انتخاب کنید.', 'error');
        input.inbounds = [...input.inbounds.filter(v => !owned.has(v.tag)), inbound];
        input.routing.rules = input.routing.rules.flatMap(v => {
          if (!v.inboundTag?.some((tag: string) => owned.has(tag))) return [v];
          const tags = v.inboundTag.filter((tag: string) => !owned.has(tag));
          return tags.length ? [{ ...v, inboundTag: tags }] : [];
        });
        const at = input.routing.rules.findIndex(v => v.outboundTag !== 'api');
        input.routing.rules.splice(at < 0 ? input.routing.rules.length : at, 0, rule);
        setResult(JSON.stringify(input, null, 2));
      } catch { toast('متن کامل و معتبر JSON بخش Advanced سرور ایران را وارد کنید.', 'error'); }
    },
    onError: () => toast('تنظیمات آماده نشد؛ دامنه اصلی سرور خارجی باید با دامنه ایران متفاوت باشد.', 'error'),
  });
  if (!form) return <GlassCard>در حال دریافت تنظیمات…</GlassCard>;
  const dirty = settings.data?.settings.ikeRelay && (['enabled', 'hostname', 'port', 'outboundTag'] as const).some(key => form[key] !== settings.data!.settings.ikeRelay[key]);
  return <div className="space-y-5">
    <GlassCard className="space-y-4">
      <h3 className="flex items-center gap-2 text-lg font-bold"><Network /> مسیر جایگزین IKEv2 از ایران</h3>
      <p className="text-sm leading-7 text-muted">کاربر به واسط ایران متصل می‌شود؛ حساب، اعتبار و سهمیه همان حساب اصلی است. مصرف این مسیر از زمان فعال‌سازی جدا نمایش داده می‌شود.</p>
      <span className="badge">{!form.enabled ? 'خاموش' : status.data?.ready ? 'سرور خارجی آماده؛ اتصال ایران را آزمایش کنید' : 'نیاز به بررسی تنظیمات'}</span>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
        <label className="flex gap-3"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} /> فعال‌سازی مسیر ایران و نمایش فایل اتصال به کاربران</label>
        <label className="block space-y-2"><span>دامنه واسط ایران</span><input className="input w-full" dir="ltr" placeholder="ir-vpn.example.com" required={form.enabled} value={form.hostname} onChange={e => setForm({ ...form, hostname: e.target.value.trim().toLowerCase() })} /></label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2"><span>پورت UDP روی سرور ایران</span><input className="input w-full" dir="ltr" type="number" min="1024" max="65535" value={form.port} onChange={e => setForm({ ...form, port: Number(e.target.value) })} /></label>
          <label className="space-y-2"><span>نام خروجی در پنل ایران</span><input className="input w-full" dir="ltr" value={form.outboundTag} required pattern="[a-zA-Z0-9_.-]+" onChange={e => setForm({ ...form, outboundTag: e.target.value })} /></label>
        </div>
        <p className="text-sm text-muted leading-7">رکورد A این دامنه باید IP ایران باشد و پروکسی DNS خاموش باشد. ذخیره، گواهی اختصاصی را با CA فعلی می‌سازد؛ گواهی اصلی تغییر نمی‌کند. پورت سفارشی فعلاً برای strongSwan اندروید است؛ اتصال داخلی ویندوز و آیفون را پشتیبانی نمی‌کند.</p>
        <button className="btn btn-primary" disabled={save.isPending}><Save size={16} /> {save.isPending ? 'در حال اعمال…' : 'ذخیره و اعمال'}</button>
      </form>
    </GlassCard>
    <GlassCard className="space-y-4">
      <h3 className="font-bold">آماده‌سازی تنظیمات پنل ایران</h3>
      <ol className="list-decimal list-inside space-y-2 text-sm leading-7"><li>تنظیمات بالا را ذخیره کنید.</li><li>متن کامل Advanced پنل ایران را به‌عنوان بکاپ نگه دارید و در کادر زیر قرار دهید.</li><li>تنظیم جدید را بسازید، در همان Advanced جایگزین و ذخیره کنید. اینباندهای کاربران تغییر نمی‌کنند.</li><li>از صفحه یک کاربر، فایل «اتصال از ایران» را وارد strongSwan و اتصال اینترنت را تست کنید.</li></ol>
      <p className="text-xs text-muted">ترکیب JSON داخل مرورگر انجام می‌شود؛ متن پنل ایران به سرور ارسال نمی‌شود. برای ارتباط ایران با خارج می‌توانید خروجی تونل موجود را انتخاب کنید. direct فقط وقتی مناسب است که UDP مستقیم واقعاً کار کند.</p>
      <textarea className="input w-full font-mono text-xs" dir="ltr" rows={8} aria-label="قالب فعلی Advanced ایران" placeholder="متن کامل JSON فعلی پنل ایران" value={original} onChange={e => { setOriginal(e.target.value); setResult(''); }} />
      <button className="btn btn-secondary" disabled={!original || dirty || generate.isPending || save.isPending} onClick={() => generate.mutate()}>ساخت تنظیم جدید با حفظ تنظیمات فعلی</button>
      {dirty && <p className="text-sm text-amber-300">ابتدا تغییرات بالا را ذخیره کنید.</p>}
      {result && !dirty && <><textarea className="input w-full font-mono text-xs" dir="ltr" rows={10} readOnly aria-label="قالب آماده سرور ایران" value={result} /><button className="btn btn-primary" onClick={async () => { try { await navigator.clipboard.writeText(result); toast('تنظیم جدید کپی شد.', 'success'); } catch { toast('متن کادر را انتخاب و کپی کنید.', 'error'); } }}><Copy size={16} /> کپی تنظیم جدید</button></>}
      <p className="text-sm text-muted leading-7">خاموش‌کردن این گزینه، اتصال همین مسیر را در سرور خارجی قطع می‌کند؛ فایل‌های اصلی کاربران باقی می‌مانند. بکاپ و میگریشن، تنظیمات و گواهی را منتقل می‌کنند. اگر دامنه اصلی خارجی ثابت بماند، فقط DNS آن را پس از انتقال اصلاح کنید؛ در صورت تغییر دامنه اصلی، تنظیم ایران را دوباره بسازید.</p>
    </GlassCard>
  </div>;
}
