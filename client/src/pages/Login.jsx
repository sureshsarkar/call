import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import AuthLayout from './AuthLayout';
import { useAuthStore } from '../context/authStore';
import { errMsg } from '../services/api';

export default function Login() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await login(form); navigate(loc.state?.from || '/', { replace: true }); }
    catch (err) { toast.error(errMsg(err)); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to continue to your conversations."
      footer={<>New to Pulse? <Link to="/register" className="font-medium text-brand hover:underline">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <input className="input" type="email" placeholder="Email" autoComplete="email" required value={form.email} onChange={set('email')} />
        <input className="input" type="password" placeholder="Password" autoComplete="current-password" required value={form.password} onChange={set('password')} />
        <div className="text-right text-sm"><Link to="/forgot-password" className="text-brand hover:underline">Forgot password?</Link></div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
      </form>
    </AuthLayout>
  );
}
