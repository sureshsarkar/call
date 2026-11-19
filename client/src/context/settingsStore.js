import { create } from 'zustand';

const KEY = 'pulse_settings';
const defaults = { advancedNoise: false, micId: '', speakerId: '', camId: '', sounds: true, desktopNotifications: true };

const load = () => {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return defaults; }
};

export const useSettingsStore = create((set, get) => ({
  ...load(),
  update: (patch) => {
    set(patch);
    const { advancedNoise, micId, speakerId, camId, sounds, desktopNotifications } = { ...get(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify({ advancedNoise, micId, speakerId, camId, sounds, desktopNotifications })); } catch { /* ignore */ }
  },
}));
