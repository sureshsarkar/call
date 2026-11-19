import { useEffect } from 'react';

/** Keeps the screen on while `active` (e.g. during a call). Re-acquires after the tab becomes visible again. */
export default function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return undefined;
    let lock = null;
    let cancelled = false;
    const acquire = async () => {
      try { lock = await navigator.wakeLock.request('screen'); if (cancelled) lock.release().catch(() => {}); } catch { /* denied / unsupported */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); lock?.release().catch(() => {}); };
  }, [active]);
}
