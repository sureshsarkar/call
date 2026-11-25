import { create } from 'zustand';
import { appConfigApi } from '../services/api';

const defaults = {
  appName: 'Pulse',
  maintenanceMode: false,
  messageTtlHours: 24,
  maxMessageLength: 4000,
  callDurationLimitMinutes: 0,
  maxGroupMembers: 256,
  maxGroupFileSizeMb: 25,
  features: {
    chat: true, audioCalls: true, videoCalls: true, screenSharing: true,
    groupChat: true, fileSharing: true, pushNotifications: true,
    pwaInstall: true, registration: true, userVerification: false,
  },
};

export const useAppConfigStore = create((set) => ({
  config: defaults,
  ready: false,
  load: async () => {
    try {
      const config = await appConfigApi.get();
      set((state) => ({ config: { ...state.config, ...config, features: { ...state.config.features, ...(config.features || {}) } }, ready: true }));
      return config;
    } catch {
      set({ ready: true });
      return null;
    }
  },
}));
