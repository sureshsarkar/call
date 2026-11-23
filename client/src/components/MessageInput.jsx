import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Send, Smile, Keyboard, X } from 'lucide-react';
import { getSocket } from '../socket/socket';
import { vibrate } from '../utils/haptics';

const EmojiPicker = lazy(() => import('emoji-picker-react'));
const isPhone = () => window.matchMedia('(max-width: 767px)').matches;

export default function MessageInput({ userId, onSend, reply, onCancelReply }) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const ref = useRef(null);
  const lastTyping = useRef(0);
  const stopTimer = useRef(null);

  const stopTyping = useCallback(() => {
    clearTimeout(stopTimer.current);
    if (lastTyping.current) getSocket()?.emit('stop_typing', { to: userId });
    lastTyping.current = 0;
  }, [userId]);

  useEffect(() => { setText(''); setShowEmoji(false); return stopTyping; }, [userId, stopTyping]);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };
  useEffect(resize, [text]);

  const onChange = (e) => {
    setText(e.target.value);
    const now = Date.now();
    if (now - lastTyping.current > 2000) { getSocket()?.emit('typing', { to: userId }); lastTyping.current = now; }
    clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(stopTyping, 1500);
  };

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    vibrate(8);
    onSend(v, reply);
    setText('');
    stopTyping();
    // phones: keep the keyboard open for rapid-fire chatting; desktop: close the emoji panel
    if (!isPhone()) setShowEmoji(false);
    ref.current?.focus();
  };

  const addEmoji = ({ emoji }) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => { el?.setSelectionRange(start + emoji.length, start + emoji.length); if (!isPhone()) el?.focus(); });
  };

  // phones: toggle between keyboard and emoji panel like WhatsApp / Telegram
  const toggleEmoji = () => {
    if (showEmoji) { setShowEmoji(false); ref.current?.focus(); }
    else { ref.current?.blur(); setShowEmoji(true); }
  };

  return (
    <div className="relative bg-panel2">
      {reply && <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border-l-[3px] border-brand bg-panel3 px-3 py-2 md:mx-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-brand">Replying to {reply.sender?.name || 'message'}</p>
          <p className="truncate text-sm text-mute">{reply.deletedForEveryone ? 'This message was deleted' : reply.text || (reply.type ? reply.type[0].toUpperCase() + reply.type.slice(1) : reply.fileName || (reply.image ? 'Image' : reply.video ? 'Video' : reply.attachment ? 'Attachment' : 'Message'))}</p>
        </div>
        <button onClick={onCancelReply} aria-label="Cancel reply" className="btn-icon h-8 w-8 shrink-0 text-mute"><X size={18} /></button>
      </div>}
      {/* desktop: floating popover */}
      {showEmoji && (
        <div className="pop-in absolute bottom-full left-4 z-30 mb-1 hidden md:block">
          <Suspense fallback={<div className="grid h-[380px] w-[320px] place-items-center rounded-xl bg-panel3 text-mute">Loading emojis…</div>}>
            <EmojiPicker theme="dark" onEmojiClick={addEmoji} width={340} height={380} lazyLoadEmojis searchPlaceHolder="Search emoji" previewConfig={{ showPreview: false }} />
          </Suspense>
        </div>
      )}

      <div className="flex items-end gap-1.5 px-2 py-2 md:gap-2 md:px-4" style={{ paddingBottom: showEmoji ? '0.5rem' : 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        <button className="btn-icon h-11 w-11 shrink-0 text-mute" onClick={toggleEmoji} aria-label={showEmoji ? 'Show keyboard' : 'Emoji picker'}>
          {showEmoji ? <Keyboard size={24} className="md:hidden" /> : null}
          {showEmoji ? <Smile size={24} className="hidden text-brand md:block" /> : <Smile size={25} />}
        </button>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={onChange}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); submit(); } }}
          onFocus={() => setShowEmoji(false)}
          placeholder="Message"
          maxLength={4000}
          enterKeyHint="send"
          autoComplete="off"
          className="max-h-36 min-h-[44px] flex-1 resize-none rounded-3xl bg-panel3 px-4 py-2.5 text-[16px] text-ink outline-none placeholder:text-mute md:rounded-lg md:text-[15px]"
        />
        <button onClick={submit} disabled={!text.trim()} aria-label="Send message"
          className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand text-bg transition disabled:opacity-40">
          <Send size={20} />
        </button>
      </div>

      {/* phones: docked emoji panel under the input (replaces the keyboard) */}
      {showEmoji && (
        <div className="sheet-up pb-safe-0 md:hidden">
          <Suspense fallback={<div className="grid h-[300px] place-items-center text-mute">Loading emojis…</div>}>
            <EmojiPicker theme="dark" onEmojiClick={addEmoji} width="100%" height={300} lazyLoadEmojis searchDisabled skinTonesDisabled previewConfig={{ showPreview: false }} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
