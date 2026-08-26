import { useEffect, useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings, Server, Shield, Database, Lock, Key, Download, Upload, Send, Bot, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { GlassCard, PageHeader, Modal } from '../components/UI';
import { useToast } from '../components/Toast';
import VpnEndpointWizard from '../components/VpnEndpointWizard';

interface PanelSettings {
  general: { panelName: string; timezone: string; domain: string };
  vpn: { maxDevicesPolicy: string; serverAddress: string; remoteId: string; dns: string };
  appearance: { theme: string; animations: boolean; threeJs: boolean; glassIntensity: number };
  download: { tokenDays: number; pageTitle: string; supportText: string };
  telegram: {
    enabled: boolean;
    botToken: string;
    chatId: string;
    intervalHours: number;
    includeAdmins: boolean;
    lastBackupAt: string | null;
    lastStatus: 'success' | 'error' | null;
    lastError: string | null;
  };
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'endpoint' | 'vpn' | 'backup' | 'security'>('general');

  // Form states
  const [generalForm, setGeneralForm] = useState({ panelName: '', timezone: '', domain: '' });
  const [vpnForm, setVpnForm] = useState({ maxDevicesPolicy: 'disconnect_oldest', dns: '' });
  const [telegramForm, setTelegramForm] = useState({
    enabled: false,
    botToken: '',
    chatId: '',
    intervalHours: 1,
    includeAdmins: true,
  });
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [sendingTelegramNow, setSendingTelegramNow] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [importMode, setImportMode] = useState<'merge' | 'full' | 'users-only'>('merge');
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [backupPayload, setBackupPayload] = useState<any>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ settings: PanelSettings }>('/api/settings'),
  });

  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: { id: string; username: string; role?: string } }>('/api/me'),
  });

  useEffect(() => {
    if (data?.settings) {
      setGeneralForm({
        panelName: data.settings.general?.panelName || '',
        timezone: data.settings.general?.timezone || 'Asia/Tehran',
        domain: data.settings.general?.domain || '',
      });
      setVpnForm({
        maxDevicesPolicy: data.settings.vpn?.maxDevicesPolicy || 'disconnect_oldest',
        dns: data.settings.vpn?.dns || '',
      });
      if (data.settings.telegram) {
        setTelegramForm({
          enabled: Boolean(data.settings.telegram.enabled),
          botToken: data.settings.telegram.botToken || '',
          chatId: data.settings.telegram.chatId || '',
          intervalHours: Number(data.settings.telegram.intervalHours || 1),
          includeAdmins: data.settings.telegram.includeAdmins ?? true,
        });
      }
    }
  }, [data]);

  const updateGeneral = useMutation({
    mutationFn: () => api('/api/settings/general', { method: 'PATCH', body: JSON.stringify(generalForm) }),
    onSuccess: () => {
      toast('تنظیمات عمومی با موفقیت ذخیره شد.', 'success');
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  const updateVpn = useMutation({
    mutationFn: () => api('/api/settings/vpn', { method: 'PATCH', body: JSON.stringify(vpnForm) }),
    onSuccess: () => {
      toast('سیاست‌های VPN با موفقیت ذخیره شد.', 'success');
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  const updateTelegram = useMutation({
    mutationFn: () => api('/api/settings/telegram', { method: 'PATCH', body: JSON.stringify(telegramForm) }),
    onSuccess: () => {
      toast('تنظیمات بک‌آپ تلگرام با موفقیت ذخیره شد.', 'success');
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  const testTelegram = async () => {
    if (!telegramForm.botToken || !telegramForm.chatId) {
      toast('لطفاً توکن ربات و شناسه چت را وارد کنید.', 'error');
      return;
    }
    setTestingTelegram(true);
    try {
      const res = await api<{ ok: boolean; message?: string }>('/api/backup/telegram/test', {
        method: 'POST',
        body: JSON.stringify({ botToken: telegramForm.botToken, chatId: telegramForm.chatId }),
      });
      if (res.ok) {
        toast('پیام تست با موفقیت به تلگرام ارسال شد!', 'success');
      }
    } catch (e: any) {
      toast(e.message || 'خطا در ارتباط با تلگرام', 'error');
    } finally {
      setTestingTelegram(false);
    }
  };

  const sendBackupNow = async () => {
    setSendingTelegramNow(true);
    try {
      const res = await api<{ ok: boolean; filename: string }>('/api/backup/telegram/send-now', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (res.ok) {
        toast(`بک‌آپ با موفقیت به تلگرام ارسال شد (${res.filename})`, 'success');
        qc.invalidateQueries({ queryKey: ['settings'] });
      }
    } catch (e: any) {
      toast(e.message || 'خطا در ارسال بک‌آپ به تلگرام', 'error');
    } finally {
      setSendingTelegramNow(false);
    }
  };

  const changePassword = useMutation({
    mutationFn: () => {
      if (pwForm.next !== pwForm.confirm) throw new Error('رمز جدید با تکرار آن یکسان نیست.');
      return api('/api/admin/password', { method: 'POST', body: JSON.stringify({ current: pwForm.current, next: pwForm.next }) });
    },
    onSuccess: () => {
      toast('رمز عبور مدیر تغییر کرد. لطفاً مجدداً وارد شوید.', 'success');
      setPwForm({ current: '', next: '', confirm: '' });
      setTimeout(() => { window.location.href = '/login'; }, 1500);
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  const exportBackup = async () => {
    try {
      const res = await fetch('/api/backup/export?includeAdmins=true', { credentials: 'include' });
      if (!res.ok) throw new Error('خطا در خروجی پشتیبان');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zvpn-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('فایل پشتیبان دانلود شد.', 'success');
    } catch (e: any) {
      toast(e.message || 'خطا در خروجی پشتیبان', 'error');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        if (!parsed.version || !parsed.counts) {
          throw new Error('فرمت فایل پشتیبان معتبر نیست.');
        }
        setBackupPayload(parsed);
        setImportConfirmOpen(true);
      } catch (err: any) {
        toast(err.message || 'فایل پشتیبان نامعتبر است', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const importBackup = useMutation({
    mutationFn: () => api('/api/backup/import', {
      method: 'POST',
      body: JSON.stringify({ backup: backupPayload, mode: importMode, confirm: true }),
    }),
    onSuccess: (res: any) => {
      setImportConfirmOpen(false);
      setBackupPayload(null);
      toast(res.message || 'بازیابی با موفقیت انجام شد.', 'success');
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="تنظیمات سیستم و سرور"
        description="مدیریت دامنه و سرور VPN، سیاست‌های اتصال همزمان، پشتیبان‌گیری و امنیت."
      />

      {/* Tabs Navigation */}
      <div className="flex flex-wrap gap-2 border-b border-[var(--line)] pb-3">
        <button
          className={`nav-item ${activeTab === 'general' ? 'active font-bold' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          <Settings size={18} /> تنظیمات عمومی
        </button>
        <button
          className={`nav-item ${activeTab === 'endpoint' ? 'active font-bold' : ''}`}
          onClick={() => setActiveTab('endpoint')}
        >
          <Server size={18} /> دامنه و سرور VPN
        </button>
        <button
          className={`nav-item ${activeTab === 'vpn' ? 'active font-bold' : ''}`}
          onClick={() => setActiveTab('vpn')}
        >
          <Shield size={18} /> سیاست‌های اتصال
        </button>
        <button
          className={`nav-item ${activeTab === 'backup' ? 'active font-bold' : ''}`}
          onClick={() => setActiveTab('backup')}
        >
          <Database size={18} /> پشتیبان‌گیری و بازیابی
        </button>
        <button
          className={`nav-item ${activeTab === 'security' ? 'active font-bold' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          <Lock size={18} /> امنیت و رمز عبور مدیر
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'general' && (
        <GlassCard className="max-w-2xl space-y-4">
          <h3 className="text-lg font-bold">تنظیمات عمومی پنل</h3>
          <p className="text-xs text-muted">نام پنل و منطقه زمانی سرور را مشخص کنید.</p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateGeneral.mutate();
            }}
            className="space-y-4 pt-2"
          >
            <label className="block">
              <span className="text-sm text-slate-300">عنوان پنل (Panel Name)</span>
              <input
                className="input mt-1"
                value={generalForm.panelName}
                onChange={(e) => setGeneralForm({ ...generalForm, panelName: e.target.value })}
                required
              />
            </label>

            <label className="block">
              <span className="text-sm text-slate-300">منطقه زمانی (Timezone)</span>
              <select
                className="input mt-1"
                value={generalForm.timezone}
                onChange={(e) => setGeneralForm({ ...generalForm, timezone: e.target.value })}
              >
                <option value="Asia/Tehran">Asia/Tehran (ایران)</option>
                <option value="UTC">UTC</option>
                <option value="Europe/London">Europe/London</option>
                <option value="Europe/Berlin">Europe/Berlin</option>
                <option value="Europe/Istanbul">Europe/Istanbul</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm text-slate-300">دامنه عمومی وب پنل (اختیاری)</span>
              <input
                className="input mt-1"
                placeholder="panel.example.com"
                value={generalForm.domain}
                onChange={(e) => setGeneralForm({ ...generalForm, domain: e.target.value })}
              />
            </label>

            <div className="flex justify-end pt-3">
              <button className="btn-primary" type="submit" disabled={updateGeneral.isPending}>
                {updateGeneral.isPending ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
              </button>
            </div>
          </form>
        </GlassCard>
      )}

      {activeTab === 'endpoint' && (
        <div className="space-y-4">
          <VpnEndpointWizard />
        </div>
      )}

      {activeTab === 'vpn' && (
        <GlassCard className="max-w-2xl space-y-4">
          <h3 className="text-lg font-bold">سیاست‌های سشن و اتصال همزمان</h3>
          <p className="text-xs text-muted">
            تعیین نحوه برخورد سیستم هنگام رسیدن کاربر به سقف مجاز دستگاه‌ها (Max Devices).
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateVpn.mutate();
            }}
            className="space-y-4 pt-2"
          >
            <label className="block">
              <span className="text-sm text-slate-300">سیاست سشن‌های اضافی (Max Devices Policy)</span>
              <select
                className="input mt-1"
                value={vpnForm.maxDevicesPolicy}
                onChange={(e) => setVpnForm({ ...vpnForm, maxDevicesPolicy: e.target.value })}
              >
                <option value="disconnect_oldest">قطع قدیمی‌ترین سشن (Disconnect Oldest - پیشنهادی)</option>
                <option value="reject_newest">رد سشن جدید (Reject Newest)</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm text-slate-300">سرورهای DNS سفارشی (با کاما جدا کنید)</span>
              <input
                className="input mt-1"
                placeholder="1.1.1.1, 8.8.8.8"
                value={vpnForm.dns}
                onChange={(e) => setVpnForm({ ...vpnForm, dns: e.target.value })}
              />
            </label>

            <div className="flex justify-end pt-3">
              <button className="btn-primary" type="submit" disabled={updateVpn.isPending}>
                {updateVpn.isPending ? 'در حال ذخیره...' : 'ذخیره سیاست‌ها'}
              </button>
            </div>
          </form>
        </GlassCard>
      )}

      {activeTab === 'backup' && (
        <div className="space-y-6 max-w-4xl">
          {/* Telegram Automated Backup Card */}
          <GlassCard className="space-y-5 border border-sky-500/20 bg-gradient-to-br from-sky-950/20 via-slate-900/60 to-slate-950/80">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-sky-500/10 p-2.5 text-sky-400 border border-sky-500/20">
                  <Send size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    ارسال خودکار بک‌آپ به تلگرام
                    <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
                      Cloud Backup
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    ارسال خودکار فایل پشتیبان کامل (کاربران، پسوردها، سوابق مصرف و تنظیمات) به ربات یا کانال تلگرام
                  </p>
                </div>
              </div>

              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={telegramForm.enabled}
                  onChange={(e) => setTelegramForm({ ...telegramForm, enabled: e.target.checked })}
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-800 border border-slate-700 after:absolute after:top-[2px] after:right-[2px] after:h-5 after:w-5 after:rounded-full after:bg-slate-400 after:transition-all after:content-[''] peer-checked:bg-sky-600 peer-checked:border-sky-500 peer-checked:after:-translate-x-full peer-checked:after:bg-white"></div>
                <span className="mr-2 text-xs font-medium text-slate-300">
                  {telegramForm.enabled ? 'فعال' : 'غیرفعال'}
                </span>
              </label>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                updateTelegram.mutate();
              }}
              className="space-y-4 pt-2"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                    <Bot size={14} className="text-sky-400" />
                    توکن ربات تلگرام (Bot Token)
                  </span>
                  <input
                    className="input mt-1 font-mono text-xs"
                    type="password"
                    placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ..."
                    value={telegramForm.botToken}
                    onChange={(e) => setTelegramForm({ ...telegramForm, botToken: e.target.value })}
                    dir="ltr"
                  />
                  <span className="text-[11px] text-slate-500 mt-0.5 block">از @BotFather دریافت کنید</span>
                </label>

                <label className="block">
                  <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                    <Send size={14} className="text-sky-400" />
                    شناسه چت یا کانال (Chat ID / Channel)
                  </span>
                  <input
                    className="input mt-1 font-mono text-xs"
                    placeholder="123456789 یا @MyBackupChannel"
                    value={telegramForm.chatId}
                    onChange={(e) => setTelegramForm({ ...telegramForm, chatId: e.target.value })}
                    dir="ltr"
                  />
                  <span className="text-[11px] text-slate-500 mt-0.5 block">ربات باید در کانال شما ادمین باشد</span>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2 items-center">
                <label className="block">
                  <span className="text-xs font-medium text-slate-300">بازه زمانی ارسال خودکار</span>
                  <select
                    className="input mt-1"
                    value={telegramForm.intervalHours}
                    onChange={(e) => setTelegramForm({ ...telegramForm, intervalHours: Number(e.target.value) })}
                  >
                    <option value={1}>هر ۱ ساعت (پیشنهادی)</option>
                    <option value={3}>هر ۳ ساعت</option>
                    <option value={6}>هر ۶ ساعت</option>
                    <option value={12}>هر ۱۲ ساعت</option>
                    <option value={24}>هر ۲۴ ساعت (یکبار در روز)</option>
                  </select>
                </label>

                <label className="flex items-center gap-2 pt-5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-slate-700 bg-slate-800 text-sky-500 focus:ring-sky-500"
                    checked={telegramForm.includeAdmins}
                    onChange={(e) => setTelegramForm({ ...telegramForm, includeAdmins: e.target.checked })}
                  />
                  <span className="text-xs text-slate-300">شامل حساب‌های مدیران پنل (Full Backup)</span>
                </label>
              </div>

              {/* Status Box */}
              {data?.settings?.telegram?.lastBackupAt && (
                <div className="rounded-xl border border-slate-800 bg-black/40 p-3 text-xs flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {data.settings.telegram.lastStatus === 'success' ? (
                      <CheckCircle2 size={16} className="text-emerald-400" />
                    ) : (
                      <AlertTriangle size={16} className="text-rose-400" />
                    )}
                    <span className="text-slate-300">
                      آخرین وضعیت ارسال:
                      <span className={data.settings.telegram.lastStatus === 'success' ? 'text-emerald-400 mr-1 font-bold' : 'text-rose-400 mr-1 font-bold'}>
                        {data.settings.telegram.lastStatus === 'success' ? 'موفق' : 'ناموفق'}
                      </span>
                    </span>
                  </div>
                  <div className="text-slate-400 font-mono text-[11px]" dir="ltr">
                    {new Date(data.settings.telegram.lastBackupAt).toLocaleString('fa-IR')}
                  </div>
                  {data.settings.telegram.lastError && (
                    <div className="w-full text-rose-400 text-[11px] font-mono mt-1" dir="ltr">
                      {data.settings.telegram.lastError}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={testTelegram}
                    disabled={testingTelegram}
                  >
                    {testingTelegram ? <RefreshCw size={14} className="animate-spin" /> : <Bot size={14} />}
                    تست اتصال
                  </button>

                  <button
                    type="button"
                    className="btn-ghost text-xs text-sky-300 hover:text-sky-200 border-sky-500/30"
                    onClick={sendBackupNow}
                    disabled={sendingTelegramNow || !telegramForm.botToken || !telegramForm.chatId}
                  >
                    {sendingTelegramNow ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                    ارسال فوری بک‌آپ به تلگرام
                  </button>
                </div>

                <button
                  className="btn-primary"
                  type="submit"
                  disabled={updateTelegram.isPending}
                >
                  {updateTelegram.isPending ? 'در حال ذخیره...' : 'ذخیره تنظیمات تلگرام'}
                </button>
              </div>
            </form>
          </GlassCard>

          {/* Manual Export & Import */}
          <div className="grid gap-6 md:grid-cols-2">
            <GlassCard className="space-y-4">
              <div className="flex items-center gap-2 text-cyan-400">
                <Download size={22} />
                <h3 className="text-lg font-bold">خروجی و دانلود پشتیبان (Export)</h3>
              </div>
              <p className="text-xs text-muted">
                تهیه فایل پشتیبان JSON کامل و قابل انتقال روی هر سرور جدید شامل تمام کاربران، پسوردها، ترافیک‌ها و گواهی‌ها.
              </p>
              <button className="btn-primary w-full" onClick={exportBackup}>
                دانلود فایل پشتیبان (JSON)
              </button>
            </GlassCard>

            <GlassCard className="space-y-4">
              <div className="flex items-center gap-2 text-indigo-400">
                <Upload size={22} />
                <h3 className="text-lg font-bold">بازیابی پشتیبان (Import)</h3>
              </div>
              <p className="text-xs text-muted">
                بازیابی اطلاعات از فایل پشتیبان قبلی با رمزنگاری مجدد خودکار برای سرور جدید.
              </p>
              <input
                type="file"
                ref={fileInputRef}
                accept=".json,application/json"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                className="btn-ghost w-full justify-center text-slate-200 hover:border-indigo-400"
                onClick={() => fileInputRef.current?.click()}
              >
                انتخاب فایل پشتیبان و بازیابی...
              </button>
            </GlassCard>
          </div>
        </div>
      )}

      {activeTab === 'security' && (
        <GlassCard className="max-w-xl space-y-4">
          <div className="flex items-center gap-2 text-rose-400">
            <Key size={22} />
            <h3 className="text-lg font-bold">تغییر رمز عبور مدیر ({meData?.user?.username || 'admin'})</h3>
          </div>
          <p className="text-xs text-muted">
            حداقل ۱۲ کاراکتر. پس از تغییر رمز، تمامی سشن‌های فعال این حساب لغو شده و باید مجدداً لاگین کنید.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              changePassword.mutate();
            }}
            className="space-y-3 pt-2"
          >
            <label className="block">
              <span className="text-xs text-slate-300">رمز عبور فعلی</span>
              <input
                className="input mt-1"
                type="password"
                value={pwForm.current}
                onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
                required
              />
            </label>

            <label className="block">
              <span className="text-xs text-slate-300">رمز عبور جدید (حداقل ۱۲ کاراکتر)</span>
              <input
                className="input mt-1"
                type="password"
                minLength={12}
                value={pwForm.next}
                onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })}
                required
              />
            </label>

            <label className="block">
              <span className="text-xs text-slate-300">تکرار رمز عبور جدید</span>
              <input
                className="input mt-1"
                type="password"
                minLength={12}
                value={pwForm.confirm}
                onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
                required
              />
            </label>

            <div className="flex justify-end pt-3">
              <button
                className="btn-primary bg-rose-600 hover:bg-rose-700 text-white"
                type="submit"
                disabled={changePassword.isPending}
              >
                {changePassword.isPending ? 'در حال تغییر...' : 'تغییر رمز عبور'}
              </button>
            </div>
          </form>
        </GlassCard>
      )}

      {/* Backup Import Confirmation Modal */}
      <Modal open={importConfirmOpen} onClose={() => setImportConfirmOpen(false)}>
        {backupPayload && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-indigo-400">
              <Database size={24} />
              <h3 className="text-lg font-bold">تایید بازیابی فایل پشتیبان</h3>
            </div>
            <p className="text-xs text-muted">
              فایل حاوی <b className="text-white">{backupPayload.counts?.users || 0}</b> کاربر و تنظیمات مربوط به تاریخ{' '}
              {backupPayload.exportedAt ? new Date(backupPayload.exportedAt).toLocaleDateString('fa-IR') : 'نامشخص'} است.
            </p>

            <div className="space-y-2 pt-2">
              <span className="text-xs font-semibold text-slate-300">حالت بازیابی:</span>
              <div className="space-y-1.5 text-xs">
                <label className="flex items-center gap-2 p-2 rounded-xl bg-[var(--surface-2)] cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    value="merge"
                    checked={importMode === 'merge'}
                    onChange={() => setImportMode('merge')}
                  />
                  <span>ادغام (Merge) - کاربران جدید اضافه می‌شوند و کاربران موجود حفظ می‌شوند.</span>
                </label>
                <label className="flex items-center gap-2 p-2 rounded-xl bg-[var(--surface-2)] cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    value="users-only"
                    checked={importMode === 'users-only'}
                    onChange={() => setImportMode('users-only')}
                  />
                  <span>فقط کاربران (Users Only) - بدون تغییر تنظیمات پنل.</span>
                </label>
                <label className="flex items-center gap-2 p-2 rounded-xl bg-[var(--surface-2)] cursor-pointer text-rose-300">
                  <input
                    type="radio"
                    name="importMode"
                    value="full"
                    checked={importMode === 'full'}
                    onChange={() => setImportMode('full')}
                  />
                  <span>جایگزینی کامل (Full Overwrite) - تمام کاربران قبلی حذف و با فایل جایگزین می‌شوند.</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--line)]">
              <button className="btn-ghost" onClick={() => setImportConfirmOpen(false)}>
                انصراف
              </button>
              <button
                className="btn-primary"
                onClick={() => importBackup.mutate()}
                disabled={importBackup.isPending}
              >
                {importBackup.isPending ? 'در حال بازیابی...' : 'شروع بازیابی'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
