import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  MessageSquare, Users, Radio, Phone, Bell, Search, LogOut, Settings, X, Video, PhoneIncoming, PhoneOutgoing,
  PhoneMissed, UserPlus, UserMinus, Check, CheckCheck, User, MessageSquarePlus, Download, Pencil, ChevronRight, Share, KeyRound, Shield,
} from 'lucide-react';
import Avatar from './Avatar';
import BottomSheet from './BottomSheet';
import { useAuthStore } from '../context/authStore';
import { useChatStore } from '../context/chatStore';
import { useUiStore } from '../context/uiStore';
import { callManager } from '../webrtc/CallManager';
import { formatListTime, formatDuration } from '../utils/format';
import { vibrate } from '../utils/haptics';
import { useAppConfigStore } from '../context/appConfigStore';

const idOf = (v) => String(v?._id ?? v);

// desktop top tabs
const DESKTOP_TABS = [
  { id: 'chats', icon: MessageSquare, label: 'Chats' },
  { id: 'contacts', icon: Users, label: 'Contacts' },
  { id: 'online', icon: Radio, label: 'Online' },
  { id: 'calls', icon: Phone, label: 'Calls' },
  { id: 'alerts', icon: Bell, label: 'Alerts' },
];
// mobile bottom navigation
const MOBILE_TABS = [
  { id: 'chats', icon: MessageSquare, label: 'Chats' },
  { id: 'calls', icon: Phone, label: 'Calls' },
  { id: 'contacts', icon: Users, label: 'Contacts' },
  { id: 'alerts', icon: Bell, label: 'Alerts' },
  { id: 'me', icon: User, label: 'Me' },
];
const TITLES = { chats: 'Chats', calls: 'Calls', contacts: 'Contacts', alerts: 'Alerts', online: 'Online now', me: 'Me' };

function Row({ user, online, sub, right, to, onClick, children }) {
  const inner = (
    <>
      <Avatar user={user} size={52} online={online} />
      <div className="min-w-0 flex-1 border-b border-line py-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[16px] font-medium">{user?.name}</p>
          {right}
        </div>
        <div className="flex items-center justify-between gap-2 text-sm text-mute">{sub}{children}</div>
      </div>
    </>
  );
  const cls = 'press flex w-full items-center gap-3 px-4 text-left transition hover:bg-panel2 md:px-3';
  return to ? (
    <NavLink to={to} className={({ isActive }) => `${cls} ${isActive ? 'md:bg-panel3' : ''}`}>{inner}</NavLink>
  ) : (
    <div role="button" tabIndex={0} onClick={onClick} className={`${cls} cursor-pointer`}>{inner}</div>
  );
}

const Empty = ({ icon: Icon, text }) => (
  <div className="flex flex-col items-center gap-3 px-10 py-20 text-center text-sm text-mute">
    <span className="grid h-20 w-20 place-items-center rounded-full bg-panel2"><Icon size={34} className="opacity-60" /></span>
    {text}
  </div>
);

/** Instagram-style row of people who are online right now (phones only). */
function OnlineStrip() {
  const me = useAuthStore((s) => s.user);
  const online = useChatStore((s) => s.onlineIds);
  const users = useChatStore((s) => s.usersById);
  const loadOnline = useChatStore((s) => s.loadOnline);
  const navigate = useNavigate();
  const count = Object.keys(online).length;
  useEffect(() => { loadOnline(); }, [count, loadOnline]);
  const list = Object.keys(online).filter((i) => i !== String(me._id)).map((i) => users[i]).filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="no-scrollbar flex gap-4 overflow-x-auto border-b border-line px-4 py-3 md:hidden">
      {list.map((u) => (
        <button key={u._id} onClick={() => navigate(`/chat/${u._id}`)} className="press flex w-16 shrink-0 flex-col items-center gap-1.5">
          <span className="rounded-full p-0.5 ring-2 ring-brand"><Avatar user={u} size={52} /></span>
          <span className="w-full truncate text-center text-xs text-mute">{u.name.split(' ')[0]}</span>
        </button>
      ))}
    </div>
  );
}

