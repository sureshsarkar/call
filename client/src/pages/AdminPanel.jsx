import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { Activity, BellRing, ChartNoAxesCombined, ChevronLeft, ClipboardList, LayoutDashboard, LoaderCircle, LockKeyhole, Megaphone, RefreshCw, Search, Settings2, Shield, Trash2, UserPlus, Users, X, History, BadgeCheck, FileText, ExternalLink, Pencil } from 'lucide-react';
import { adminApi } from '../services/api';
import { useAuthStore } from '../context/authStore';

const nav = [
  ['overview', 'Overview', LayoutDashboard], ['users', 'Users', Users], ['controls', 'Controls', Settings2],
  ['roles', 'Roles & access', Shield], ['reports', 'Reports', ChartNoAxesCombined], ['announcements', 'Announcements', Megaphone], ['content', 'Website content', FileText], ['audit', 'Audit log', ClipboardList], ['security', 'Security', LockKeyhole],
];
const permissions = ['dashboard.view', 'users.view', 'users.edit', 'users.suspend', 'users.reset_password', 'users.delete', 'calls.view', 'settings.view', 'settings.manage', 'reports.view', 'notifications.send', 'content.manage', 'system.view'];
const cn = (...v) => v.filter(Boolean).join(' ');

function Button({ children, onClick, variant = 'normal', disabled, type = 'button' }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={cn('inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40', variant === 'danger' ? 'bg-red-500/10 text-red-300 hover:bg-red-500/20' : variant === 'primary' ? 'bg-brand text-bg hover:brightness-110' : 'bg-panel3 text-ink hover:bg-white/10')}>{children}</button>;
}
function Card({ label, value, icon: Icon, detail }) {
  return <div className="rounded-xl border border-line bg-panel2 p-4"><div className="flex items-center justify-between text-mute"><span className="text-sm">{label}</span><Icon size={18} /></div><p className="mt-3 text-2xl font-semibold text-ink">{value ?? '—'}</p>{detail && <p className="mt-1 text-xs text-mute">{detail}</p>}</div>;
}
function Empty({ children = 'No records found.' }) { return <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-mute">{children}</div>; }
function csvDownload(name, rows) {
  const csv = rows.map((row) => row.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

export default function AdminPanel() {
  const user = useAuthStore((s) => s.user);
  const [section, setSection] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const needsTwoFactor = user?.role === 'super_admin' && !user.twoFactorEnabled;
  const visibleNav = needsTwoFactor ? nav.filter(([id]) => id === 'security') : user?.role === 'super_admin' ? nav
    : user?.role === 'custom' ? nav.filter(([id]) => !['security', 'roles'].includes(id))
      : user?.role === 'admin' ? nav.filter(([id]) => !['security', 'roles', 'content', 'audit'].includes(id))
        : user?.role === 'moderator' ? nav.filter(([id]) => ['overview', 'users', 'reports'].includes(id))
          : nav.filter(([id]) => ['overview', 'users'].includes(id));

  const loadDashboard = useCallback(async () => {
    setLoading(true); setError('');
    try { setDashboard(await adminApi.dashboard()); }
    catch (e) { setError(e.response?.data?.message || 'Could not load dashboard.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (needsTwoFactor) setSection('security'); }, [needsTwoFactor]);
  useEffect(() => { if (!needsTwoFactor && section === 'overview') loadDashboard(); }, [section, loadDashboard, needsTwoFactor]);

  if (!['super_admin', 'admin', 'moderator', 'support', 'custom'].includes(user?.role)) return <div className="grid h-dvh-safe place-items-center bg-bg p-6 text-center"><div><LockKeyhole className="mx-auto mb-3 text-danger" /><h1 className="text-xl font-semibold">Admin access required</h1><p className="mt-2 text-sm text-mute">This account does not have an administrator role.</p></div></div>;

  return <div className="flex h-dvh-safe min-h-0 bg-bg text-ink">
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-panel2 p-3 md:flex">
      <div className="flex items-center gap-3 border-b border-line px-3 py-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-bg"><Shield size={19} /></span><div><p className="font-semibold">Pulse Admin</p><p className="text-xs text-mute">{user?.role?.replace('_', ' ')}</p></div></div>
      <nav className="mt-4 flex-1 space-y-1">{visibleNav.map(([id, label, Icon]) => <button key={id} onClick={() => setSection(id)} className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm', section === id ? 'bg-brand/15 text-brand' : 'text-mute hover:bg-panel3 hover:text-ink')}><Icon size={17} />{label}</button>)}</nav>
      <a href="/" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-mute hover:bg-panel3"><ChevronLeft size={16} />Back to chat</a>
    </aside>
    <main className="min-w-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-bg/95 px-4 py-3 backdrop-blur md:px-7">
        <div><div className="flex items-center gap-2 md:hidden"><a href="/" aria-label="Back to chat" className="text-mute"><ChevronLeft size={19} /></a><Shield size={16} className="text-brand" /><span className="text-sm font-semibold">Pulse Admin</span></div><h1 className="hidden text-xl font-semibold md:block">{nav.find((n) => n[0] === section)?.[1]}</h1></div>
        {section === 'overview' && <Button onClick={loadDashboard}><RefreshCw size={15} />Refresh</Button>}
        <div className="text-right text-xs text-mute"><span className="font-medium text-ink">{user?.name}</span><span className="hidden md:inline"> · {user?.email}</span></div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 md:hidden">{visibleNav.map(([id, label]) => <button key={id} onClick={() => setSection(id)} className={cn('shrink-0 rounded-full px-3 py-1.5 text-xs', section === id ? 'bg-brand text-bg' : 'bg-panel2 text-mute')}>{label}</button>)}</nav>
      <div className="mx-auto max-w-7xl p-4 md:p-7">
        {error && <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
        {loading && section === 'overview' ? <div className="grid min-h-64 place-items-center text-brand"><LoaderCircle className="animate-spin" /></div> : null}
        {needsTwoFactor && <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">Authenticator setup is required before Super Admin controls can be used.</p>}
        {!needsTwoFactor && !loading && section === 'overview' && <Overview data={dashboard} />}
        {!needsTwoFactor && section === 'users' && <UsersView />}
        {!needsTwoFactor && section === 'controls' && <ControlsView />}
        {!needsTwoFactor && section === 'roles' && <RolesView />}
        {!needsTwoFactor && section === 'reports' && <ReportsView />}
        {!needsTwoFactor && section === 'announcements' && <AnnouncementsView />}
        {!needsTwoFactor && section === 'content' && ['super_admin', 'custom'].includes(user?.role) && <ContentView />}
        {!needsTwoFactor && section === 'audit' && <AuditView />}
        {section === 'security' && user?.role === 'super_admin' && <SecurityView />}
      </div>
    </main>
  </div>;
}

function Overview({ data }) {
  if (!data) return <Empty>Dashboard data is not available.</Empty>;
  const cards = [
    ['Registered users', data.users.total, Users, `${data.users.active} active · ${data.users.inactive} inactive`],
    ['Online now', data.users.online, Activity, `${data.users.offline} offline`],
    ['Messages sent', data.messages, BellRing],
    ['Audio/video calls', data.calls, Activity, `${data.activeCalls} active · ${data.completedCalls} completed`],
    ['Conversations', data.conversations, Users], ['Groups', data.groups, Users], ['Group messages', data.groupMessages, BellRing],
    ['Open group reports', data.openGroupReports, Shield], ['Unread alerts', data.unreadNotifications, BellRing],
    ['Uploaded storage', data.storage?.uploadsBytes != null ? `${(data.storage.uploadsBytes / 1048576).toFixed(1)} MB` : '—', Activity, `Process memory ${data.storage?.processRssBytes ? `${Math.round(data.storage.processRssBytes / 1048576)} MB` : '—'}`],
    ['Application status', data.system?.status || 'unknown', Shield, `Uptime ${Math.round((data.system?.uptimeSeconds || 0) / 3600)} hours`],
  ];
  return <div className="space-y-6">
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(([label, value, icon, detail]) => <Card key={label} label={label} value={value} icon={icon} detail={detail} />)}</section>
    <section className="rounded-xl border border-line bg-panel2 p-4"><div className="mb-3 flex items-center gap-2"><Activity size={17} className="text-brand" /><h2 className="font-semibold">Recent admin activity</h2></div>{data.recentActivity?.length ? <div className="divide-y divide-line">{data.recentActivity.map((x) => <div key={x._id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><span className="font-medium">{x.actor?.name || 'Admin'}</span><span className="text-mute"> · {x.action}</span></div><time className="text-xs text-mute">{new Date(x.createdAt).toLocaleString()}</time></div>)}</div> : <Empty>No administrative actions recorded yet.</Empty>}</section>
  </div>;
}

function UsersView() {
  const actor = useAuthStore((s) => s.user);
  const isSuperAdmin = actor?.role === 'super_admin';
  const canEditUsers = ['super_admin', 'admin', 'custom'].includes(actor?.role);
  const canSuspendUsers = ['super_admin', 'admin', 'moderator', 'custom'].includes(actor?.role);
  const canResetPasswords = ['super_admin', 'admin', 'custom'].includes(actor?.role);
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [role, setRole] = useState(''); const [users, setUsers] = useState([]); const [page, setPage] = useState(1); const [total, setTotal] = useState(0); const [showNew, setShowNew] = useState(false); const [busy, setBusy] = useState(false); const [roles, setRoles] = useState([]); const [activityUser, setActivityUser] = useState(null); const [editingUser, setEditingUser] = useState(null);
  const load = useCallback(async () => { setBusy(true); try { const r = await adminApi.users({ q, status, role, page, limit: 25 }); setUsers(r.users); setTotal(r.total); } catch (e) { toast.error(e.response?.data?.message || 'Could not load users'); } finally { setBusy(false); } }, [q, status, role, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (isSuperAdmin) adminApi.roles().then(setRoles).catch(() => {}); }, [isSuperAdmin]);
  const act = async (fn, message) => { try { await fn(); toast.success(message); load(); } catch (e) { toast.error(e.response?.data?.message || 'Action failed'); } };
  const changeStatus = (u) => {
    if (u.accountStatus !== 'active') return act(() => adminApi.status(u._id, { status: 'active' }), 'Account activated');
    const value = window.prompt('Suspend for how many hours? Enter a positive number, or leave blank for an indefinite suspension.', '24');
    if (value === null) return;
    const hours = value.trim() ? Number(value) : 0;
    if (value.trim() && (!Number.isFinite(hours) || hours <= 0)) return toast.error('Enter a positive number of hours, or leave it blank.');
    const endTime = hours ? Date.now() + hours * 60 * 60 * 1000 : 0;
    if (hours && !Number.isFinite(new Date(endTime).getTime())) return toast.error('That suspension period is too long.');
    const until = hours ? new Date(endTime).toISOString() : undefined;
    return act(() => adminApi.status(u._id, { status: 'suspended', ...(until ? { until } : {}) }), hours ? `Account suspended for ${hours} hours` : 'Account suspended indefinitely');
  };
  const changeRole = async (u, value) => {
    const [role, customRole] = value.split(':');
    await act(() => adminApi.role(u._id, { role, ...(customRole ? { customRole } : {}) }), 'User role updated. They must sign in again.');
  };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><div className="flex min-w-52 flex-1 items-center gap-2 rounded-lg bg-panel2 px-3"><Search size={16} className="text-mute" /><input value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} placeholder="Search name, email, username" className="w-full bg-transparent py-2.5 text-sm outline-none" /></div><select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className="rounded-lg bg-panel2 px-3 py-2.5 text-sm"><option value="">All statuses</option><option>active</option><option>suspended</option><option>blocked</option></select><select value={role} onChange={(e) => { setPage(1); setRole(e.target.value); }} className="rounded-lg bg-panel2 px-3 py-2.5 text-sm"><option value="">All roles</option>{['super_admin', 'admin', 'moderator', 'support', 'custom', 'user'].map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</select>{canEditUsers && <Button variant="primary" onClick={() => setShowNew(true)}><UserPlus size={16} />Add user</Button>}</div>
    {showNew && <CreateUser onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
    <div className="overflow-x-auto rounded-xl border border-line bg-panel2"><table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b border-line text-xs uppercase text-mute"><tr>{['User', 'Role', 'Status', 'Last seen', 'Actions'].map((x) => <th key={x} className="px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-line">{users.map((u) => <tr key={u._id}>
      <td className="px-4 py-3"><p className="font-medium">{u.name}</p><p className="text-xs text-mute">{u.email} · @{u.username}</p></td>
      <td className="px-4 py-3">{isSuperAdmin && u.role !== 'super_admin' ? <select aria-label={`Role for ${u.name}`} value={u.role === 'custom' ? `custom:${u.customRole?._id || ''}` : u.role} onChange={(e) => changeRole(u, e.target.value)} className="max-w-44 rounded-lg bg-panel3 px-2 py-1.5 text-xs"><option value="user">Normal user</option><option value="admin">Admin</option><option value="moderator">Moderator</option><option value="support">Support staff</option>{roles.filter((r) => r.active).map((r) => <option key={r._id} value={`custom:${r._id}`}>{r.name}</option>)}</select> : <span className="rounded-full bg-panel3 px-2 py-1 text-xs">{u.role === 'custom' ? u.customRole?.name || 'custom' : u.role?.replace('_', ' ')}</span>}</td>
      <td className="px-4 py-3"><span className={cn('rounded-full px-2 py-1 text-xs', u.accountStatus === 'active' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300')}>{u.accountStatus || 'active'}</span>{u.isVerified && <span className="ml-2 text-xs text-sky-300">verified</span>}</td>
      <td className="px-4 py-3 text-xs text-mute">{u.isOnline ? 'Online' : u.lastSeen ? new Date(u.lastSeen).toLocaleString() : '—'}</td>
      <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{u.role !== 'super_admin' ? <>
        {canSuspendUsers && <><Button onClick={() => changeStatus(u)}>{u.accountStatus === 'active' ? 'Suspend' : 'Activate'}</Button>{u.accountStatus !== 'blocked' && <Button onClick={() => { if (window.confirm(`Permanently block ${u.name}?`)) act(() => adminApi.status(u._id, { status: 'blocked' }), 'Account blocked'); }}>Block</Button>}</>}
        {canResetPasswords && <><Button onClick={() => act(() => adminApi.resetPassword(u._id), 'Reset link sent')}>Reset password</Button><Button onClick={() => { if (window.confirm(`Sign ${u.name} out of every device?`)) act(() => adminApi.revokeSessions(u._id), 'All active sessions revoked'); }}>Sign out devices</Button></>}
        {canEditUsers && <><Button onClick={() => setEditingUser(u)}><Pencil size={14} />Edit</Button><Button onClick={() => act(() => adminApi.updateUser(u._id, { isVerified: !u.isVerified }), u.isVerified ? 'Verification removed' : 'Account verified')}><BadgeCheck size={14} />{u.isVerified ? 'Unverify' : 'Verify'}</Button></>}
        <Button onClick={async () => { try { setActivityUser(await adminApi.userActivity(u._id)); } catch (e) { toast.error(e.response?.data?.message || 'Could not load account activity'); } }}><History size={14} />Activity</Button>
        {isSuperAdmin && <Button variant="danger" onClick={() => { if (window.confirm(`Permanently delete ${u.name} and associated account data?`)) act(() => adminApi.deleteUser(u._id), 'User deleted'); }}><Trash2 size={14} /></Button>}
      </> : <span className="text-xs text-mute">Protected Super Admin account</span>}</div></td>
    </tr>)}</tbody></table>{busy && <p className="p-4 text-sm text-mute">Loading…</p>}{!busy && !users.length && <div className="p-8"><Empty>No users match this search.</Empty></div>}</div>
    <div className="flex items-center justify-between text-sm text-mute"><span>{total} accounts</span><div className="flex gap-2"><Button disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>Previous</Button><Button disabled={page * 25 >= total} onClick={() => setPage((x) => x + 1)}>Next</Button></div></div>
    {activityUser && <UserActivityModal data={activityUser} onClose={() => setActivityUser(null)} />}
    {editingUser && <EditUserModal user={editingUser} onClose={() => setEditingUser(null)} onSaved={() => { setEditingUser(null); load(); }} />}
  </div>;
}

function UserActivityModal({ data, onClose }) {
  const { user, activity } = data;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><section className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-panel2 p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">{user.name} · account activity</h2><p className="text-xs text-mute">{user.email}</p></div><button onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Messages sent', activity.messagesSent], ['Messages received', activity.messagesReceived], ['Calls', activity.calls], ['Status', user.accountStatus]].map(([label, value]) => <div key={label} className="rounded-lg bg-panel3 p-3"><p className="text-xs text-mute">{label}</p><p className="mt-1 font-semibold">{value ?? 0}</p></div>)}</div><h3 className="mb-2 text-sm font-semibold">Recent sign-ins</h3>{activity.loginHistory.length ? <div className="space-y-2">{activity.loginHistory.map((event) => <div key={event._id} className="rounded-lg bg-panel3 p-3 text-xs"><div className="flex justify-between gap-3"><span>{new Date(event.createdAt).toLocaleString()}</span><span>{event.success ? 'Successful' : 'Failed'}</span></div><p className="mt-1 break-all text-mute">{event.ip || 'Unknown IP'} · {event.userAgent || 'Unknown device'}</p></div>)}</div> : <Empty>No sign-in history recorded.</Empty>}</section></div>;
}

function EditUserModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({ name: user.name || '', username: user.username || '', email: user.email || '', phone: user.phone || '', about: user.about || '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await adminApi.updateUser(user._id, form); toast.success('Account updated'); onSaved(); }
    catch (error) { toast.error(error.response?.data?.message || 'Could not update account'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><form onSubmit={submit} className="w-full max-w-lg space-y-3 rounded-2xl border border-line bg-panel2 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Edit account</h2><p className="text-xs text-mute">Changing email or phone signs the user out of all devices.</p></div><button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>{[['name', 'Name'], ['username', 'Username'], ['email', 'Email'], ['phone', 'Mobile number'], ['about', 'About']].map(([key, label]) => <label key={key} className="block text-sm text-mute">{label}<input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="mt-1 w-full rounded-lg bg-panel3 px-3 py-2 text-ink" /></label>)}<div className="flex gap-2"><Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save account'}</Button><Button onClick={onClose}>Cancel</Button></div></form></div>;
}

function CreateUser({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', username: '' }); const [saving, setSaving] = useState(false);
  const submit = async (e) => { e.preventDefault(); setSaving(true); try { await adminApi.createUser(form); toast.success('Account created; password setup email sent'); onCreated(); } catch (err) { toast.error(err.response?.data?.message || 'Could not create account'); } finally { setSaving(false); } };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-panel2 p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Create account</h2><button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>{[['name', 'Full name'], ['email', 'Email address'], ['username', 'Username']].map(([key, label]) => <label key={key} className="block text-sm text-mute">{label}<input required value={form[key]} onChange={(e) => setForm((x) => ({ ...x, [key]: e.target.value }))} className="mt-1 w-full rounded-lg bg-panel3 px-3 py-2 text-ink outline-none" /></label>)}<Button type="submit" variant="primary" disabled={saving}>{saving ? 'Creating…' : 'Create user'}</Button></form></div>;
}

function ControlsView() {
  const actorRole = useAuthStore((s) => s.user?.role);
  const canManage = ['super_admin', 'custom'].includes(actorRole);
  const [config, setConfig] = useState(null); const [saving, setSaving] = useState(false);
  useEffect(() => { adminApi.config().then(setConfig).catch((e) => toast.error(e.response?.data?.message || 'Could not load settings')); }, []);
  const save = async () => { setSaving(true); try { const result = await adminApi.saveConfig(config); setConfig(result.config); if (result.retentionWarning) toast.error(result.retentionWarning); else toast.success('Application controls saved'); } catch (e) { toast.error(e.response?.data?.message || 'Could not save settings'); } finally { setSaving(false); } };
  if (!config) return <p className="text-sm text-mute">Loading settings…</p>;
  const featureLabels = { chat: 'Chat & messaging', audioCalls: 'Audio calls', videoCalls: 'Video calls', screenSharing: 'Screen sharing', groupChat: 'Group chat', fileSharing: 'Group media and files', pushNotifications: 'Push notifications', pwaInstall: 'PWA installation', registration: 'New user registration', userVerification: 'Require user verification' };
  return <div className="mx-auto max-w-3xl space-y-5">{!canManage && <p className="rounded-lg bg-panel3 p-3 text-sm text-mute">You have read-only access to these settings.</p>}<section className="space-y-4 rounded-xl border border-line bg-panel2 p-5"><h2 className="font-semibold">Application settings</h2><label className="block text-sm text-mute">Application name<input readOnly={!canManage} value={config.appName || ''} onChange={(e) => setConfig({ ...config, appName: e.target.value })} className="mt-1 w-full rounded-lg bg-panel3 px-3 py-2 text-ink disabled:opacity-60" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-mute">Message retention (hours; 0 keeps forever)<input disabled={!canManage} type="number" min="0" max="8760" value={config.messageTtlHours} onChange={(e) => setConfig({ ...config, messageTtlHours: Number(e.target.value) })} className="mt-1 w-full rounded-lg bg-panel3 px-3 py-2 text-ink disabled:opacity-60" /></label><label className="text-sm text-mute">Maximum message length<input disabled={!canManage} type="number" min="1" max="10000" value={config.maxMessageLength} onChange={(e) => setConfig({ ...config, maxMessageLength: Number(e.target.value) })} className="mt-1 w-full rounded-lg bg-panel3 px-3 py-2 text-ink disabled:opacity-60" /></label><label className="text-sm text-mute">Maximum call duration (minutes; 0 means unlimited)<input disabled={!canManage} type="number" min="0" max="1440" value={config.callDurationLimitMinutes ?? 0} onChange={(e) => setConfig({ ...config, callDurationLimitMinutes: Number(e.target.value) })} className="mt-1 w-full rounded-lg bg-panel3 px-3 py-2 text-ink disabled:opacity-60" /></label><label className="text-sm text-mute">Maximum members per group<input disabled={!canManage} type="number" min="2" max="512" value={config.maxGroupMembers ?? 256} onChange={(e) => setConfig({ ...config, maxGroupMembers: Number(e.target.value) })} className="mt-1 w-full rounded-lg bg-panel3 px-3 py-2 text-ink disabled:opacity-60" /></label><label className="text-sm text-mute">Maximum group file size (MB)<input disabled={!canManage} type="number" min="1" max="100" value={config.maxGroupFileSizeMb ?? 25} onChange={(e) => setConfig({ ...config, maxGroupFileSizeMb: Number(e.target.value) })} className="mt-1 w-full rounded-lg bg-panel3 px-3 py-2 text-ink disabled:opacity-60" /></label></div><Toggle checked={config.maintenanceMode} label="Maintenance mode" desc="Only Super Admin accounts can use the API while maintenance mode is active." disabled={!canManage} onChange={(v) => setConfig({ ...config, maintenanceMode: v })} /></section><section className="space-y-2 rounded-xl border border-line bg-panel2 p-5"><h2 className="mb-3 font-semibold">Global feature controls</h2>{Object.entries(featureLabels).map(([key, label]) => <Toggle key={key} checked={Boolean(config.features?.[key])} label={label} disabled={!canManage} onChange={(v) => setConfig({ ...config, features: { ...config.features, [key]: v } })} />)}</section>{canManage && <Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save controls'}</Button>}</div>;
}

function Toggle({ checked, label, desc, onChange, disabled }) { return <label className={cn('flex items-center justify-between gap-4 border-b border-line py-3 last:border-0', disabled ? 'opacity-40' : 'cursor-pointer')}><span><span className="block text-sm font-medium">{label}</span>{desc && <span className="text-xs text-mute">{desc}</span>}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-emerald-500" /></label>; }

function RolesView() {
  const empty = { name: '', description: '', permissions: [] };
  const [roles, setRoles] = useState([]); const [form, setForm] = useState(empty); const [editingId, setEditingId] = useState(null); const [saving, setSaving] = useState(false);
  const load = useCallback(() => adminApi.roles().then(setRoles).catch((e) => toast.error(e.response?.data?.message || 'Could not load roles')), []);
  useEffect(() => { load(); }, [load]);
  const submit = async (e) => { e.preventDefault(); setSaving(true); try { if (editingId) await adminApi.updateRole(editingId, form); else await adminApi.createRole(form); setForm(empty); setEditingId(null); toast.success(editingId ? 'Role updated' : 'Role created'); load(); } catch (e2) { toast.error(e2.response?.data?.message || 'Could not save role'); } finally { setSaving(false); } };
  const toggleActive = async (role) => { try { await adminApi.updateRole(role._id, { active: !role.active }); toast.success(role.active ? 'Role disabled' : 'Role enabled'); load(); } catch (e) { toast.error(e.response?.data?.message || 'Could not update role'); } };
  const builtins = ['Super Admin', 'Admin', 'Moderator', 'Support Staff', 'Normal User'];
  return <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-xl border border-line bg-panel2 p-5"><h2 className="mb-3 font-semibold">Built-in roles</h2>{builtins.map((x) => <p key={x} className="border-b border-line py-3 text-sm">{x}<span className="float-right text-xs text-mute">System role</span></p>)}<h2 className="mb-2 mt-6 font-semibold">Custom roles</h2>{roles.map((r) => <div key={r._id} className="flex items-center justify-between gap-3 border-b border-line py-3 text-sm"><div className="min-w-0"><p>{r.name}{!r.active && <span className="ml-2 text-xs text-danger">inactive</span>}</p><p className="break-words text-xs text-mute">{r.permissions.join(', ') || 'No permissions'}</p></div>{!r.system && <div className="flex shrink-0 gap-1"><Button onClick={() => { setEditingId(r._id); setForm({ name: r.name, description: r.description || '', permissions: r.permissions || [] }); }}>Edit</Button><Button onClick={() => toggleActive(r)}>{r.active ? 'Disable' : 'Enable'}</Button><Button variant="danger" onClick={async () => { if (window.confirm(`Delete role ${r.name}? Assigned users will become normal users.`)) { try { await adminApi.deleteRole(r._id); if (editingId === r._id) { setEditingId(null); setForm(empty); } load(); } catch (e) { toast.error(e.response?.data?.message || 'Could not delete role'); } } }}><Trash2 size={14} /></Button></div>}</div>)}</section><form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-panel2 p-5"><h2 className="font-semibold">{editingId ? 'Edit custom role' : 'Create custom role'}</h2><input required minLength={2} maxLength={40} placeholder="Role name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg bg-panel3 px-3 py-2 text-sm" /><input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg bg-panel3 px-3 py-2 text-sm" /><div className="max-h-72 space-y-1 overflow-y-auto">{permissions.map((p) => <label key={p} className="flex items-center gap-2 py-1 text-sm text-mute"><input type="checkbox" checked={form.permissions.includes(p)} onChange={(e) => setForm({ ...form, permissions: e.target.checked ? [...form.permissions, p] : form.permissions.filter((x) => x !== p) })} />{p}</label>)}</div><div className="flex gap-2"><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save role' : 'Create role'}</Button>{editingId && <Button onClick={() => { setEditingId(null); setForm(empty); }}>Cancel</Button>}</div></form></div>;
}

function ReportsView() {
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [groupReports, setGroupReports] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); try { setData(await adminApi.report({ from, to })); } catch (e) { toast.error(e.response?.data?.message || 'Could not load report'); } finally { setBusy(false); } }, [from, to]);
  useEffect(() => { load(); }, []); // initial report uses the default 30-day range
  const loadGroupReports = useCallback(() => adminApi.groupReports().then(setGroupReports).catch((e) => toast.error(e.response?.data?.message || 'Could not load group reports')), []);
  useEffect(() => { loadGroupReports(); }, [loadGroupReports]);
  const reviewGroupReport = async (id, status) => {
    try { await adminApi.reviewGroupReport(id, status); toast.success(status === 'reviewed' ? 'Report marked reviewed' : 'Report dismissed'); loadGroupReports(); }
    catch (e) { toast.error(e.response?.data?.message || 'Could not update report'); }
  };
  const exportCsv = () => {
    if (!data) return;
    const maps = (arr) => Object.fromEntries(arr.map((x) => [x._id, x.count]));
    const reg = maps(data.registrations), msg = maps(data.messages), call = maps(data.calls), active = maps(data.activeUsersByDay), monthly = maps(data.activeUsersByMonth), errors = maps(data.systemErrors);
    const dates = [...new Set([...data.registrations, ...data.messages, ...data.calls, ...data.activeUsersByDay, ...data.systemErrors].map((x) => x._id))].sort();
    csvDownload('pulse-report.csv', [['Date', 'Registrations', 'Messages', 'Calls', 'Active users that day', 'Active users that month', 'Server errors'], ...dates.map((d) => [d, reg[d] || 0, msg[d] || 0, call[d] || 0, active[d] || 0, monthly[d.slice(0, 7)] || 0, errors[d] || 0])]);
  };
  const panels = data && [['Registrations', data.registrations], ['Messages', data.messages], ['Calls', data.calls], ['Daily active users', data.activeUsersByDay], ['Monthly active users', data.activeUsersByMonth], ['Server errors', data.systemErrors]];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2 rounded-xl bg-panel2 p-4"><label className="text-xs text-mute">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded bg-panel3 p-2 text-sm text-ink" /></label><label className="text-xs text-mute">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded bg-panel3 p-2 text-sm text-ink" /></label><Button variant="primary" onClick={load}>{busy ? 'Loading…' : 'Apply dates'}</Button><Button onClick={exportCsv} disabled={!data}>Export CSV for Excel</Button><Button onClick={() => window.print()} disabled={!data}>Print / Save PDF</Button><span className="ml-auto text-xs text-mute">Successful sign-ins: {data?.logins ?? '—'} · Server errors: {data?.systemErrorCount ?? '—'}</span></div>
    {data && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{panels.map(([title, rows]) => <section key={title} className="rounded-xl border border-line bg-panel2 p-4"><h2 className="mb-3 font-semibold">{title}</h2><div className="max-h-80 space-y-2 overflow-y-auto">{rows.map((x) => <div key={x._id} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2 text-xs"><span className="truncate text-mute">{x._id}</span><div className="h-2 overflow-hidden rounded bg-panel3"><div className="h-full rounded bg-brand" style={{ width: `${Math.max(3, (x.count / Math.max(1, ...rows.map((row) => row.count))) * 100)}%` }} /></div><b className="text-right">{x.count}</b></div>)}{!rows.length && <p className="text-sm text-mute">No activity in this range.</p>}</div></section>)}</div>}
    <section className="rounded-xl border border-line bg-panel2 p-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Group message reports</h2><p className="text-xs text-mute">Reports submitted by group members</p></div><Button onClick={loadGroupReports}>Refresh</Button></div>{groupReports.length ? <div className="space-y-2">{groupReports.map((report) => <article key={report._id} className="rounded-lg bg-panel3 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{report.group?.name || 'Deleted group'}</b><span className="text-xs capitalize text-mute">{report.status} · {new Date(report.createdAt).toLocaleString()}</span></div><p className="mt-1 text-sm">{report.reason}</p>{report.message?.text && <p className="mt-2 border-l-2 border-brand px-2 text-xs text-mute">{report.message.text}</p>}<p className="mt-2 text-xs text-mute">Reported by {report.reporter?.name || 'Unknown user'}</p>{report.status === 'open' && <div className="mt-3 flex gap-2"><Button onClick={() => reviewGroupReport(report._id, 'reviewed')}>Mark reviewed</Button><Button variant="danger" onClick={() => reviewGroupReport(report._id, 'dismissed')}>Dismiss</Button></div>}</article>)}</div> : <Empty>No open group reports.</Empty>}</section>
  </div>;
}

function AnnouncementsView() {
  const [form, setForm] = useState({ title: '', body: '', audience: 'all', recipients: '' }); const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const load = useCallback(() => adminApi.announcements().then(setHistory).catch((e) => toast.error(e.response?.data?.message || 'Could not load announcements')), []);
  useEffect(() => { load(); }, [load]);
  const submit = async (e) => { e.preventDefault(); if (!window.confirm('Send this announcement to the selected audience?')) return; setBusy(true); try { const r = await adminApi.announce({ ...form, recipients: form.recipients.split(/[ ,\n]+/).filter(Boolean) }); toast.success(`Announcement queued for ${r.deliveredTo} accounts`); setForm({ title: '', body: '', audience: 'all', recipients: '' }); load(); } catch (e2) { toast.error(e2.response?.data?.message || 'Could not send announcement'); } finally { setBusy(false); } };
  return <div className="grid items-start gap-5 xl:grid-cols-[minmax(320px,1fr)_minmax(0,1fr)]"><form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-panel2 p-5"><h2 className="font-semibold">Send announcement</h2><input required maxLength={120} placeholder="Announcement title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-lg bg-panel3 px-3 py-2 text-sm" /><textarea required maxLength={500} rows={5} placeholder="Message" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="w-full resize-y rounded-lg bg-panel3 px-3 py-2 text-sm" /><select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className="rounded-lg bg-panel3 px-3 py-2 text-sm"><option value="all">All active users</option><option value="selected">Selected user IDs</option></select>{form.audience === 'selected' && <textarea required placeholder="Paste user IDs, separated by spaces or commas (max 500)" value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} className="w-full rounded-lg bg-panel3 px-3 py-2 font-mono text-xs" />}<p className="text-xs text-mute">Announcements appear in Alerts and use Web Push where the recipient has subscribed.</p><Button type="submit" variant="primary" disabled={busy}><Megaphone size={16} />{busy ? 'Sending…' : 'Send announcement'}</Button></form><section className="rounded-xl border border-line bg-panel2 p-5"><h2 className="mb-3 font-semibold">Recent announcements</h2>{history.length ? <div className="max-h-[70dvh] space-y-2 overflow-y-auto">{history.map((item) => <article key={item._id} className="rounded-lg bg-panel3 p-3"><div className="flex justify-between gap-2"><b className="text-sm">{item.title}</b><span className="shrink-0 text-xs text-mute">{new Date(item.createdAt).toLocaleString()}</span></div><p className="mt-1 whitespace-pre-wrap text-sm text-mute">{item.body}</p><p className="mt-2 text-[11px] text-mute">{item.recipientCount} recipients · {item.audience} · {item.sender?.name || 'Admin'}</p></article>)}</div> : <Empty>No announcements sent yet.</Empty>}</section></div>;
}

function AuditView() {
  const [data, setData] = useState({ logs: [], total: 0 }); const [page, setPage] = useState(1);
  const load = useCallback(() => adminApi.logs({ page, limit: 50 }).then(setData).catch((e) => toast.error(e.response?.data?.message || 'Could not load audit log')), [page]);
  useEffect(() => { load(); }, [load]);
  return <div className="space-y-3"><div className="rounded-xl border border-line bg-panel2">{data.logs.map((x) => <div key={x._id} className="flex flex-wrap justify-between gap-2 border-b border-line px-4 py-3 text-sm last:border-0"><div><b>{x.actor?.name || 'Account'}</b><span className="text-mute"> · {x.action}{x.targetType ? ` · ${x.targetType} ${x.targetId}` : ''}</span></div><time className="text-xs text-mute">{new Date(x.createdAt).toLocaleString()}</time></div>)}{!data.logs.length && <div className="p-4"><Empty>Audit events will appear here as administrators use the panel.</Empty></div>}</div><div className="flex items-center justify-between text-sm text-mute"><span>{data.total} events</span><div className="flex gap-2"><Button disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>Previous</Button><Button disabled={page * 50 >= data.total} onClick={() => setPage((x) => x + 1)}>Next</Button></div></div></div>;
}

function SecurityView() {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => adminApi.twoFactorStatus().then(setStatus).catch((e) => toast.error(e.response?.data?.message || 'Could not load security status')), []);
  useEffect(() => { load(); }, [load]);
  const beginSetup = async () => {
    setBusy(true);
    try { setSetup(await adminApi.setupTwoFactor()); toast('Add the secret to an authenticator app, then confirm a current code.'); }
    catch (e) { toast.error(e.response?.data?.message || 'Could not start setup'); }
    finally { setBusy(false); }
  };
  const enable = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const result = await adminApi.enableTwoFactor(code); useAuthStore.getState().applyAuth(result); setStatus({ enabled: true }); setSetup(null); setCode(''); toast.success('Two-factor authentication is enabled'); }
    catch (e2) { toast.error(e2.response?.data?.message || 'Could not enable two-factor authentication'); }
    finally { setBusy(false); }
  };
  const disable = async (e) => {
    e.preventDefault();
    if (!window.confirm('Disable Super Admin two-factor authentication? Your active sessions will be signed out.')) return;
    setBusy(true);
    try { await adminApi.disableTwoFactor(code); useAuthStore.getState().expire(); navigate('/login', { replace: true }); toast.success('Two-factor authentication disabled. Sign in again to continue.'); }
    catch (e2) { toast.error(e2.response?.data?.message || 'Could not disable two-factor authentication'); }
    finally { setBusy(false); }
  };
  if (!status) return <p className="text-sm text-mute">Loading security settings…</p>;
  return <div className="mx-auto max-w-2xl space-y-5">
    <section className="space-y-3 rounded-xl border border-line bg-panel2 p-5">
      <div className="flex items-center gap-3"><LockKeyhole className="text-brand" /><div><h2 className="font-semibold">Super Admin two-factor authentication</h2><p className="text-sm text-mute">Require a rotating 6-digit authenticator code when the Super Admin signs in.</p></div></div>
      <p className={`text-sm ${status.enabled ? 'text-emerald-300' : 'text-amber-300'}`}>Status: {status.enabled ? 'Enabled' : 'Not enabled'}</p>
      {setup && <div className="space-y-2 rounded-lg border border-line bg-panel3 p-4 text-sm"><p>Add this key to an authenticator app such as Google Authenticator, Microsoft Authenticator, or 1Password:</p><code className="block select-all break-all rounded bg-black/20 p-3 text-brand">{setup.secret}</code><p className="text-xs text-mute">Manual setup URI: <span className="select-all break-all">{setup.otpauthUrl}</span></p></div>}
      {!status.enabled && !setup && <Button variant="primary" disabled={busy} onClick={beginSetup}>{busy ? 'Preparing…' : 'Set up authenticator'}</Button>}
      {(setup || status.enabled) && <form onSubmit={status.enabled ? disable : enable} className="flex flex-wrap gap-2"><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" className="min-w-40 flex-1 rounded-lg bg-panel3 px-3 py-2 text-sm tracking-[0.3em]" />{status.enabled ? <Button type="submit" variant="danger" disabled={busy}>{busy ? 'Working…' : 'Disable 2FA'}</Button> : <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Confirming…' : 'Confirm and enable'}</Button>}</form>}
    </section>
    <p className="text-xs leading-5 text-mute">Authenticator secrets are encrypted in the database using TWO_FACTOR_ENCRYPTION_KEY. Keep it stable; changing it requires setting up the authenticator again.</p>
  </div>;
}

function ContentView() {
  const empty = { kind: 'page', title: '', slug: '', excerpt: '', body: '', category: '', metaTitle: '', metaDescription: '', published: false };
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => adminApi.content().then(setEntries).catch((e) => toast.error(e.response?.data?.message || 'Could not load website content')), []);
  useEffect(() => { load(); }, [load]);
  const slugFromTitle = (value) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const edit = (entry) => { setEditingId(entry._id); setForm({ ...empty, ...entry }); };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      if (editingId) await adminApi.updateContent(editingId, form);
      else await adminApi.createContent(form);
      toast.success(form.published ? 'Content saved and published' : 'Draft saved');
      setEditingId(null); setForm(empty); await load();
    } catch (error) { toast.error(error.response?.data?.message || 'Could not save content'); }
    finally { setBusy(false); }
  };
  const remove = async (entry) => {
    if (!window.confirm(`Delete “${entry.title}”? This cannot be undone.`)) return;
    try { await adminApi.deleteContent(entry._id); if (editingId === entry._id) { setEditingId(null); setForm(empty); } toast.success('Content deleted'); load(); }
    catch (e) { toast.error(e.response?.data?.message || 'Could not delete content'); }
  };
  return <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,1fr)]">
    <section className="rounded-xl border border-line bg-panel2 p-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Pages, blog posts and FAQs</h2><p className="text-xs text-mute">Published entries are available at /content/slug.</p></div><Button onClick={() => { setEditingId(null); setForm(empty); }}><UserPlus size={15} />New</Button></div>
      {entries.length ? <div className="divide-y divide-line">{entries.map((entry) => <div key={entry._id} className="flex items-center gap-3 py-3"><button onClick={() => edit(entry)} className="min-w-0 flex-1 text-left"><span className="flex items-center gap-2"><b className="truncate text-sm">{entry.title}</b><span className="rounded bg-panel3 px-1.5 py-0.5 text-[10px] uppercase text-mute">{entry.kind}</span><span className={`text-[10px] ${entry.published ? 'text-emerald-300' : 'text-amber-300'}`}>{entry.published ? 'Published' : 'Draft'}</span></span><span className="block truncate text-xs text-mute">/{entry.slug}</span></button>{entry.published && <a href={`/content/${encodeURIComponent(entry.slug)}`} target="_blank" rel="noreferrer" title="Open public page" className="text-mute"><ExternalLink size={16} /></a>}<Button variant="danger" onClick={() => remove(entry)} aria-label={`Delete ${entry.title}`}><Trash2 size={14} /></Button></div>)}</div> : <Empty>No website content yet.</Empty>}
    </section>
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-panel2 p-5"><h2 className="font-semibold">{editingId ? 'Edit content' : 'Create content'}</h2>
      <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="w-full rounded-lg bg-panel3 px-3 py-2 text-sm"><option value="page">Static page</option><option value="blog">Blog post</option><option value="faq">FAQ</option><option value="category">Category</option><option value="contact">Contact information</option></select>
      <input required maxLength={160} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, ...(editingId || form.slug ? {} : { slug: slugFromTitle(e.target.value) }) })} className="w-full rounded-lg bg-panel3 px-3 py-2 text-sm" />
      <label className="block text-xs text-mute">URL slug<input required maxLength={120} pattern="[a-zA-Z0-9-]+" placeholder="terms-and-conditions" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="mt-1 w-full rounded-lg bg-panel3 px-3 py-2 text-sm text-ink" /></label>
      <input maxLength={80} placeholder="Category (optional)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full rounded-lg bg-panel3 px-3 py-2 text-sm" />
      <textarea maxLength={500} rows={2} placeholder="Summary / excerpt" value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} className="w-full rounded-lg bg-panel3 px-3 py-2 text-sm" />
      <textarea maxLength={50000} rows={10} placeholder="Content (plain text; line breaks are preserved)" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="w-full resize-y rounded-lg bg-panel3 px-3 py-2 text-sm" />
      <details className="rounded-lg bg-panel3 p-3"><summary className="cursor-pointer text-sm">SEO metadata</summary><div className="mt-3 space-y-3"><input maxLength={160} placeholder="Meta title" value={form.metaTitle} onChange={(e) => setForm({ ...form, metaTitle: e.target.value })} className="w-full rounded-lg bg-panel2 px-3 py-2 text-sm" /><textarea maxLength={320} rows={2} placeholder="Meta description" value={form.metaDescription} onChange={(e) => setForm({ ...form, metaDescription: e.target.value })} className="w-full rounded-lg bg-panel2 px-3 py-2 text-sm" /></div></details>
      <Toggle checked={form.published} label="Publish page" desc="Only published entries are available to visitors." onChange={(v) => setForm({ ...form, published: v })} />
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Create entry'}</Button>{editingId && <Button onClick={() => { setEditingId(null); setForm(empty); }}>Cancel edit</Button>}</div>
    </form>
  </div>;
}
