// Tiny WebAudio synth for ringtones / message pings — no audio asset files required.
export const RINGTONES = [
  { id: 'pulse', label: 'Pulse' },
  { id: 'classic', label: 'Classic' },
  { id: 'soft', label: 'Soft' },
  { id: 'chime', label: 'Chime' },
  { id: 'marimba', label: 'Marimba' },
  { id: 'digital', label: 'Digital' },
];

let ctx;
const getCtx = () => {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
};

function tone(freq, start, dur, vol = 0.12, type = 'sine') {
  const c = getCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

export function playMessage() {
  try { tone(880, 0, 0.12); tone(1175, 0.1, 0.16); } catch { /* audio blocked */ }
}

export function playNotification() {
  try { tone(740, 0, 0.16); tone(988, 0.18, 0.22); } catch { /* audio blocked */ }
}

function playIncomingPattern(ringtone) {
  if (ringtone === 'classic') {
    tone(784, 0, 0.24, 0.11, 'triangle');
    tone(988, 0.28, 0.24, 0.1, 'triangle');
    tone(1175, 0.56, 0.4, 0.1, 'triangle');
    tone(988, 1.02, 0.24, 0.09, 'triangle');
    tone(784, 1.3, 0.46, 0.09, 'triangle');
  } else if (ringtone === 'soft') {
    tone(659, 0, 0.28, 0.11); tone(784, 0.34, 0.28, 0.11); tone(988, 0.68, 0.45, 0.1);
  } else if (ringtone === 'chime') {
    tone(880, 0, 0.42, 0.09); tone(1109, 0.36, 0.42, 0.085);
    tone(1318, 0.72, 0.65, 0.08); tone(1109, 1.38, 0.5, 0.075);
  } else if (ringtone === 'marimba') {
    tone(523, 0, 0.18, 0.13, 'triangle'); tone(659, 0.24, 0.18, 0.12, 'triangle');
    tone(784, 0.48, 0.22, 0.12, 'triangle'); tone(1047, 0.78, 0.44, 0.11, 'triangle');
  } else if (ringtone === 'digital') {
    tone(880, 0, 0.16, 0.12); tone(1175, 0.18, 0.18, 0.1);
    tone(880, 0.56, 0.16, 0.12); tone(1397, 0.74, 0.34, 0.1);
  } else {
    tone(523, 0, 0.3, 0.14); tone(659, 0.34, 0.3, 0.14); tone(784, 0.68, 0.42, 0.13);
  }
}

export function previewRingtone(ringtone = 'pulse') {
  try { playIncomingPattern(ringtone); } catch { /* audio blocked */ }
}

let ringTimer = null;
export function startRingtone(incoming = true, ringtone = 'pulse') {
  stopRingtone();
  const ring = () => {
    try {
      if (incoming) playIncomingPattern(ringtone);
      else { tone(440, 0, 0.9, 0.08); tone(480, 0, 0.9, 0.08); } // ringback
    } catch { /* audio blocked */ }
  };
  ring();
  ringTimer = setInterval(ring, incoming ? 3000 : 3500);
}
export function stopRingtone() {
  clearInterval(ringTimer);
  ringTimer = null;
}
export function playEnd() {
  try { tone(480, 0, 0.15, 0.1); tone(380, 0.18, 0.25, 0.1); } catch { /* audio blocked */ }
}
