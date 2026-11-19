import { create } from 'zustand';
import toast from 'react-hot-toast';
import { chatApi, userApi, notificationApi, callApi, errMsg } from '../services/api';
import { getSocket, emitAck } from '../socket/socket';
import { useAuthStore } from './authStore';

const myId = () => String(useAuthStore.getState().user?._id);
const idOf = (v) => String(v?._id ?? v);
const partnerOf = (m) => (idOf(m.sender) === myId() ? idOf(m.receiver) : idOf(m.sender));
const emptyThread = { messages: [], hasMore: false, loading: false, loaded: false };

export const useChatStore = create((set, get) => ({
  usersById: {},
  conversations: [], // [{ _id, userId, lastMessage, unreadCount, updatedAt }]
  threads: {}, // userId -> { messages, hasMore, loading, loaded }
  activeUserId: null,
  onlineIds: {}, // userId -> true  (source of truth: socket presence)
  typing: {},
  contacts: [],
  onlineList: [],
  notifications: [],
  unreadNotifications: 0,
  calls: [],
  searchResults: { users: [], messages: [] },

  // ---------- users cache / presence
  cacheUsers: (list) =>
    set((s) => {
      const usersById = { ...s.usersById };
      for (const u of list) if (u?._id) usersById[u._id] = { ...usersById[u._id], ...u };
      return { usersById };
    }),

  fetchUser: async (id) => {
    if (get().usersById[id]) return get().usersById[id];
    try {
      const u = await userApi.get(id);
      get().cacheUsers([u]);
      return u;
    } catch { return null; }
  },

  setOnlineList: (ids) => set({ onlineIds: Object.fromEntries(ids.map((i) => [i, true])) }),
  userOnline: (id) => set((s) => ({ onlineIds: { ...s.onlineIds, [id]: true } })),
  userOffline: (id, lastSeen) =>
    set((s) => {
      const onlineIds = { ...s.onlineIds };
      delete onlineIds[id];
      const usersById = s.usersById[id] ? { ...s.usersById, [id]: { ...s.usersById[id], lastSeen } } : s.usersById;
      return { onlineIds, usersById };
    }),

  setTyping: (id, on) => set((s) => ({ typing: { ...s.typing, [id]: on } })),

  // ---------- conversations
  loadConversations: async () => {
    try {
      const items = await chatApi.conversations();
      get().cacheUsers(items.map((c) => c.participant));
      set({
        conversations: items.map((c) => ({
          _id: c._id, userId: c.participant._id, lastMessage: c.lastMessage, unreadCount: c.unreadCount, updatedAt: c.updatedAt,
        })),
      });
    } catch (err) { toast.error(errMsg(err)); }
  },

  upsertConversation: (userId, patch) =>
    set((s) => {
      const exists = s.conversations.some((c) => c.userId === userId);
      const conversations = exists
        ? s.conversations.map((c) => (c.userId === userId ? { ...c, ...patch(c) } : c))
        : [{ _id: `new-${userId}`, userId, lastMessage: null, unreadCount: 0, updatedAt: new Date().toISOString(), ...patch({ unreadCount: 0 }) }, ...s.conversations];
      return { conversations };
    }),

  // ---------- thread / messages
  setActive: (userId) => {
    set({ activeUserId: userId });
    if (userId) get().markSeen(userId);
  },

  markSeen: (userId) => {
    const socket = getSocket();
    const conv = get().conversations.find((c) => c.userId === userId);
    const hasUnseen = (get().threads[userId]?.messages || []).some((m) => idOf(m.sender) === userId && m.status !== 'seen');
    if (conv?.unreadCount || hasUnseen) socket?.emit('message_seen', { from: userId });
    set((s) => ({
      conversations: s.conversations.map((c) => (c.userId === userId ? { ...c, unreadCount: 0 } : c)),
      threads: s.threads[userId]
        ? { ...s.threads, [userId]: { ...s.threads[userId], messages: s.threads[userId].messages.map((m) => (idOf(m.sender) === userId ? { ...m, status: 'seen' } : m)) } }
        : s.threads,
    }));
  },

  loadHistory: async (userId, older = false) => {
    const thread = get().threads[userId] || emptyThread;
    if (thread.loading) return;
    set((s) => ({ threads: { ...s.threads, [userId]: { ...thread, loading: true } } }));
    try {
      const before = older ? thread.messages.find((m) => !String(m._id).startsWith('tmp-'))?.createdAt : undefined;
      const { messages, hasMore } = await chatApi.history(userId, before);
      set((s) => {
        const cur = s.threads[userId] || emptyThread;
        const merged = older ? [...messages, ...cur.messages] : [...messages, ...cur.messages.filter((m) => !messages.some((x) => x._id === m._id))];
        return { threads: { ...s.threads, [userId]: { messages: merged, hasMore, loading: false, loaded: true } } };
      });
    } catch (err) {
      toast.error(errMsg(err));
      set((s) => ({ threads: { ...s.threads, [userId]: { ...(s.threads[userId] || emptyThread), loading: false, loaded: true } } }));
    }
  },

  appendMessage: (userId, msg) =>
    set((s) => {
      const t = s.threads[userId] || emptyThread;
      if (t.messages.some((m) => m._id === msg._id)) return s;
      return { threads: { ...s.threads, [userId]: { ...t, messages: [...t.messages, msg] } } };
    }),

  patchMessage: (userId, matcher, patch) =>
    set((s) => {
      const t = s.threads[userId];
      if (!t) return s;
      return { threads: { ...s.threads, [userId]: { ...t, messages: t.messages.map((m) => (matcher(m) ? { ...m, ...patch(m) } : m)) } } };
    }),

  sendMessage: async (userId, text) => {
    const clean = text.trim();
    if (!clean) return;
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const temp = { _id: tempId, tempId, sender: myId(), receiver: userId, text: clean, links: [], status: 'sending', createdAt: new Date().toISOString() };
    get().appendMessage(userId, temp);
    get().upsertConversation(userId, () => ({ lastMessage: temp, updatedAt: temp.createdAt }));

    const res = await emitAck('send_message', { to: userId, text: clean, tempId });
    if (res.ok) {
      get().replaceTemp(userId, tempId, res.message);
    } else {
      get().patchMessage(userId, (m) => m._id === tempId, () => ({ status: 'failed', error: res.error }));
      toast.error(res.error || 'Message not sent');
    }
  },

  retryMessage: async (userId, tempId) => {
    const m = get().threads[userId]?.messages.find((x) => x._id === tempId);
    if (!m) return;
    set((s) => ({ threads: { ...s.threads, [userId]: { ...s.threads[userId], messages: s.threads[userId].messages.filter((x) => x._id !== tempId) } } }));
    await get().sendMessage(userId, m.text);
  },

  replaceTemp: (userId, tempId, real) =>
    set((s) => {
      const t = s.threads[userId] || emptyThread;
      const already = t.messages.some((m) => m._id === real._id);
      const messages = already
        ? t.messages.filter((m) => m._id !== tempId)
        : t.messages.map((m) => (m._id === tempId ? real : m));
      const conversations = s.conversations.map((c) => (c.userId === userId ? { ...c, lastMessage: real, updatedAt: real.createdAt } : c));
      return { threads: { ...s.threads, [userId]: { ...t, messages } }, conversations };
    }),

  deleteMessage: async (userId, message, scope) => {
    try {
      await chatApi.remove(message._id, scope);
      // state is updated through the "message_deleted" socket event (also syncs other tabs)
    } catch (err) { toast.error(errMsg(err)); }
  },

  // ---------- socket-driven updates
  onReceive: async (msg) => {
    const partner = partnerOf(msg);
    if (!get().usersById[partner]) await get().fetchUser(partner);
    const active = get().activeUserId === partner && document.visibilityState === 'visible';
    get().appendMessage(partner, msg);
    get().upsertConversation(partner, (c) => ({
      lastMessage: msg, updatedAt: msg.createdAt, unreadCount: active ? 0 : (c.unreadCount || 0) + 1,
    }));
    if (active) get().markSeen(partner);
    return { partner, active };
  },

  onSentFromOtherTab: (msg) => {
    const partner = partnerOf(msg);
    const t = get().threads[partner];
    if (msg.tempId && t?.messages.some((m) => m._id === msg.tempId)) get().replaceTemp(partner, msg.tempId, msg);
    else {
      get().appendMessage(partner, msg);
      get().upsertConversation(partner, () => ({ lastMessage: msg, updatedAt: msg.createdAt }));
    }
  },

  onUpdated: (msg) => {
    const partner = partnerOf(msg);
    get().patchMessage(partner, (m) => m._id === msg._id, () => msg);
    set((s) => ({ conversations: s.conversations.map((c) => (c.lastMessage?._id === msg._id ? { ...c, lastMessage: msg } : c)) }));
  },

  onSeenBy: (userId) =>
    get().patchMessage(userId, (m) => idOf(m.sender) === myId() && m.status !== 'seen' && m.status !== 'sending', () => ({ status: 'seen' })),

  onDeliveredTo: (userId) =>
    get().patchMessage(userId, (m) => idOf(m.sender) === myId() && m.status === 'sent', () => ({ status: 'delivered' })),

  onDeleted: ({ messageId, scope }) =>
    set((s) => {
      const threads = {};
      for (const [uid, t] of Object.entries(s.threads)) {
        threads[uid] = {
          ...t,
          messages:
            scope === 'me'
              ? t.messages.filter((m) => m._id !== messageId)
              : t.messages.map((m) => (m._id === messageId ? { ...m, deletedForEveryone: true, text: '', links: [] } : m)),
        };
      }
      const conversations = s.conversations.map((c) =>
        c.lastMessage?._id === messageId
          ? { ...c, lastMessage: scope === 'me' ? { ...c.lastMessage, text: '', deletedForMe: true } : { ...c.lastMessage, text: '', deletedForEveryone: true } }
          : c
      );
      return { threads, conversations };
    }),

  clearUnread: (userId) =>
    set((s) => ({ conversations: s.conversations.map((c) => (c.userId === userId ? { ...c, unreadCount: 0 } : c)) })),

  // ---------- contacts / online / search
  loadContacts: async () => {
    try {
      const contacts = await userApi.contacts();
      get().cacheUsers(contacts);
      set({ contacts: contacts.map((c) => c._id) });
    } catch (err) { toast.error(errMsg(err)); }
  },
  addContact: async (id) => {
    try {
      const c = await userApi.addContact(id);
      get().cacheUsers([c]);
      set((s) => ({ contacts: s.contacts.includes(id) ? s.contacts : [...s.contacts, id] }));
      toast.success(`${c.name} added to contacts`);
    } catch (err) { toast.error(errMsg(err)); }
  },
  removeContact: async (id) => {
    try {
      await userApi.removeContact(id);
      set((s) => ({ contacts: s.contacts.filter((c) => c !== id) }));
    } catch (err) { toast.error(errMsg(err)); }
  },
  loadOnline: async () => {
    try {
      const users = await userApi.online();
      get().cacheUsers(users);
      set({ onlineList: users.map((u) => u._id) });
    } catch { /* non-critical */ }
  },
  search: async (q) => {
    const query = q.trim();
    if (!query) return set({ searchResults: { users: [], messages: [] } });
    const [users, messages] = await Promise.all([
      userApi.search(query).catch(() => []),
      query.length >= 2 ? chatApi.search(query).catch(() => []) : [],
    ]);
    get().cacheUsers(users);
    get().cacheUsers(messages.map((m) => m.withUser));
    set({ searchResults: { users: users.map((u) => u._id), messages } });
  },

  // ---------- notifications / call history
  loadNotifications: async () => {
    try {
      const { notifications, unread } = await notificationApi.list();
      set({ notifications, unreadNotifications: unread });
    } catch { /* non-critical */ }
  },
  addNotification: (n) =>
    set((s) => {
      const rest = s.notifications.filter((x) => x._id !== n._id);
      return { notifications: [n, ...rest], unreadNotifications: [n, ...rest].filter((x) => !x.read).length };
    }),
  markAllNotificationsRead: async () => {
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })), unreadNotifications: 0 }));
    try { await notificationApi.readAll(); } catch { /* ignore */ }
  },
  markNotificationsReadFor: (userId) =>
    set((s) => {
      const notifications = s.notifications.map((n) => (n.type === 'message' && idOf(n.from) === userId ? { ...n, read: true } : n));
      return { notifications, unreadNotifications: notifications.filter((n) => !n.read).length };
    }),
  loadCalls: async () => {
    try { set({ calls: await callApi.history() }); } catch { /* non-critical */ }
  },

  reset: () =>
    set({
      usersById: {}, conversations: [], threads: {}, activeUserId: null, onlineIds: {}, typing: {}, contacts: [],
      onlineList: [], notifications: [], unreadNotifications: 0, calls: [], searchResults: { users: [], messages: [] },
    }),
}));
