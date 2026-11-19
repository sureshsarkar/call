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

  login: async (body) => get().applyAuth(await authApi.login(body)),
  register: async (body) => get().applyAuth(await authApi.register(body)),

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
