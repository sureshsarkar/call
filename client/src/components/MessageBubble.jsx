import { memo, useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, ChevronDown, Clock, AlertCircle, Ban, ExternalLink, Reply } from 'lucide-react';
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
function MessageBubble({ message, mine, onDelete, onRetry, onLongPress, onReply, onQuoteNavigate, highlighted }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);
  const press = useRef({ timer: null, x: 0, y: 0 });
  const swipe = useRef({ x: 0, y: 0, dx: 0, active: false, tracking: false });
  const [swipeX, setSwipeX] = useState(0);

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
    if (!actionable) return;
    swipe.current = { x: e.clientX, y: e.clientY, dx: 0, active: false, tracking: true };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (e.pointerType !== 'mouse') {
      press.current.x = e.clientX; press.current.y = e.clientY;
      press.current.timer = setTimeout(() => { press.current.timer = null; vibrate(15); onLongPress?.(message, mine); }, 420);
    }
  };
  const onPointerMove = (e) => {
    if (!swipe.current.tracking) return;
    const dx = e.clientX - swipe.current.x;
    const dy = e.clientY - swipe.current.y;
    if (!swipe.current.active && dx > 8 && dx > Math.abs(dy) * 1.2) swipe.current.active = true;
    if (swipe.current.active) {
      cancelPress();
      swipe.current.dx = dx;
      setSwipeX(Math.max(0, Math.min(92, dx)));
      if (e.cancelable) e.preventDefault();
    } else if (press.current.timer && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) cancelPress();
  };
  const onPointerFinish = () => {
    cancelPress();
    if (swipe.current.tracking && swipe.current.active && swipe.current.dx >= 58) { vibrate(10); onReply?.(message); }
    swipe.current.tracking = false;
    swipe.current.active = false;
    setSwipeX(0);
  };
  const quoted = message.replyTo;
  const quoteLabel = (item) => {
    if (!item || item.unavailable) return 'Original message unavailable';
    if (item.deletedForEveryone) return 'This message was deleted';
    if (item.text) return item.text;
    const type = String(item.type || '').toLowerCase();
    if (type.includes('image') || item.image) return '📷 Image';
    if (type.includes('video') || item.video) return '🎥 Video';
    if (type.includes('document') || item.fileName) return `📄 ${item.fileName || 'Document'}`;
    if (item.attachment) return '📎 Attachment';
    if (item.links?.length) return item.links[0].title || item.links[0].url;
    return 'Message';
  };

  return (
    <div className={`group relative flex ${mine ? 'justify-end' : 'justify-start'} overflow-hidden px-3 md:px-[8%]`} data-message-id={message._id}>
      <div className={`absolute inset-y-0 flex items-center text-brand ${mine ? 'left-5' : 'right-5'}`} style={{ opacity: Math.min(1, Math.abs(swipeX) / 54) }}><Reply size={20} /></div>
      <div ref={ref}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerFinish} onPointerCancel={onPointerFinish}
        onContextMenu={(e) => { if (actionable && window.matchMedia('(pointer: coarse)').matches) e.preventDefault(); }}
        style={{ transform: `translateX(${swipeX}px)`, transition: swipe.current.active ? 'none' : 'transform 180ms ease-out', touchAction: 'pan-y' }}
        className={`relative max-w-[85%] select-none rounded-2xl px-3 py-1.5 shadow-sm [-webkit-touch-callout:none] md:max-w-[65%] md:select-text md:rounded-lg md:px-2.5 ${mine ? 'rounded-tr-md bg-bubble-out md:rounded-tr-none' : 'rounded-tl-md bg-bubble-in md:rounded-tl-none'} ${emojiOnly ? '!bg-transparent !shadow-none' : ''} ${highlighted ? 'ring-2 ring-brand/80' : ''}`}>
        {deleted ? (
          <p className="flex items-center gap-1.5 pr-14 text-sm italic text-mute"><Ban size={14} />This message was deleted</p>
        ) : (
          <>
            {quoted && <button onClick={() => !quoted.unavailable && onQuoteNavigate?.(quoted._id)} className="mb-1 block w-full border-l-[3px] border-brand/80 rounded-sm bg-black/10 px-2 py-1 text-left" aria-label="Go to replied message">
              <span className="block truncate text-xs font-semibold text-brand">{quoted.unavailable ? 'Unavailable' : quoted.sender?.name || 'Message'}</span>
              <span className="block truncate text-xs text-mute">{quoteLabel(quoted)}</span>
            </button>}
            {message.links?.map((l) => <LinkCard key={l.url} link={l} />)}
            <p className={`whitespace-pre-wrap break-words text-[15px] leading-snug ${emojiOnly ? 'emoji-only' : 'pr-20'}`}>
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
