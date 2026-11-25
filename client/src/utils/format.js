import { ASSET_URL } from './config';

export const assetUrl = (p) => (!p ? '' : /^https?:/.test(p) ? p : `${ASSET_URL}${p}`);

export const formatTime = (d) =>
  new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function formatDayLabel(d) {
  const date = new Date(d);
  const diff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return date.toLocaleDateString([], { weekday: 'long' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatListTime(d) {
  const date = new Date(d);
  const diff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (diff === 0) return formatTime(date);
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function formatLastSeen(d) {
  if (!d) return 'offline';
  const date = new Date(d);
  const diff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (diff === 0) return `last seen today at ${formatTime(date)}`;
  if (diff === 1) return `last seen yesterday at ${formatTime(date)}`;
  return `last seen ${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${formatTime(date)}`;
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "24 hours" -> "24 hours", 48 -> "2 days", 0.5 -> "30 minutes" */
export function formatTtl(hours) {
  if (!hours) return '';
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24} day${hours / 24 === 1 ? '' : 's'}`;
  if (hours >= 1) { const h = Math.round(hours * 10) / 10; return `${h} hour${h === 1 ? '' : 's'}`; }
  const m = Math.max(1, Math.round(hours * 60));
  return `${m} minute${m === 1 ? '' : 's'}`;
}

export const initials = (name = '?') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

// An "emoji only" message (1–6 emoji, no other text) is rendered large like WhatsApp.
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*|\s)+$/u;
export function isEmojiOnly(text) {
  if (!text || text.length > 40 || !EMOJI_ONLY.test(text)) return false;
  return [...new Intl.Segmenter().segment(text.replace(/\s/g, ''))].length <= 6;
}
