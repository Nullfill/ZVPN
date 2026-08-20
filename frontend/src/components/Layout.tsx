import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Activity, FileText, Gauge, LogOut, Menu, Moon, Settings, ShieldCheck, Sun, Users, Wifi, X, Server } from 'lucide-react';

const nav = [
  ['/', 'داشبورد', Gauge],
  ['/users', 'کاربران', Users],
  ['/sessions', 'جلسه‌های VPN', Wifi],
  ['/logs', 'لاگ‌ها', FileText],
  ['/settings', 'تنظیمات', Settings],
] as const;

export default function Layout({ panelName, mobileOpen, setMobileOpen }: {
  panelName: string;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [light, setLight] = useState(() => localStorage.getItem('zvpn-theme') === 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    localStorage.setItem('zvpn-theme', light ? 'light' : 'dark');
  }, [light]);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    navigate('/login');
  };

  return (
    <div dir="rtl" className="min-h-screen lg:pr-[288px]">
      <aside className={`sidebar fixed inset-y-0 right-0 z-40 w-[272px] p-3 transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="sidebar-inner flex h-full flex-col p-4">
          <div className="mb-8 flex items-center gap-3">
            <div className="brand-mark"><ShieldCheck size={23} /></div>
            <div>
              <p className="font-bold tracking-tight">{panelName}</p>
              <p className="text-xs text-muted">مدیریت IKEv2 / strongSwan</p>
            </div>
          </div>

          <nav aria-label="ناوبری اصلی" className="flex flex-col gap-1">
            {nav.map(([to, label, Icon]) => (
              <NavLink key={to} to={to} end={to === '/'} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Icon size={18} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto space-y-2">
            <div className="health-chip"><Activity size={15} /><span>سیستم آنلاین</span><i /></div>
            <button className="nav-item w-full" onClick={() => setLight((v) => !v)} aria-label="تغییر پوسته">
              {light ? <Moon size={18} /> : <Sun size={18} />}
              <span>{light ? 'پوسته تیره' : 'پوسته روشن'}</span>
            </button>
            <button className="nav-item w-full text-rose-300" onClick={logout}>
              <LogOut size={18} />
              <span>خروج</span>
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen && <button aria-label="بستن منو" className="fixed inset-0 z-30 bg-slate-950/70 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <header className="topbar sticky top-0 z-20 flex items-center justify-between px-4 py-3 lg:px-8">
        <button className="icon-button lg:hidden" onClick={() => setMobileOpen(!mobileOpen)} aria-label="منو">{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
        <div className="mr-auto flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">ZVPN Control Center</span>
          <span className="status-pill"><i /> Production</span>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] p-4 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
