import axios from 'axios';
import { API_URL } from '../utils/config';

export const TOKEN_KEY = 'pulse_token';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ } };

const api = axios.create({ baseURL: API_URL, timeout: 30000 });

api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// 401 on a protected call = expired/invalid session
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const url = err.config?.url || '';
    if (err.response?.status === 401 && !url.startsWith('/auth/login') && !url.startsWith('/auth/register')) onUnauthorized();
    return Promise.reject(err);
  }
);

export const errMsg = (err) => err.response?.data?.message || (err.code === 'ERR_NETWORK' ? 'Cannot reach the server' : err.message) || 'Something went wrong';

export const authApi = {
  register: (b) => api.post('/auth/register', b).then((r) => r.data),
  login: (b) => api.post('/auth/login', b).then((r) => r.data),
  logout: () => api.post('/auth/logout').then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  forgot: (email) => api.post('/auth/forgot-password', { email }).then((r) => r.data),
  reset: (token, password) => api.post(`/auth/reset-password/${token}`, { password }).then((r) => r.data),
};
export const userApi = {
  search: (q) => api.get('/users/search', { params: { q } }).then((r) => r.data.users),
  get: (id) => api.get(`/users/${id}`).then((r) => r.data.user),
  online: () => api.get('/users/online').then((r) => r.data.users),
  update: (b) => api.put('/users/me', b).then((r) => r.data.user),
  changePassword: (b) => api.put('/users/me/password', b).then((r) => r.data),
  uploadAvatar: (file) => {
    const fd = new FormData();
    fd.append('avatar', file);
    return api.post('/users/me/avatar', fd).then((r) => r.data.user);
  },
  contacts: () => api.get('/users/contacts').then((r) => r.data.contacts),
  addContact: (id) => api.post(`/users/contacts/${id}`).then((r) => r.data.contact),
  removeContact: (id) => api.delete(`/users/contacts/${id}`).then((r) => r.data),
};
export const chatApi = {
  conversations: () => api.get('/conversations').then((r) => r.data), // { conversations, ttlHours }
  history: (userId, before) => api.get(`/messages/with/${userId}`, { params: { before, limit: 40 } }).then((r) => r.data),
  getMessage: (id) => api.get(`/messages/${id}`).then((r) => r.data.message),
  search: (q) => api.get('/messages/search', { params: { q } }).then((r) => r.data.results),
  clear: (userId) => api.delete(`/messages/with/${userId}`).then((r) => r.data),
  remove: (id, scope) => api.delete(`/messages/${id}`, { params: { scope } }).then((r) => r.data),
};
export const notificationApi = {
  list: () => api.get('/notifications').then((r) => r.data),
  readAll: () => api.put('/notifications/read-all').then((r) => r.data),
  read: (id) => api.put(`/notifications/${id}/read`).then((r) => r.data),
  clear: () => api.delete('/notifications').then((r) => r.data),
};
export const callApi = {
  history: () => api.get('/calls/history').then((r) => r.data.calls),
  clearHistory: () => api.delete('/calls/history').then((r) => r.data),
  iceServers: () => api.get('/calls/ice-servers').then((r) => r.data.iceServers),
  incoming: (id) => api.get(`/calls/incoming/${id}`).then((r) => r.data.incoming),
};
export const pushApi = {
  publicKey: () => api.get('/push/public-key').then((r) => r.data.publicKey),
  subscribe: (subscription) => api.post('/push/subscribe', subscription).then((r) => r.data),
  unsubscribe: (endpoint) => api.delete('/push/subscribe', { data: { endpoint } }).then((r) => r.data),
};
export const appConfigApi = { get: () => api.get('/app/config').then((r) => r.data) };
export const contentApi = {
  list: (params) => api.get('/content', { params }).then((r) => r.data.entries),
  get: (slug) => api.get(`/content/${encodeURIComponent(slug)}`).then((r) => r.data.entry),
};
export const adminApi = {
  dashboard: () => api.get('/admin/dashboard').then((r) => r.data),
  users: (params) => api.get('/admin/users', { params }).then((r) => r.data),
  userActivity: (id) => api.get(`/admin/users/${id}/activity`).then((r) => r.data),
  createUser: (body) => api.post('/admin/users', body).then((r) => r.data),
  updateUser: (id, body) => api.put(`/admin/users/${id}`, body).then((r) => r.data),
  status: (id, body) => api.put(`/admin/users/${id}/status`, body).then((r) => r.data),
  role: (id, body) => api.put(`/admin/users/${id}/role`, body).then((r) => r.data),
  resetPassword: (id) => api.post(`/admin/users/${id}/reset-password`).then((r) => r.data),
  revokeSessions: (id) => api.post(`/admin/users/${id}/revoke-sessions`).then((r) => r.data),
  deleteUser: (id) => api.delete(`/admin/users/${id}`).then((r) => r.data),
  config: () => api.get('/admin/config').then((r) => r.data.config),
  saveConfig: (body) => api.put('/admin/config', body).then((r) => r.data),
  logs: (params) => api.get('/admin/audit-logs', { params }).then((r) => r.data),
  roles: () => api.get('/admin/roles').then((r) => r.data.roles),
  createRole: (body) => api.post('/admin/roles', body).then((r) => r.data.role),
  updateRole: (id, body) => api.put(`/admin/roles/${id}`, body).then((r) => r.data.role),
  deleteRole: (id) => api.delete(`/admin/roles/${id}`).then((r) => r.data),
  report: (params) => api.get('/admin/reports', { params }).then((r) => r.data),
  announce: (body) => api.post('/admin/announcements', body).then((r) => r.data),
  announcements: () => api.get('/admin/announcements').then((r) => r.data.announcements),
  twoFactorStatus: () => api.get('/admin/security/2fa').then((r) => r.data),
  setupTwoFactor: () => api.post('/admin/security/2fa/setup').then((r) => r.data),
  enableTwoFactor: (code) => api.post('/admin/security/2fa/enable', { code }).then((r) => r.data),
  disableTwoFactor: (code) => api.post('/admin/security/2fa/disable', { code }).then((r) => r.data),
  content: () => api.get('/admin/content').then((r) => r.data.entries),
  createContent: (body) => api.post('/admin/content', body).then((r) => r.data.entry),
  updateContent: (id, body) => api.put(`/admin/content/${id}`, body).then((r) => r.data.entry),
  deleteContent: (id) => api.delete(`/admin/content/${id}`).then((r) => r.data),
};

export default api;
