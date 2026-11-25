import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import AuthLayout from './AuthLayout';
import PasswordInput from '../components/PasswordInput';
import { useAuthStore } from '../context/authStore';
import { errMsg } from '../services/api';
import { useAppConfigStore } from '../context/appConfigStore';

export default function Login() {
  const login = useAuthStore((s) => s.login);
  const registrationEnabled = useAppConfigStore((s) => s.config.features.registration !== false);
  const navigate = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ identifier: '', password: '', otp: '' });
  const [busy, setBusy] = useState(false);
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await login(form);
      if (result.requiresTwoFactor) { setRequiresTwoFactor(true); toast('Enter the 6-digit code from your authenticator app.'); return; }
      navigate(loc.state?.from || '/', { replace: true });
    }
    catch (err) { toast.error(errMsg(err)); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to continue to your conversations."
      footer={registrationEnabled ? <>New to Pulse? <Link to="/register" state={{ from: loc.state?.from }} className="font-medium text-brand hover:underline">Create an account</Link></> : 'New account registration is temporarily closed.'}>
      <form onSubmit={submit} className="space-y-4">
        <input className="input" placeholder="Username, email or mobile number" autoComplete="username" required value={form.identifier} onChange={set('identifier')} />
        <PasswordInput placeholder="Password" autoComplete="current-password" required value={form.password} onChange={set('password')} />
        {requiresTwoFactor && <input className="input text-center tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit authenticator code" required value={form.otp} onChange={set('otp')} />}
        <div className="text-right text-sm"><Link to="/forgot-password" className="text-brand hover:underline">Forgot password?</Link></div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
      </form>
    </AuthLayout>
  );
}
