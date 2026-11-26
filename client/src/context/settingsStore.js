import { create } from 'zustand';

const KEY = 'pulse_settings';
const RINGTONE_SETTINGS_VERSION = 1;
const defaults = { advancedNoise: false, micId: '', speakerId: '', camId: '', sounds: true, ringtone: 'digital', desktopNotifications: true };

const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const ringtone = saved.ringtoneSettingsVersion === RINGTONE_SETTINGS_VERSION ? saved.ringtone : defaults.ringtone;
    return { ...defaults, ...saved, ringtone, ringtoneSettingsVersion: RINGTONE_SETTINGS_VERSION };
  } catch { return { ...defaults, ringtoneSettingsVersion: RINGTONE_SETTINGS_VERSION }; }
};

export const useSettingsStore = create((set, get) => ({
  ...load(),
  update: (patch) => {
    set(patch);
    const { advancedNoise, micId, speakerId, camId, sounds, ringtone, desktopNotifications } = { ...get(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify({ advancedNoise, micId, speakerId, camId, sounds, ringtone, desktopNotifications, ringtoneSettingsVersion: RINGTONE_SETTINGS_VERSION })); } catch { /* ignore */ }
  },
}));
