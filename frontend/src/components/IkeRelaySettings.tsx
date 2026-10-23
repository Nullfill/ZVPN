import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, Save, Copy } from 'lucide-react';
import { api } from '../lib/api';
import { GlassCard } from './UI';
import { useToast } from './Toast';

type Policy = { enabled: boolean; hostname: string; port: number; outboundTag: string };
type Template = { inbounds: any[]; outbounds?: any[]; routing: { rules: any[] }; [key: string]: any };

export default function IkeRelaySettings({ kind = 'ike' }: { kind?: 'ike' | 'xray' }) {
  const isXray = kind === 'xray';
  const section = isXray ? 'xrayRelay' : 'ikeRelay', endpoint = isXray ? 'xray-relay' : 'ike-relay';
  const toast = useToast(), qc = useQueryClient();
  const [form, setForm] = useState<Policy | null>(null);
  const [original, setOriginal] = useState(''), [result, setResult] = useState('');
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<{ settings: Record<string, Policy> }>('/api/settings') });
  const status = useQuery({ queryKey: [endpoint, 'status'], queryFn: () => api<Policy & { ready: boolean }>(`/api/${endpoint}/status`) });
  useEffect(() => { if (!form && settings.data?.settings[section]) setForm(settings.data.settings[section]); }, [form, settings.data, section]);
  const save = useMutation({
    mutationFn: () => api<{ settings: Policy }>(`/api/settings/${section}`, { method: 'PATCH', body: JSON.stringify(form) }),
    onSuccess: response => { setForm(response.settings); setResult(''); toast('تنظیمات مسیر ایران ذخیره شد.', 'success'); qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: [endpoint, 'status'] }); qc.invalidateQueries({ queryKey: [endpoint, 'template'] }); },
    onError: () => toast('اعمال تنظیمات انجام نشد؛ دامنه و وضعیت سرور را بررسی کنید. اتصال اصلی برقرار می‌ماند.', 'error'),
  });
  const readyTemplate = useQuery({
    queryKey: [endpoint, 'template', settings.data?.settings[section]],
    queryFn: () => api<{ fragment: Template; origin: string }>(`/api/${endpoint}/template`),
    enabled: Boolean(settings.data?.settings[section]?.hostname) && !save.isPending,
    retry: false,
  });
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('تنظیمات کپی شد.', 'success'); }
    catch { toast('متن کادر را انتخاب و کپی کنید.', 'error'); }
  };
  const generate = useMutation({
    mutationFn: () => api<{ fragment: Template }>(`/api/${endpoint}/template`),
    onSuccess: ({ fragment }) => {
      try {
        const input = JSON.parse(original) as Template;
        if (!Array.isArray(input.inbounds) || !Array.isArray(input.outbounds) || !Array.isArray(input.routing?.rules)) throw new Error();
        const inbound = fragment.inbounds[0], rule = fragment.routing.rules[0];
        const owned = new Set([inbound.tag]);
        const legacy = input.inbounds.find(v => v.tag === `ir-ike-test-${inbound.port}` && v.protocol === 'tunnel'
          && v.settings?.allowedNetwork === 'udp' && v.settings?.rewritePort === 4500);
        if (legacy) owned.add(legacy.tag);
        if (isXray && input.inbounds.some(v => v.tag === 'zvpn-xray-relay-test' && v.port === inbound.port && v.protocol === 'tunnel' && v.settings?.allowedNetwork === 'tcp')) owned.add('zvpn-xray-relay-test');
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
  const dirty = settings.data?.settings[section] && (['enabled', 'hostname', 'port', 'outboundTag'] as const).some(key => form[key] !== settings.data!.settings[section][key]);
  return <div className="space-y-5">
    <GlassCard className="space-y-4">
      <h3 className="flex items-center gap-2 text-lg font-bold"><Network /> {isXray ? 'اتصال Xray از ایران' : 'مسیر جایگزین IKEv2 از ایران'}</h3>
      <p className="text-sm leading-7 text-muted">{isXray ? 'کانفیگ ایران کنار اتصال مستقیم و Netlify در همان ساب کاربران قرار می‌گیرد؛ مناسب برنامه‌های سازگار با XHTTP در اندروید، آیفون و ویندوز.' : 'کاربر به واسط ایران متصل می‌شود؛ حساب، اعتبار و سهمیه همان حساب اصلی است.'} مصرف این مسیر جدا ثبت می‌شود و از همان سهمیه مشترک کم می‌شود.</p>
      <span className="badge">{!form.enabled ? 'خاموش' : status.data?.ready ? 'سرور خارجی آماده؛ اتصال ایران را آزمایش کنید' : 'نیاز به بررسی تنظیمات'}</span>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
        <label className="flex gap-3"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} /> {isXray ? 'فعال‌سازی Xray از ایران و افزودن به ساب کاربران' : 'فعال‌سازی مسیر ایران و نمایش فایل اتصال به کاربران'}</label>
        <label className="block space-y-2"><span>دامنه واسط ایران</span><input className="input w-full" dir="ltr" placeholder="ir-vpn.example.com" required={form.enabled} value={form.hostname} onChange={e => setForm({ ...form, hostname: e.target.value.trim().toLowerCase() })} /></label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2"><span>پورت {isXray ? 'TCP' : 'UDP'} روی سرور ایران</span><input className="input w-full" dir="ltr" type="number" min="1024" max="65535" value={form.port} onChange={e => setForm({ ...form, port: Number(e.target.value) })} /></label>
          <label className="space-y-2"><span>نام خروجی در پنل ایران</span><input className="input w-full" dir="ltr" value={form.outboundTag} required pattern="[a-zA-Z0-9_.-]+" onChange={e => setForm({ ...form, outboundTag: e.target.value })} /></label>
        </div>
        <p className="text-sm text-muted leading-7">رکورد A این دامنه باید IP ایران باشد و پروکسی DNS خاموش باشد. {isXray ? 'از همان گواهی HTTPS سرور خارجی استفاده می‌شود؛ برای این مسیر گواهی تازه روی ایران لازم نیست. برنامه کاربر باید VLESS/XHTTP را پشتیبانی کند. با خاموش‌کردن این مسیر، ساب آن را حذف می‌کند و ورودی اختصاصی خارج هم کاربرانش را نمی‌پذیرد.' : 'ذخیره، گواهی اختصاصی را با CA فعلی می‌سازد؛ گواهی اصلی تغییر نمی‌کند. پورت سفارشی فعلاً برای strongSwan اندروید است؛ اتصال داخلی ویندوز و آیفون را پشتیبانی نمی‌کند.'}</p>
        <button className="btn btn-primary" disabled={save.isPending}><Save size={16} /> {save.isPending ? 'در حال اعمال…' : 'ذخیره و اعمال'}</button>
      </form>
    </GlassCard>
    <GlassCard className="space-y-4">
      <h3 className="font-bold">آماده‌سازی تنظیمات پنل ایران</h3>
      <p className="text-sm leading-7 text-muted">تنظیم مخصوص این مسیر پس از ذخیره، خودکار در کادر زیر نمایش داده می‌شود. برای دریافت متن کامل Advanced با حفظ اتصال‌های دیگر، از بخش ترکیب تنظیمات استفاده کنید.</p>
      {dirty ? <p className="text-sm text-amber-300">ابتدا تغییرات بالا را ذخیره کنید تا تنظیم آماده بروزرسانی شود.</p>
        : !settings.data?.settings[section]?.hostname ? <p className="text-sm text-muted">ابتدا دامنه ایران را در بخش بالا وارد و ذخیره کنید.</p>
        : readyTemplate.isPending ? <p className="text-sm text-muted">در حال آماده‌سازی تنظیم مسیر…</p>
        : readyTemplate.isError ? <div className="space-y-2"><p className="text-sm text-amber-300">دریافت تنظیم آماده انجام نشد؛ دامنه‌های ایران و خارج را بررسی کنید.</p><button className="btn btn-secondary" onClick={() => readyTemplate.refetch()}>دریافت دوباره</button></div>
        : readyTemplate.data && <div className="space-y-3 rounded-xl border border-[var(--line)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold">قطعه آمادهٔ این مسیر</h4><span className="badge">آماده</span></div>
          <p className="text-sm text-muted">پورت {form.port} ایران ← خروجی <b dir="ltr">{form.outboundTag}</b> ← <b dir="ltr">{readyTemplate.data.origin}</b></p>
          <textarea className="input w-full font-mono text-xs" dir="ltr" rows={13} readOnly aria-label="قطعه آماده تنظیم مسیر ایران" value={JSON.stringify(readyTemplate.data.fragment, null, 2)} />
          <button className="btn btn-secondary" onClick={() => copy(JSON.stringify(readyTemplate.data!.fragment, null, 2))}><Copy size={16} /> کپی قطعه تنظیم مسیر</button>
          <p className="text-xs leading-6 text-muted">این قطعه، کل تنظیمات Advanced نیست. برای جایگزینی متن کامل Advanced، خروجی بخش ترکیب زیر را بسازید تا تنظیمات اتصال‌های دیگر حفظ شوند.</p>
        </div>}
      <div className="space-y-4 border-t border-[var(--line)] pt-4">
      <h4 className="font-bold">ساخت متن کامل Advanced با حفظ تنظیمات فعلی</h4>
      <ol className="list-decimal list-inside space-y-2 text-sm leading-7"><li>متن فعلی تب All در Advanced پنل ایران را کپی کنید و یک نسخه بکاپ نگه دارید.</li><li>آن را در کادر ورودی زیر قرار دهید و «ترکیب و ساخت متن کامل» را بزنید.</li><li>خروجی ساخته‌شده را در همان تب All جایگزین و ذخیره کنید.</li><li>{isXray ? 'ساب یک کاربر را در برنامه سازگار با XHTTP بروزرسانی و کانفیگ Iran Xray را امتحان کنید.' : 'از صفحه یک کاربر، فایل «اتصال از ایران» را وارد strongSwan و اتصال اینترنت را تست کنید.'}</li></ol>
      <p className="text-xs text-muted">ترکیب JSON داخل مرورگر انجام می‌شود؛ متن پنل ایران به سرور ارسال نمی‌شود. برای ارتباط ایران با خارج می‌توانید خروجی تونل موجود را انتخاب کنید. direct فقط وقتی مناسب است که ارتباط مستقیم ایران به خارج واقعاً کار کند؛ برای استقلال از تونل دیگر، خروجی آن باید روی سرور ایران آماده باشد.</p>
      <label className="block space-y-2"><span className="text-sm font-bold">ورودی: متن فعلی Advanced ایران</span><textarea className="input w-full font-mono text-xs" dir="ltr" rows={8} aria-label="قالب فعلی Advanced ایران" placeholder="این کادر ورودی است؛ متن فعلی تب All پنل ایران را اینجا قرار دهید." value={original} onChange={e => { setOriginal(e.target.value); setResult(''); }} /></label>
      {!original && <p className="text-xs text-muted">خالی‌بودن این کادر طبیعی است؛ تنظیم آمادهٔ مسیر در بالای همین بخش قرار دارد.</p>}
      <button className="btn btn-secondary" disabled={!original.trim() || dirty || generate.isPending || save.isPending} onClick={() => generate.mutate()}>{generate.isPending ? 'در حال ترکیب…' : 'ترکیب و ساخت متن کامل'}</button>
      {result && !dirty && <div className="space-y-3"><h4 className="font-bold">خروجی: متن کامل آماده برای Advanced ایران</h4><textarea className="input w-full font-mono text-xs" dir="ltr" rows={10} readOnly aria-label="قالب آماده سرور ایران" value={result} /><button className="btn btn-primary" onClick={() => copy(result)}><Copy size={16} /> کپی متن کامل آماده</button></div>}
      </div>
      <p className="text-sm text-muted leading-7">خاموش‌کردن این گزینه، اتصال همین مسیر را در سرور خارجی قطع می‌کند؛ فایل‌های اصلی کاربران باقی می‌مانند. بکاپ و میگریشن، تنظیمات، مصرف و گواهی‌های فعلی را منتقل می‌کنند. اگر دامنه اصلی خارجی ثابت بماند، فقط DNS آن را پس از انتقال اصلاح کنید؛ در صورت تغییر دامنه اصلی، تنظیم ایران را دوباره بسازید.</p>
    </GlassCard>
  </div>;
}
