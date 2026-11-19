// Splits text into plain and link tokens. Only http(s) URLs become links (blocks javascript:, data: ...).
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

export function tokenize(text) {
  const tokens = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const trimmed = raw.replace(/[.,!?;:)\]}]+$/, '');
    const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let safe = false;
    try { safe = ['http:', 'https:'].includes(new URL(href).protocol); } catch { /* ignore */ }
    if (!safe) continue;
    if (m.index > last) tokens.push({ type: 'text', value: text.slice(last, m.index) });
    tokens.push({ type: 'link', value: trimmed, href });
    last = m.index + trimmed.length;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  return tokens;
}