function ChatsTab() {
  const convs = useChatStore((s) => s.conversations);
  const users = useChatStore((s) => s.usersById);
  const online = useChatStore((s) => s.onlineIds);
  const typing = useChatStore((s) => s.typing);
  const me = useAuthStore((s) => s.user);
  const sorted = useMemo(() => [...convs].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)), [convs]);
  return (
    <>
      <OnlineStrip />
      {!sorted.length && <Empty icon={MessageSquare} text="No chats yet. Search for someone to start a conversation." />}
      {sorted.map((c) => {
        const u = users[c.userId];
        const m = c.lastMessage;
        const mine = m && idOf(m.sender) === String(me._id);
        const text = m ? (m.deletedForEveryone ? '🚫 This message was deleted' : m.deletedForMe ? 'Message deleted' : m.text) : '';
        return (
          <Row key={c.userId} user={u} online={Boolean(online[c.userId])} to={`/chat/${c.userId}`}
            right={m && <span className={`shrink-0 text-xs ${c.unreadCount ? 'font-semibold text-brand' : 'text-mute'}`}>{formatListTime(c.updatedAt)}</span>}
            sub={
              <>
                <span className="flex min-w-0 items-center gap-1 truncate">
                  {typing[c.userId] ? <span className="text-brand">typing…</span> : (
                    <>
                      {mine && !m.deletedForEveryone && (m.status === 'seen' ? <CheckCheck size={16} className="shrink-0 text-sky-400" /> : m.status === 'delivered' ? <CheckCheck size={16} className="shrink-0" /> : <Check size={16} className="shrink-0" />)}
                      <span className={`truncate ${c.unreadCount ? 'text-ink' : ''}`}>{text}</span>
                    </>
                  )}
                </span>
                {c.unreadCount > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-xs font-bold text-bg">{c.unreadCount}</span>}
              </>
            }
          />
        );
      })}
    </>
  );
}

function CallBtns({ user }) {
  const features = useAppConfigStore((s) => s.config.features);
  return (
    <span className="flex shrink-0 gap-0.5">
      <button disabled={features.audioCalls === false} className="btn-icon h-10 w-10 text-brand disabled:opacity-35 md:h-8 md:w-8 md:text-mute" title={features.audioCalls === false ? 'Audio calls are disabled' : 'Audio call'} onClick={(e) => { e.preventDefault(); e.stopPropagation(); vibrate(8); callManager.start(user, 'audio'); }}><Phone size={19} /></button>
      <button disabled={features.videoCalls === false} className="btn-icon h-10 w-10 text-brand disabled:opacity-35 md:h-8 md:w-8 md:text-mute" title={features.videoCalls === false ? 'Video calls are disabled' : 'Video call'} onClick={(e) => { e.preventDefault(); e.stopPropagation(); vibrate(8); callManager.start(user, 'video'); }}><Video size={20} /></button>
    </span>
  );
}

