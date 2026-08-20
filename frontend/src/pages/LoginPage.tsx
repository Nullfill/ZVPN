import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import Background3D from '../components/Background3D';

export default function LoginPage() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      navigate('/');
    } catch {
      setError('نام کاربری یا رمز عبور صحیح نیست.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <Background3D />
      <form onSubmit={submit} className="glass w-full max-w-md p-8">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/20 text-[var(--accent)]">
          <ShieldCheck size={30} />
        </div>
        <h1 className="text-2xl font-bold">ZVPN Panel</h1>
        <p className="mb-6 text-sm text-muted">Secure IKEv2 management console</p>
        <label className="mb-4 block">
          <span className="text-sm text-muted">نام کاربری</span>
          <input className="input mt-1" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
        </label>
        <label className="mb-4 block">
          <span className="text-sm text-muted">رمز عبور</span>
          <div className="relative">
            <input className="input pl-12" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            <button type="button" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" onClick={() => setShow((v) => !v)}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        {error && <p className="mb-4 text-sm text-rose-400">{error}</p>}
        <button className="btn-primary w-full" disabled={loading}>{loading ? '...' : 'ورود'}</button>
      </form>
    </div>
  );
}
