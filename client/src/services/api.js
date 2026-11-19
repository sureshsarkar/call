import axios from 'axios';
import { API_URL } from '../utils/config';

export const TOKEN_KEY = 'pulse_token';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ } };

const api = axios.create({ baseURL: API_URL, timeout: 20000 });

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
  conversations: () => api.get('/conversations').then((r) => r.data.conversations),
  history: (userId, before) => api.get(`/messages/with/${userId}`, { params: { before, limit: 40 } }).then((r) => r.data),
  search: (q) => api.get('/messages/search', { params: { q } }).then((r) => r.data.results),
  remove: (id, scope) => api.delete(`/messages/${id}`, { params: { scope } }).then((r) => r.data),
};
export const notificationApi = {
  list: () => api.get('/notifications').then((r) => r.data),
  readAll: () => api.put('/notifications/read-all').then((r) => r.data),
  read: (id) => api.put(`/notifications/${id}/read`).then((r) => r.data),
};
export const callApi = {
  history: () => api.get('/calls/history').then((r) => r.data.calls),
  iceServers: () => api.get('/calls/ice-servers').then((r) => r.data.iceServers),
};

export default api;