function ContactsTab() {
  const ids = useChatStore((s) => s.contacts);
  const users = useChatStore((s) => s.usersById);
  const online = useChatStore((s) => s.onlineIds);
  const remove = useChatStore((s) => s.removeContact);
  const list = ids.map((i) => users[i]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return <Empty icon={Users} text="No contacts yet. Search for people and tap + to add them." />;
  return list.map((u) => (
    <Row key={u._id} user={u} online={Boolean(online[u._id])} to={`/chat/${u._id}`}
      sub={<span className="truncate">{online[u._id] ? 'online' : u.about}</span>}
      right={<span className="flex"><CallBtns user={u} /><button className="btn-icon hidden h-8 w-8 text-mute md:inline-flex" title="Remove contact" onClick={(e) => { e.preventDefault(); remove(u._id); }}><UserMinus size={16} /></button></span>}
    />
  ));
}

function OnlineTab() {
  const me = useAuthStore((s) => s.user);
  const online = useChatStore((s) => s.onlineIds);
  const users = useChatStore((s) => s.usersById);
  const loadOnline = useChatStore((s) => s.loadOnline);
  const count = Object.keys(online).length;
  useEffect(() => { loadOnline(); }, [count, loadOnline]);
  const list = Object.keys(online).filter((i) => i !== String(me._id)).map((i) => users[i]).filter(Boolean);
  if (!list.length) return <Empty icon={Radio} text="Nobody else is online right now." />;
  return list.map((u) => (
    <Row key={u._id} user={u} online to={`/chat/${u._id}`} sub={<span className="truncate">{u.about}</span>} right={<CallBtns user={u} />} />
  ));
}

function CallsTab() {
  const calls = useChatStore((s) => s.calls);
  const loadCalls = useChatStore((s) => s.loadCalls);
  const clearCallHistory = useChatStore((s) => s.clearCallHistory);
  const cache = useChatStore((s) => s.cacheUsers);
  useEffect(() => {
    loadCalls();
    window.addEventListener('pulse:call-ended', loadCalls);
    return () => window.removeEventListener('pulse:call-ended', loadCalls);
  }, [loadCalls]);
  useEffect(() => { cache(calls.map((c) => c.peer)); }, [calls, cache]);
  if (!calls.length) return <Empty icon={Phone} text="Your call history will appear here." />;
  return <>
    <button onClick={clearCallHistory} className="w-full px-4 py-3 text-right text-sm text-brand hover:underline">Clear call history</button>
    {calls.map((c) => {
    const missed = ['missed', 'busy'].includes(c.status) && c.direction === 'incoming';
    const Icon = missed ? PhoneMissed : c.direction === 'incoming' ? PhoneIncoming : PhoneOutgoing;
    const label = { completed: c.duration ? formatDuration(c.duration) : 'Completed', missed: c.direction === 'incoming' ? 'Missed' : 'No answer', rejected: 'Declined', cancelled: c.direction === 'incoming' ? 'Missed' : 'Cancelled', busy: 'Busy', failed: 'Failed', answered: 'Ended' }[c.status] || c.status;
    return (
      <Row key={c._id} user={c.peer} to={`/chat/${c.peer._id}`}
        right={<span className="shrink-0 text-xs text-mute">{formatListTime(c.startedAt)}</span>}
        sub={<span className={`flex items-center gap-1 ${missed ? 'text-danger' : ''}`}><Icon size={15} />{c.type === 'video' ? 'Video' : 'Audio'} · {label}</span>}>
        <CallBtns user={c.peer} />
      </Row>
    );
    })}
  </>;
}

function AlertsTab() {
  const list = useChatStore((s) => s.notifications);
  const markAll = useChatStore((s) => s.markAllNotificationsRead);
  const clearAll = useChatStore((s) => s.clearNotifications);
  const navigate = useNavigate();
  if (!list.length) return <Empty icon={Bell} text="No notifications." />;
  return (
    <>
      <div className="flex items-center justify-between px-4 py-2.5 text-sm">
        <button onClick={markAll} className="text-brand hover:underline">Mark all as read</button>
        <button onClick={clearAll} className="text-danger hover:underline">Clear all</button>
      </div>
      {list.map((n) => (
        <Row key={n._id} user={n.from} onClick={() => navigate(`/chat/${idOf(n.from)}`)}
          right={<span className="shrink-0 text-xs text-mute">{formatListTime(n.updatedAt)}</span>}
          sub={<span className={`truncate ${n.type === 'missed_call' ? 'text-danger' : ''}`}>{n.type === 'message' ? `${n.count > 1 ? `${n.count} new messages · ` : ''}${n.body}` : n.body}</span>}>
          {!n.read && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />}
        </Row>
      ))}
    </>
  );
}

/** "Me" screen (phones): profile card, shortcuts, install-as-app, log out. */
function MeTab() {
  const me = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const { installEvent, setInstallEvent, installed } = useUiStore();
  const features = useAppConfigStore((s) => s.config.features);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const [iosHelp, setIosHelp] = useState(false);

  const install = async () => {
    if (installEvent) { installEvent.prompt(); await installEvent.userChoice.catch(() => {}); setInstallEvent(null); }
    else if (ios) setIosHelp(true);
  };

  const Item = ({ icon: Icon, label, onClick, danger }) => (
    <button onClick={onClick} className={`press flex w-full items-center gap-4 border-b border-line px-5 py-4 text-left text-[16px] ${danger ? 'text-red-400' : ''}`}>
      <Icon size={22} className={danger ? '' : 'text-mute'} /><span className="flex-1">{label}</span>{!danger && <ChevronRight size={18} className="text-mute" />}
    </button>
  );

  return (
    <div>
      <button onClick={() => navigate('/profile')} className="press flex w-full items-center gap-4 px-5 py-5 text-left">
        <Avatar user={me} size={72} />
        <div className="min-w-0 flex-1"><p className="truncate text-xl font-semibold">{me.name}</p><p className="truncate text-sm text-mute">{me.about}</p><p className="truncate text-xs text-mute">{me.email}</p></div>
        <Pencil size={18} className="text-mute" />
      </button>
      <div className="mt-2 border-t border-line">
        <Item icon={Pencil} label="Edit profile" onClick={() => navigate('/profile')} />
        <Item icon={KeyRound} label="Change password" onClick={() => navigate('/profile#change-password')} />
        <Item icon={Settings} label="Calls, audio & notifications" onClick={() => navigate('/settings')} />
        {['super_admin', 'admin', 'moderator', 'support', 'custom'].includes(me?.role) && <Item icon={Shield} label="Admin panel" onClick={() => navigate('/admin')} />}
        {features.pwaInstall !== false && !standalone && !installed && (installEvent || ios) && <Item icon={Download} label="Install Pulse as an app" onClick={install} />}
        <Item icon={LogOut} label="Log out" danger onClick={logout} />
      </div>
      <p className="px-5 py-6 text-center text-xs text-mute">Pulse · private 1:1 chat, audio &amp; video calls</p>
      <BottomSheet open={iosHelp} onClose={() => setIosHelp(false)} title="Install on iPhone / iPad">
        <p className="flex items-start gap-3 px-4 py-3 text-[15px]"><Share size={20} className="mt-0.5 shrink-0 text-sky-400" />Tap the <b>Share</b> button in Safari, then choose <b>Add to Home Screen</b>.</p>
      </BottomSheet>
    </div>
  );
}

function SearchResults({ query }) {
  const { search, searchResults, usersById, contacts, addContact } = useChatStore();
  const online = useChatStore((s) => s.onlineIds);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(true);
    const t = setTimeout(() => search(query).finally(() => setBusy(false)), 300);
    return () => clearTimeout(t);
  }, [query, search]);
  const users = searchResults.users.map((i) => usersById[i]).filter(Boolean);
  return (
    <div>
      <p className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-brand">People</p>
      {users.map((u) => (
        <Row key={u._id} user={u} online={Boolean(online[u._id])} to={`/chat/${u._id}`} sub={<span className="truncate">{u.about}</span>}
          right={!contacts.includes(u._id) && <button className="btn-icon h-10 w-10 text-mute" title="Add to contacts" onClick={(e) => { e.preventDefault(); addContact(u._id); }}><UserPlus size={18} /></button>} />
      ))}
      {!users.length && !busy && <p className="px-4 py-3 text-sm text-mute">No users found. Search by name, or type someone's exact email.</p>}
      {searchResults.messages.length > 0 && <p className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-brand">Messages</p>}
      {searchResults.messages.map((m) => (
        <Row key={m._id} user={usersById[m.withUser._id] || m.withUser} to={`/chat/${m.withUser._id}`}
          right={<span className="shrink-0 text-xs text-mute">{formatListTime(m.createdAt)}</span>}
          sub={<span className="truncate">{m.text}</span>} />
      ))}
    </div>
  );
}

function NewChatSheet({ open, onClose, onSearch }) {
  const ids = useChatStore((s) => s.contacts);
  const users = useChatStore((s) => s.usersById);
  const online = useChatStore((s) => s.onlineIds);
  const navigate = useNavigate();
  const list = ids.map((i) => users[i]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <BottomSheet open={open} onClose={onClose} title="New chat">
      <button onClick={() => { onClose(); onSearch(); }} className="press flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-brand text-bg"><Search size={20} /></span>
        <span className="font-medium">Search people</span>
      </button>
      <div className="max-h-[45dvh] overflow-y-auto">
        {list.map((u) => (
          <button key={u._id} onClick={() => { onClose(); navigate(`/chat/${u._id}`); }} className="press flex w-full items-center gap-4 rounded-xl px-4 py-2.5 text-left">
            <Avatar user={u} size={44} online={Boolean(online[u._id])} /><span className="font-medium">{u.name}</span>
          </button>
        ))}
        {!list.length && <p className="px-4 py-4 text-sm text-mute">Your contacts will show up here.</p>}
      </div>
    </BottomSheet>
  );
}

export default function Sidebar() {
  const me = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const { tab, setTab, searchOpen, setSearchOpen } = useUiStore();
  const [q, setQ] = useState('');
  const [newChat, setNewChat] = useState(false);
  const searchRef = useRef(null);
  const unreadChats = useChatStore((s) => s.conversations.reduce((a, c) => a + (c.unreadCount ? 1 : 0), 0));
  const alerts = useChatStore((s) => s.unreadNotifications);
  const badge = { chats: unreadChats, alerts };

  const Body = { chats: ChatsTab, contacts: ContactsTab, online: OnlineTab, calls: CallsTab, alerts: AlertsTab, me: MeTab }[tab] || ChatsTab;
  const showSearch = searchOpen || Boolean(q);

  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  const closeSearch = () => { setQ(''); setSearchOpen(false); };

  return (
    <aside className="relative flex h-full w-full flex-col bg-panel">
      {/* desktop header */}
      <div className="hidden items-center gap-3 bg-panel2 px-3 py-2.5 md:flex">
        <button onClick={() => navigate('/profile')} className="rounded-full" aria-label="Profile"><Avatar user={me} size={40} /></button>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{me.name}</p><p className="truncate text-xs text-mute">{me.about}</p></div>
        <button className="btn-icon h-9 w-9 text-mute" title="Settings" onClick={() => navigate('/settings')}><Settings size={20} /></button>
        {['super_admin', 'admin', 'moderator', 'support', 'custom'].includes(me?.role) && <button className="btn-icon h-9 w-9 text-mute" title="Admin panel" onClick={() => navigate('/admin')}><Shield size={20} /></button>}
        <button className="btn-icon h-9 w-9 text-mute" title="Log out" onClick={logout}><LogOut size={20} /></button>
      </div>

      {/* mobile app bar */}
      <header className="flex items-center justify-between px-4 pb-2 pt-safe md:hidden">
        <h1 className="text-[28px] font-bold tracking-tight">{TITLES[tab]}</h1>
        <button onClick={() => (showSearch ? closeSearch() : setSearchOpen(true))} className="btn-icon h-11 w-11 bg-panel2 text-ink" aria-label="Search">
          {showSearch ? <X size={21} /> : <Search size={21} />}
        </button>
      </header>

      <div className={`${showSearch ? 'block' : 'hidden'} px-3 pb-2 md:block md:pt-2`}>
        <div className="flex items-center gap-2 rounded-xl bg-panel2 px-3 py-2.5">
          <Search size={18} className="shrink-0 text-mute" />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users or messages" className="w-full bg-transparent text-sm outline-none placeholder:text-mute" />
          {q && <button onClick={() => setQ('')} aria-label="Clear search"><X size={17} className="text-mute" /></button>}
        </div>
      </div>

      {/* desktop tabs */}
      {!q && (
        <nav className="hidden border-b border-line md:flex">
          {DESKTOP_TABS.map(({ id, icon: Icon, label }) => (
            <button key={id} onClick={() => setTab(id)} title={label}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition ${tab === id ? 'text-brand' : 'text-mute hover:text-ink'}`}>
              <Icon size={19} />{label}
              {badge[id] > 0 && <span className="absolute right-[22%] top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-bg">{badge[id]}</span>}
              {tab === id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded bg-brand" />}
            </button>
          ))}
        </nav>
      )}

      <div className="relative flex-1 overflow-y-auto overscroll-contain">
        {q ? <SearchResults query={q} /> : <div key={tab} className="fade-in"><Body /></div>}
      </div>

      {/* mobile: new-chat FAB */}
      {tab === 'chats' && !q && (
        <button onClick={() => { vibrate(8); setNewChat(true); }} aria-label="New chat"
          className="press absolute bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] right-4 z-20 grid h-14 w-14 place-items-center rounded-2xl bg-brand text-bg shadow-xl shadow-black/40 md:hidden">
          <MessageSquarePlus size={26} />
        </button>
      )}

      {/* mobile bottom navigation */}
      <nav className="flex border-t border-line bg-panel/95 pb-safe-0 backdrop-blur md:hidden">
        {MOBILE_TABS.map(({ id, icon: Icon, label }) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => { vibrate(6); setTab(id); closeSearch(); }} aria-label={label}
              className={`press relative flex min-h-[3.75rem] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? 'text-brand' : 'text-mute'}`}>
              <span className={`relative grid h-8 w-14 place-items-center rounded-full transition-colors ${active ? 'bg-brand/15' : ''}`}>
                <Icon size={22} strokeWidth={active ? 2.4 : 2} />
                {badge[id] > 0 && <span className="absolute right-1.5 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{badge[id]}</span>}
              </span>
              {label}
            </button>
          );
        })}
      </nav>

      <NewChatSheet open={newChat} onClose={() => setNewChat(false)} onSearch={() => setSearchOpen(true)} />
    </aside>
  );
}
