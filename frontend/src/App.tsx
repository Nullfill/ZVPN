import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api } from './lib/api';
import Background3D from './components/Background3D';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/UsersPage';
import UserDetailPage from './pages/UserDetailPage';
import SessionsPage from './pages/SessionsPage';
import AuditPage from './pages/AuditPage';
import SettingsPage from './pages/SettingsPage';

function Protected({ children }: { children: React.ReactNode }) {
  const { isLoading, isError } = useQuery({ queryKey: ['me'], queryFn: () => api('/api/me'), retry: false, staleTime: 60_000 });
  if (isLoading) return <div className="flex min-h-screen items-center justify-center"><ShieldCheck className="animate-pulse" color="var(--accent)" size={40} /></div>;
  if (isError) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['me'], queryFn: () => api<{ panelName?: string }>('/api/me'), retry: false, staleTime: 60_000 });

  return (
    <>
      <Background3D />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Protected><Layout panelName={data?.panelName || 'ZVPN Panel'} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} /></Protected>}>
          <Route index element={<DashboardPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:id" element={<UserDetailPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="logs" element={<AuditPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </>
  );
}
