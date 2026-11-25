import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Phone, Video, UserPlus, UserCheck, ChevronDown, Copy, Trash2, Eraser, MoreVertical, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import Avatar from './Avatar';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import BottomSheet, { SheetAction } from './BottomSheet';
import { useChatStore } from '../context/chatStore';
import { useAuthStore } from '../context/authStore';
import { useAppConfigStore } from '../context/appConfigStore';
import { callManager } from '../webrtc/CallManager';
import { formatDayLabel, formatLastSeen, formatTtl } from '../utils/format';
import { vibrate } from '../utils/haptics';

const idOf = (v) => String(v?._id ?? v);

export default function ChatWindow() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const appConfig = useAppConfigStore((s) => s.config);
  const user = useChatStore((s) => s.usersById[userId]);
  const thread = useChatStore((s) => s.threads[userId]);
  const online = useChatStore((s) => Boolean(s.onlineIds[userId]));
  const typing = useChatStore((s) => Boolean(s.typing[userId]));
  const isContact = useChatStore((s) => s.contacts.includes(userId));
  const ttlHours = useChatStore((s) => s.ttlHours);
  const { setActive, fetchUser, loadHistory, sendMessage, deleteMessage, retryMessage, addContact, removeContact, markSeen, clearChat } = useChatStore.getState();

  const scroller = useRef(null);
  const stick = useRef(true);
  const prevHeight = useRef(0);
  const [showDown, setShowDown] = useState(false);
  const [sheet, setSheet] = useState(null); // { message, mine }
  const [menu, setMenu] = useState(false); // chat options (clear chat, contact)
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [reply, setReply] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const messages = thread?.messages;

  useEffect(() => {
    setReply(null);
    setActive(userId);
    fetchUser(userId);
    if (!useChatStore.getState().threads[userId]?.loaded) loadHistory(userId);
    stick.current = true;
    const onVisible = () => document.visibilityState === 'visible' && markSeen(userId);
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); setActive(null); };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep pinned to the bottom for new messages; preserve scroll position when older ones load
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current && !stick.current) el.scrollTop = el.scrollHeight - prevHeight.current;
    else if (stick.current) el.scrollTop = el.scrollHeight;
    prevHeight.current = 0;
  }, [messages?.length, typing]);

  // when the on-screen keyboard opens/closes the viewport height changes: stay at the bottom
  useEffect(() => {
    const vv = window.visualViewport;
    const onResize = () => { if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; };
    vv?.addEventListener('resize', onResize);
    return () => vv?.removeEventListener('resize', onResize);
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = fromBottom < 120;
    setShowDown(fromBottom > 400);
    if (el.scrollTop < 60 && thread?.hasMore && !thread.loading) {
      prevHeight.current = el.scrollHeight;
      loadHistory(userId, true);
    }
  };

  const scrollDown = () => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  const onSend = useCallback((text, quoted) => { stick.current = true; sendMessage(userId, text, quoted); setReply(null); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const onLongPress = useCallback((message, mine) => setSheet({ message, mine }), []);
  const onDelete = useCallback((m, scope) => deleteMessage(userId, m, scope), [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const onRetry = useCallback((m) => retryMessage(userId, m._id), [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToMessage = useCallback(async (messageId) => {
    let target = thread?.messages.find((m) => String(m._id) === String(messageId));
    if (!target) {
      try {
        target = await useChatStore.getState().fetchMessage(messageId);
        const partner = idOf(target.sender) === String(me._id) ? idOf(target.receiver) : idOf(target.sender);
        if (partner !== String(userId)) throw new Error('This message is from another conversation');
        useChatStore.getState().insertMessage(userId, target);
      } catch { toast.error('Original message is unavailable'); return; }
    }
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedId(String(messageId));
      setTimeout(() => setHighlightedId((current) => current === String(messageId) ? null : current), 1800);
    });
  }, [thread?.messages, me?._id, userId]);

  const doClear = async () => {
    setClearing(true);
    await clearChat(userId);
    setClearing(false);
    setConfirmClear(false);
  };

  const copyText = async () => {
    try { await navigator.clipboard.writeText(sheet.message.text); toast.success('Copied'); } catch { toast.error('Could not copy'); }
    setSheet(null);
  };

  const items = useMemo(() => {
    const out = [];
    let day = '';
    for (const m of messages || []) {
      const label = formatDayLabel(m.createdAt);
      if (label !== day) { day = label; out.push({ key: `day-${label}-${m._id}`, day: label }); }
      out.push({ key: m._id, message: m });
    }
    return out;
  }, [messages]);

  const status = typing ? <span className="text-brand">typing…</span> : online ? 'online' : user ? formatLastSeen(user.lastSeen) : '';

  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe flex items-center gap-1 bg-panel2 px-1 pb-2 md:gap-3 md:px-4">
        <button className="btn-icon h-11 w-11 shrink-0 text-ink md:hidden" onClick={() => navigate('/')} aria-label="Back"><ArrowLeft size={24} /></button>
        <Avatar user={user} size={42} online={online} />
        <div className="ml-2 min-w-0 flex-1 md:ml-0">
          <p className="truncate text-[16px] font-semibold leading-tight">{user?.name || 'Loading…'}</p>
          <p className="truncate text-xs text-mute">{status}</p>
        </div>
        <button className="btn-icon hidden h-10 w-10 text-mute sm:inline-flex" title={isContact ? 'Remove from contacts' : 'Add to contacts'} onClick={() => (isContact ? removeContact(userId) : addContact(userId))}>
          {isContact ? <UserCheck size={20} className="text-brand" /> : <UserPlus size={20} />}
        </button>
        <button className="btn-icon h-11 w-11 text-ink disabled:opacity-35 md:h-10 md:w-10 md:text-mute" title={appConfig.features.audioCalls === false ? 'Audio calls are disabled' : 'Audio call'} disabled={!user || appConfig.features.audioCalls === false} onClick={() => { vibrate(8); callManager.start(user, 'audio'); }}><Phone size={22} /></button>
        <button className="btn-icon h-11 w-11 text-ink disabled:opacity-35 md:h-10 md:w-10 md:text-mute" title={appConfig.features.videoCalls === false ? 'Video calls are disabled' : 'Video call'} disabled={!user || appConfig.features.videoCalls === false} onClick={() => { vibrate(8); callManager.start(user, 'video'); }}><Video size={23} /></button>
        <button className="btn-icon h-11 w-11 text-ink md:h-10 md:w-10 md:text-mute" title="More options" aria-label="More options" onClick={() => setMenu(true)}><MoreVertical size={22} /></button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="chat-wallpaper h-full overflow-y-auto overscroll-contain py-3">
          {ttlHours > 0 && (
            <p className="mx-auto mb-2 flex w-fit max-w-[90%] items-center gap-1.5 rounded-full bg-panel2/80 px-3 py-1 text-center text-[11px] text-mute">
              <Clock size={12} className="shrink-0" /> Messages are deleted automatically {formatTtl(ttlHours)} after they are sent
            </p>
          )}
          {thread?.loading && <p className="py-2 text-center text-xs text-mute">Loading…</p>}
          {thread?.loaded && !messages.length && (
            <p className="mx-auto mt-8 max-w-xs rounded-2xl bg-panel2/80 px-4 py-2 text-center text-sm text-mute">No messages yet. Say hello 👋</p>
          )}
          <div className="flex flex-col gap-1">
            {items.map((it) =>
              it.day ? (
                <div key={it.key} className="my-2 flex justify-center"><span className="rounded-full bg-panel2 px-3 py-1 text-xs text-mute shadow">{it.day}</span></div>
              ) : (
                <MessageBubble key={it.key} message={it.message} mine={idOf(it.message.sender) === String(me._id)} onDelete={onDelete} onRetry={onRetry} onLongPress={onLongPress} onReply={setReply} onQuoteNavigate={goToMessage} highlighted={highlightedId === String(it.message._id)} />
              )
            )}
            {typing && (
              <div className="px-3 md:px-[8%]"><div className="inline-flex gap-1 rounded-2xl rounded-tl-md bg-bubble-in px-3 py-3"><i className="dot" /><i className="dot" /><i className="dot" /></div></div>
            )}
          </div>
        </div>
        {showDown && (
          <button onClick={scrollDown} aria-label="Scroll to latest" className="fade-in press absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full bg-panel2 text-ink shadow-xl ring-1 ring-white/10">
            <ChevronDown size={24} />
          </button>
        )}
      </div>

      {!appConfig.features.chat && <p className="bg-amber-400/10 px-4 py-2 text-center text-xs text-amber-200">Chat is temporarily disabled by an administrator.</p>}
      <MessageInput userId={userId} onSend={onSend} reply={reply} onCancelReply={() => setReply(null)} disabled={appConfig.features.chat === false} maxMessageLength={appConfig.maxMessageLength} />

      {/* chat options */}
      <BottomSheet open={menu} onClose={() => setMenu(false)} title={user?.name}>
        <SheetAction icon={isContact ? UserCheck : UserPlus} label={isContact ? 'Remove from contacts' : 'Add to contacts'} onClick={() => { setMenu(false); (isContact ? removeContact : addContact)(userId); }} />
        <SheetAction icon={Trash2} danger label="Clear chat" onClick={() => { setMenu(false); setConfirmClear(true); }} />
      </BottomSheet>

      {/* confirm: clear chat */}
      <BottomSheet open={confirmClear} onClose={() => !clearing && setConfirmClear(false)} title="Clear this chat?">
        <p className="px-4 pb-3 text-sm text-mute">All messages with {user?.name || 'this person'} will be removed from <b className="text-ink">your</b> device and account. {user?.name?.split(' ')[0] || 'They'} will still keep their copy. This cannot be undone.</p>
        <div className="flex gap-3 px-3 pb-2">
          <button className="press h-12 flex-1 rounded-xl bg-panel3 text-[15px] font-medium" disabled={clearing} onClick={() => setConfirmClear(false)}>Cancel</button>
          <button className="press h-12 flex-1 rounded-xl bg-danger text-[15px] font-semibold text-white disabled:opacity-60" disabled={clearing} onClick={doClear}>{clearing ? 'Clearing…' : 'Clear chat'}</button>
        </div>
      </BottomSheet>

      {/* long-press action sheet (touch) */}
      <BottomSheet open={Boolean(sheet)} onClose={() => setSheet(null)} title={sheet ? `${sheet.message.text.slice(0, 60)}${sheet.message.text.length > 60 ? '…' : ''}` : ''}>
        {sheet && (
          <>
            <SheetAction icon={Copy} label="Copy text" onClick={copyText} />
            <SheetAction icon={Eraser} label="Delete for me" onClick={() => { onDelete(sheet.message, 'me'); setSheet(null); }} />
            {sheet.mine && <SheetAction icon={Trash2} danger label="Delete for everyone" onClick={() => { onDelete(sheet.message, 'everyone'); setSheet(null); }} />}
          </>
        )}
      </BottomSheet>
    </div>
  );
}
