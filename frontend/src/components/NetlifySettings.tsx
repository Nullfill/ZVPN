import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, Save } from 'lucide-react';
import { api } from '../lib/api';
import { GlassCard } from './UI';
import { useToast } from './Toast';

type Policy = { enabled: boolean; hostname: string };
export default function NetlifySettings() {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<Policy | null>(null);
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<{ settings: { netlify: Policy } }>('/api/settings') });
  useEffect(() => {
    if (!form && settings.data?.settings.netlify) setForm(settings.data.settings.netlify);
  }, [form, settings.data]);
  const save = useMutation({
    mutationFn: () => api('/api/settings/netlify', { method: 'PATCH', body: JSON.stringify(form) }),
    onSuccess: () => { toast('تنظیمات Netlify ذخیره شد؛ لینک کاربران به‌روز شد.', 'success'); qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  if (!form) return <GlassCard>در حال دریافت تنظیمات…</GlassCard>;
  return <div className="space-y-5">
    <GlassCard className="space-y-4">
      <h3 className="flex items-center gap-2 text-lg font-bold"><Cloud size={22} /> اتصال از واسط Netlify</h3>
      <p className="text-sm text-muted leading-7">برای اینترنت‌هایی که اتصال مستقیم به سرور باز نمی‌شود. کانفیگ و QR اختصاصی در صفحه تمام کاربران نمایش داده می‌شود؛ حجم، تاریخ انقضا و وضعیت حساب همان حساب اصلی است.</p>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
        <label className="flex items-center gap-3"><input type="checkbox" checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} /> نمایش کانفیگ Netlify در صفحه و اشتراک کاربران</label>
        <label className="block space-y-2"><span>دامنه واسط Netlify</span>
          <input className="input w-full" dir="ltr" placeholder="relay.example.com" required={form.enabled} value={form.hostname} maxLength={253} onChange={event => setForm({ ...form, hostname: event.target.value.trim().toLowerCase() })} />
        </label>
        <p className="text-xs text-muted leading-6">فقط نام دامنه را وارد کنید. ابتدا پروژه Netlify و گواهی HTTPS این دامنه باید آماده باشند. مصرف این مسیر در آمار Xray حساب ثبت می‌شود.</p>
        <button className="btn btn-primary" disabled={save.isPending}><Save size={16} /> {save.isPending ? 'در حال ذخیره…' : 'ذخیره تنظیمات'}</button>
      </form>
    </GlassCard>
    <GlassCard className="space-y-3 text-sm leading-7">
      <h3 className="font-bold">انتقال به سرور جدید</h3>
      <p>بکاپ و دستور میگریشن، تنظیمات Netlify و شناسه تمام کاربران را نگه می‌دارند. پس از انتقال فقط DNS دامنه اصلی پنل را به سرور جدید تغییر دهید؛ رکورد دامنه واسط روی Netlify بماند. پروژه Netlify با همان دامنه اصلی به سرور جدید وصل می‌شود.</p>
      <p className="text-muted">نصب پنل روی سرور خام، پروژه‌ای در حساب Netlify نمی‌سازد. برای راه‌اندازی اولیه، پروژه واسط را یک‌بار در حساب خودتان منتشر کنید و دامنه آن را اینجا ثبت کنید.</p>
      <p className="text-muted">خاموش کردن نمایش، کانفیگ‌های واردشده قبلی را باطل نمی‌کند. برای قطع دسترسی یک کاربر، حساب او را غیرفعال کنید؛ برای توقف کل واسط، پروژه را در Netlify متوقف کنید.</p>
      <a className="text-accent underline" href="https://github.com/Nullfill/ZVPN/blob/main/deploy/netlify/README.fa.md" target="_blank" rel="noreferrer">راهنمای راه‌اندازی Netlify</a>
    </GlassCard>
  </div>;
}
