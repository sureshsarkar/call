import { pushApi } from '../services/api';

const toBytes = (value) => {
  const pad = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Push notifications are not supported by this browser');
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Allow notifications in your browser settings');
  const registration = await navigator.serviceWorker.ready;
  const key = await pushApi.publicKey();
  if (!key) throw new Error('Push notifications are not configured on the server yet');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
  await pushApi.subscribe(subscription.toJSON());
  return subscription;
}

export async function disablePush() {
  const registration = await navigator.serviceWorker?.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;
  try { await pushApi.unsubscribe(subscription.endpoint); } finally { await subscription.unsubscribe(); }
}
