// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Trim, drop control characters and cap length. Output escaping is done by React on the client. */
const cleanText = (s, max = 4000) => String(s ?? '').replace(CONTROL, '').trim().slice(0, max);

/** Names / short strings: also strip angle brackets so they can never become markup. */
const cleanLabel = (s, max = 100) => cleanText(s, max).replace(/[<>]/g, '');

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/** Extract up to `limit` unique, valid http(s) URLs from text. */
function extractUrls(text, limit = 3) {
  const out = [];
  for (const raw of String(text).match(URL_RE) || []) {
    const trimmed = raw.replace(/[.,!?;:)\]}]+$/, '');
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const u = new URL(withProto);
      if (!['http:', 'https:'].includes(u.protocol)) continue;
      if (!out.includes(u.href)) out.push(u.href);
    } catch {
      /* ignore invalid */
    }
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { escapeRegex, cleanText, cleanLabel, extractUrls };
