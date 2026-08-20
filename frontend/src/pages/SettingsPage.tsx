import { useEffect, useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings, Server, Shield, Database, Lock, Key, Download, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { GlassCard, PageHeader, Modal } from '../components/UI';
import { useToast } from '../components/Toast';
import VpnEndpointWizard from '../components/VpnEndpointWizard';

interface PanelSettings {
  general: { panelName: string; timezone: string; domain: string };
  vpn: { maxDevicesPolicy: string; serverAddress: string; remoteId: string; dns: string };
  appearance: { theme: string; animations: boolean; threeJs: boolean; glassIntensity: number };
  download: { tokenDays: number; pageTitle: string; supportText: string };
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'endpoint' | 'vpn' | 'backup' | 'security'>('general');

  // Form states
  const [generalForm, setGeneralForm] = useState({ panelName: '', timezone: '', domain: '' });
  const [vpnForm, setVpnForm] = useState({ maxDevicesPolicy: 'disconnect_oldest', dns: '' });
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
      const res = await fetch('/api/backup/export?includeAdmins=false', { credentials: 'include' });
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
        <div className="grid gap-6 md:grid-cols-2 max-w-4xl">
          <GlassCard className="space-y-4">
            <div className="flex items-center gap-2 text-cyan-400">
              <Download size={22} />
              <h3 className="text-lg font-bold">خروجی پشتیبان (Export)</h3>
            </div>
            <p className="text-xs text-muted">
              تهیه فایل پشتیبان JSON از تمام کاربران، توکن‌های دانلود، ترافیک‌های مصرفی و تنظیمات پنل.
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
              بازیابی اطلاعات از فایل پشتیبان قبلی بدون قطعی یا تغییر در آدرس سرور فعلی.
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
