import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera } from 'lucide-react';
import toast from 'react-hot-toast';
import Avatar from '../components/Avatar';
import { useAuthStore } from '../context/authStore';
import { userApi, errMsg } from '../services/api';

export default function Profile() {
  const navigate = useNavigate();
  const { user, updateProfile, uploadAvatar, applyAuth } = useAuthStore();
  const [form, setForm] = useState({ name: user.name, about: user.about });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await updateProfile(form); toast.success('Profile updated'); }
    catch (err) { toast.error(errMsg(err)); }
    finally { setBusy(false); }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { toast.error('Choose a JPG, PNG, WEBP or GIF image'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error('Image must be under 2MB'); return; }
    try { await uploadAvatar(file); toast.success('Profile picture updated'); }
    catch (err) { toast.error(errMsg(err)); }
  };

  const changePw = async (e) => {
    e.preventDefault();
    try {
      const res = await userApi.changePassword(pw);
      applyAuth(res); // other sessions are invalidated; keep this one
      setPw({ currentPassword: '', newPassword: '' });
      toast.success('Password changed');
    } catch (err) { toast.error(errMsg(err)); }
  };

  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-bg pb-safe">
      <header className="pt-safe flex items-center gap-1 bg-panel2 px-1 pb-3 md:gap-3 md:px-3">
        <button className="btn-icon h-11 w-11 text-ink md:hidden" onClick={() => navigate('/')}><ArrowLeft size={24} /></button>
        <h1 className="ml-2 text-lg font-semibold md:ml-0">Profile</h1>
      </header>
      <div className="mx-auto max-w-lg space-y-8 p-5">
        <div className="flex flex-col items-center gap-3">
          <button onClick={() => fileRef.current?.click()} className="group relative rounded-full" aria-label="Change profile picture">
            <Avatar user={user} size={140} />
            <span className="absolute inset-0 hidden place-items-center rounded-full bg-black/50 opacity-0 transition group-hover:opacity-100 md:grid"><Camera size={28} /></span>
            <span className="absolute bottom-1 right-1 grid h-11 w-11 place-items-center rounded-full bg-brand text-bg shadow-lg md:hidden"><Camera size={20} /></span>
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={onFile} />
          <p className="text-sm text-mute">{user.email}</p>
        </div>

        <form onSubmit={save} className="space-y-4">
          <label className="block text-sm text-mute">Name<input className="input mt-1" value={form.name} minLength={2} maxLength={50} required onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="block text-sm text-mute">About<input className="input mt-1" value={form.about} maxLength={140} onChange={(e) => setForm({ ...form, about: e.target.value })} /></label>
          <button className="btn-primary" disabled={busy}>Save changes</button>
        </form>

        <form onSubmit={changePw} className="space-y-4 border-t border-line pt-6">
          <h2 className="font-semibold">Change password</h2>
          <input className="input" type="password" placeholder="Current password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          <input className="input" type="password" placeholder="New password" autoComplete="new-password" required minLength={6} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          <button className="btn-primary">Update password</button>
        </form>
      </div>
    </div>
  );
}
