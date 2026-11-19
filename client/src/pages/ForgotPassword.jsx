import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import AuthLayout from './AuthLayout';
import { authApi, errMsg } from '../services/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { setDone(await authApi.forgot(email)); }
    catch (err) { toast.error(errMsg(err)); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title="Forgot password" subtitle="Enter your email and we'll send you a reset link."
      footer={<Link to="/login" className="font-medium text-brand hover:underline">Back to log in</Link>}>
      {done ? (
        <div className="space-y-3 rounded-lg bg-panel2 p-4 text-sm">
          <p>{done.message}</p>
          {done.devResetUrl && (
            <p className="break-all text-xs text-mute">Dev mode (no SMTP configured): <a className="text-sky-400 underline" href={done.devResetUrl}>open reset link</a></p>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <input className="input" type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
    </AuthLayout>
  );
}
