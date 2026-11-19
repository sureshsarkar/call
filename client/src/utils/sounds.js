// Tiny WebAudio synth for ringtones / message pings — no audio asset files required.
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

let ringTimer = null;
export function startRingtone(incoming = true) {
  stopRingtone();
  const ring = () => {
    try {
      if (incoming) { tone(523, 0, 0.35, 0.15); tone(659, 0.4, 0.35, 0.15); tone(523, 1.0, 0.35, 0.15); tone(659, 1.4, 0.35, 0.15); }
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
