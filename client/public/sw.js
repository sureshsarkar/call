// Minimal service worker: makes the app installable and the shell load instantly / offline.
// API + Socket.IO traffic (other origins or /api, /socket.io) is never cached.
const CACHE = 'pulse-shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/favicon.svg', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // page navigations: network first, fall back to the cached shell
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('/', copy));
        return res;
      }).catch(() => caches.match('/'))
    );
    return;
  }

  // hashed build assets: cache first
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'Pulse', body: event.data?.text() || 'New activity' }; }
  event.waitUntil((async () => {
    if (data.kind === 'message' && data.messageId && data.ackUrl) {
      try {
        const sub = await self.registration.pushManager.getSubscription();
        if (sub) await fetch(data.ackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint, messageId: data.messageId }) });
      } catch { /* the next foreground socket/history sync can confirm delivery */ }
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.some((c) => c.visibilityState === 'visible')) return;
    const call = data.kind === 'call';
    if (!call && Number(data.unread) > 0) { try { await self.navigator.setAppBadge?.(Number(data.unread)); } catch { /* badge API is optional */ } }
    await self.registration.showNotification(data.title || 'Pulse', {
      body: data.body || '', icon: '/favicon.svg', badge: '/favicon.svg', tag: data.tag || 'pulse', renotify: true,
      vibrate: call ? [500, 250, 500, 250, 700] : [150, 100, 150], requireInteraction: call,
      actions: call ? [{ action: 'accept', title: 'Answer' }, { action: 'reject', title: 'Reject' }] : [{ action: 'open', title: 'Open chat' }],
      data: { url: data.url || '/', kind: data.kind, callId: data.callId, type: data.type, from: data.from },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || '/', self.location.origin);
  if (event.action) target.searchParams.set('pushAction', event.action);
  const url = target.href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows[0];
    if (client) {
      await client.focus();
      client.postMessage({ type: 'PUSH_OPEN', url, callId: data.callId, action: event.action });
    } else {
      await self.clients.openWindow(url);
    }
  })());
});
