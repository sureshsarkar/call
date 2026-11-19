// Tiny haptic feedback helper (Android/Chrome; silently ignored where unsupported, e.g. iOS Safari).
export const vibrate = (pattern = 10) => { try { navigator.vibrate?.(pattern); } catch { /* unsupported */ } };
export const isTouchDevice = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;
