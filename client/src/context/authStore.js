import { create } from 'zustand';
import { authApi, getToken, setToken, userApi } from '../services/api';

export const useAuthStore = create((set, get) => ({
  user: null,
  token: getToken(),
  ready: false,

  /** Restore the session from the stored token on app start. */
  init: async () => {
    if (!getToken()) return set({ ready: true });
    try {
      const { user } = await authApi.me();
      set({ user, token: getToken(), ready: true });
    } catch (err) {
      // only drop the token when the server rejected it; keep it on network failure
      if (err.response?.status === 401) { setToken(null); set({ user: null, token: null }); }
      set({ ready: true });
    }
  },

  applyAuth: ({ token, user }) => {
    setToken(token);
    set({ token, user });
  },

  login: async (body) => { const result = await authApi.login(body); if (!result.requiresTwoFactor) get().applyAuth(result); return result; },
  register: async (body) => { const result = await authApi.register(body); if (!result.requiresVerification) get().applyAuth(result); return result; },

  logout: async () => {
    try { await authApi.logout(); } catch { /* token may already be invalid */ }
    setToken(null);
    set({ user: null, token: null });
  },

  expire: () => { setToken(null); set({ user: null, token: null }); },

  setUser: (user) => set({ user }),
  updateProfile: async (body) => set({ user: await userApi.update(body) }),
  uploadAvatar: async (file) => set({ user: await userApi.uploadAvatar(file) }),
}));
