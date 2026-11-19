import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import AuthLayout from './AuthLayout';
import { useAuthStore } from '../context/authStore';
import { errMsg } from '../services/api';

export default function Register() {
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return; }
    setBusy(true);
    try { await register({ name: form.name, email: form.email, password: form.password }); navigate('/', { replace: true }); }
    catch (err) { toast.error(errMsg(err)); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title="Create your account" subtitle="Start chatting and calling in seconds."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-brand hover:underline">Log in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <input className="input" placeholder="Full name" autoComplete="name" required minLength={2} maxLength={50} value={form.name} onChange={set('name')} />
        <input className="input" type="email" placeholder="Email" autoComplete="email" required value={form.email} onChange={set('email')} />
        <input className="input" type="password" placeholder="Password (8+ chars, letters & numbers)" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} />
        <input className="input" type="password" placeholder="Confirm password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Sign up'}</button>
      </form>
    </AuthLayout>
  );
}
