import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import AuthLayout from './AuthLayout';
import PasswordInput from '../components/PasswordInput';
import { useAuthStore } from '../context/authStore';
import { errMsg } from '../services/api';
import { useAppConfigStore } from '../context/appConfigStore';

export default function Register() {
  const register = useAuthStore((s) => s.register);
  const registrationEnabled = useAppConfigStore((s) => s.config.features.registration !== false);
  const navigate = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ name: '', username: '', email: '', phone: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return; }
    setBusy(true);
    try {
      const result = await register({ name: form.name, username: form.username, email: form.email, phone: form.phone, password: form.password });
      if (result.requiresVerification) { setPendingVerification(true); return; }
      navigate(loc.state?.from || '/', { replace: true });
    }
    catch (err) { toast.error(errMsg(err)); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title="Create your account" subtitle="Start chatting and calling in seconds."
      footer={<>Already have an account? <Link to="/login" state={{ from: loc.state?.from }} className="font-medium text-brand hover:underline">Log in</Link></>}>
      {!registrationEnabled ? <div className="rounded-xl border border-line bg-panel2 p-4 text-sm leading-6 text-mute">New account registration is temporarily closed.</div> : pendingVerification ? <div className="rounded-xl border border-line bg-panel2 p-4 text-sm leading-6 text-mute">Your account was created and is waiting for administrator verification. You can log in after an administrator verifies it.</div> :
      <form onSubmit={submit} className="space-y-4">
        <input className="input" placeholder="Full name" autoComplete="name" required minLength={2} maxLength={50} value={form.name} onChange={set('name')} />
        <input className="input" placeholder="Username" autoComplete="username" required minLength={3} maxLength={30} pattern="[A-Za-z0-9._]{3,30}" title="Use 3-30 letters, numbers, dots or underscores" value={form.username} onChange={set('username')} />
        <input className="input" type="email" placeholder="Email" autoComplete="email" required value={form.email} onChange={set('email')} />
        <input className="input" type="tel" placeholder="Mobile number (optional, e.g. +91 9876543210)" autoComplete="tel" value={form.phone} onChange={set('phone')} />
        <PasswordInput placeholder="Password (min 6 characters)" autoComplete="new-password" required minLength={6} value={form.password} onChange={set('password')} />
        <PasswordInput placeholder="Confirm password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Sign up'}</button>
      </form>
      }
    </AuthLayout>
  );
}
