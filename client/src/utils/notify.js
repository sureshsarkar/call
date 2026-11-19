// Browser (system) notifications for events that happen while the tab is in the background.
export async function ensureNotificationPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try { await Notification.requestPermission(); } catch { /* ignore */ }
}

export function systemNotify(title, body, { onClick, tag } = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  const n = new Notification(title, { body, tag, icon: '/favicon.svg', renotify: Boolean(tag) });
  n.onclick = () => { window.focus(); onClick?.(); n.close(); };
}
