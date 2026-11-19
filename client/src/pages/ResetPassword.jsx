import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import AuthLayout from './AuthLayout';
import { authApi, errMsg } from '../services/api';
import { useAuthStore } from '../context/authStore';

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const applyAuth = useAuthStore((s) => s.applyAuth);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    setBusy(true);
    try {
      applyAuth(await authApi.reset(token, password));
      toast.success('Password updated');
      navigate('/', { replace: true });
    } catch (err) { toast.error(errMsg(err)); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title="Reset password" subtitle="Choose a new password for your account."
      footer={<Link to="/login" className="font-medium text-brand hover:underline">Back to log in</Link>}>
      <form onSubmit={submit} className="space-y-4">
        <input className="input" type="password" placeholder="New password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        <input className="input" type="password" placeholder="Confirm new password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
      </form>
    </AuthLayout>
  );
}
