import { memo, useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, ChevronDown, Clock, AlertCircle, Ban, ExternalLink } from 'lucide-react';
import { formatTime, isEmojiOnly } from '../utils/format';
import { tokenize } from '../utils/linkify';
import { vibrate } from '../utils/haptics';

function LinkCard({ link }) {
  const [imgOk, setImgOk] = useState(true);
  if (!link.title && !link.description && !link.image) return null;
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" className="mb-1 block overflow-hidden rounded-lg bg-black/20 transition hover:bg-black/30">
      {link.image && imgOk && (
        <img src={link.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImgOk(false)} className="max-h-44 w-full object-cover" />
      )}
      <div className="px-3 py-2">
        {link.title && <p className="line-clamp-2 text-sm font-semibold text-ink">{link.title}</p>}
        {link.description && <p className="line-clamp-2 text-xs text-mute">{link.description}</p>}
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-mute"><ExternalLink size={10} />{link.siteName || new URL(link.url).hostname}</p>
      </div>
    </a>
  );
}

function Ticks({ status }) {
  if (status === 'sending') return <Clock size={13} className="text-mute" />;
  if (status === 'failed') return <AlertCircle size={14} className="text-danger" />;
  if (status === 'sent') return <Check size={15} className="text-mute" />;
  if (status === 'delivered') return <CheckCheck size={15} className="text-mute" />;
  return <CheckCheck size={15} className="text-sky-400" />;
}

/**
 * Chat bubble. On touch screens, long-press opens the action sheet (copy / delete) via `onLongPress`;
 * on desktop a hover chevron opens a small dropdown.
 */
function MessageBubble({ message, mine, onDelete, onRetry, onLongPress }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);
  const press = useRef({ timer: null, x: 0, y: 0 });

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const deleted = message.deletedForEveryone;
  const emojiOnly = !deleted && isEmojiOnly(message.text);
  const actionable = !deleted && message.status !== 'sending' && message.status !== 'failed';

  const cancelPress = () => { clearTimeout(press.current.timer); press.current.timer = null; };
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' || !actionable) return;
    press.current.x = e.clientX; press.current.y = e.clientY;
    press.current.timer = setTimeout(() => { press.current.timer = null; vibrate(15); onLongPress?.(message, mine); }, 420);
  };
  const onPointerMove = (e) => {
    if (press.current.timer && (Math.abs(e.clientX - press.current.x) > 10 || Math.abs(e.clientY - press.current.y) > 10)) cancelPress();
  };

  return (
    <div className={`group flex ${mine ? 'justify-end' : 'justify-start'} px-3 md:px-[8%]`}>
      <div ref={ref}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
        onContextMenu={(e) => { if (actionable && window.matchMedia('(pointer: coarse)').matches) e.preventDefault(); }}
        className={`relative max-w-[85%] select-none rounded-2xl px-3 py-1.5 shadow-sm [-webkit-touch-callout:none] md:max-w-[65%] md:select-text md:rounded-lg md:px-2.5 ${mine ? 'rounded-tr-md bg-bubble-out md:rounded-tr-none' : 'rounded-tl-md bg-bubble-in md:rounded-tl-none'} ${emojiOnly ? '!bg-transparent !shadow-none' : ''}`}>
        {deleted ? (
          <p className="flex items-center gap-1.5 pr-14 text-sm italic text-mute"><Ban size={14} />This message was deleted</p>
        ) : (
          <>
            {message.links?.map((l) => <LinkCard key={l.url} link={l} />)}
            <p className={`whitespace-pre-wrap break-words text-[15px] leading-snug ${emojiOnly ? 'emoji-only' : 'pr-14'}`}>
              {tokenize(message.text).map((t, i) =>
                t.type === 'link' ? (
                  <a key={i} href={t.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-sky-400 underline-offset-2 hover:underline">{t.value}</a>
                ) : (
                  <span key={i}>{t.value}</span>
                )
              )}
            </p>
          </>
        )}
        <span className={`${emojiOnly ? 'relative mt-0.5 flex justify-end' : 'absolute bottom-1 right-2'} flex items-center gap-1 text-[11px] text-mute`}>
          {formatTime(message.createdAt)}
          {mine && !deleted && <Ticks status={message.status} />}
        </span>

        {actionable && (
          <button onClick={() => setMenu((v) => !v)} aria-label="Message options" className={`absolute right-1 top-0.5 hidden rounded-full bg-black/30 p-0.5 text-mute md:group-hover:block ${menu ? 'md:!block' : ''}`}>
            <ChevronDown size={16} />
          </button>
        )}
        {menu && (
          <div className="pop-in absolute right-1 top-6 z-20 hidden w-48 overflow-hidden rounded-lg bg-panel3 py-1 text-sm shadow-xl md:block">
            <button className="block w-full px-4 py-2 text-left hover:bg-white/10" onClick={() => { setMenu(false); onDelete(message, 'me'); }}>Delete for me</button>
            {mine && <button className="block w-full px-4 py-2 text-left text-red-400 hover:bg-white/10" onClick={() => { setMenu(false); onDelete(message, 'everyone'); }}>Delete for everyone</button>}
          </div>
        )}
        {message.status === 'failed' && (
          <button onClick={() => onRetry(message)} className="mt-1 text-xs text-danger underline">Failed to send · Tap to retry</button>
        )}
      </div>
    </div>
  );
}

export default memo(MessageBubble);
