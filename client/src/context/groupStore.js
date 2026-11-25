import { create } from 'zustand';
import toast from 'react-hot-toast';
import { groupApi, errMsg } from '../services/api';
import { getSocket, emitAck } from '../socket/socket';
import { useAuthStore } from './authStore';

const myId = () => String(useAuthStore.getState().user?._id || '');
const idOf = (value) => String(value?._id ?? value ?? '');
const normalize = (message) => ({ ...message, replyTo: message.reply_to_message_id || message.replyTo || null });
const emptyThread = { messages: [], hasMore: false, loaded: false, loading: false };

export const useGroupStore = create((set, get) => ({
  groups: [],
  threads: {},
  detailsById: {},
  activeGroupId: null,
  maxMembers: 256,
  maxFileSizeMb: 25,
  maxMessageLength: 4000,
  typing: {},
  loading: false,

  loadGroups: async () => {
    try {
      const data = await groupApi.list();
      set({ groups: data.groups || [], maxMembers: data.maxMembers || 256, maxFileSizeMb: data.maxFileSizeMb || 25 });
    } catch (error) {
      if (error.response?.status !== 503) toast.error(errMsg(error));
    }
  },

  setActive: (groupId) => {
    set({ activeGroupId: groupId || null });
    if (groupId) {
      if (!get().threads[groupId]?.loaded) void get().loadHistory(groupId);
      void get().markRead(groupId);
    }
  },

  loadHistory: async (groupId, older = false) => {
    const thread = get().threads[groupId] || emptyThread;
    if (thread.loading) return;
    set((state) => ({ threads: { ...state.threads, [groupId]: { ...thread, loading: true } } }));
    try {
      const before = older ? thread.messages.find((m) => !String(m._id).startsWith('tmp-'))?.createdAt : undefined;
      const result = await groupApi.history(groupId, before);
      const messages = result.messages.map(normalize);
      const received = messages.filter((m) => idOf(m.sender) !== myId() && !(m.deliveredBy || []).map(idOf).includes(myId())).map((m) => m._id);
      if (received.length) getSocket()?.emit('group_messages_received', { groupId, messageIds: received });
      set((state) => {
        const current = state.threads[groupId] || emptyThread;
        const merged = older
          ? [...messages, ...current.messages.filter((m) => !messages.some((item) => item._id === m._id))]
          : [...messages, ...current.messages.filter((m) => !messages.some((item) => item._id === m._id))];
        return { maxMessageLength: result.maxMessageLength || state.maxMessageLength, maxFileSizeMb: result.maxFileSizeMb || state.maxFileSizeMb, threads: { ...state.threads, [groupId]: { messages: merged, hasMore: result.hasMore, loading: false, loaded: true } } };
      });
    } catch (error) {
      toast.error(errMsg(error));
      set((state) => ({ threads: { ...state.threads, [groupId]: { ...(state.threads[groupId] || emptyThread), loading: false, loaded: true } } }));
    }
  },

  sendMessage: async (groupId, text, quoted = null, forwarded = false) => {
    const clean = text.trim();
    if (!clean) return;
    const createdAt = new Date().toISOString();
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic = { _id: tempId, tempId, group: groupId, sender: myId(), text: clean, replyTo: quoted, forwarded, status: 'sending', createdAt, deliveredBy: [], readBy: [] };
    set((state) => {
      const thread = state.threads[groupId] || emptyThread;
      return { threads: { ...state.threads, [groupId]: { ...thread, messages: [...thread.messages, optimistic] } }, groups: state.groups.map((group) => String(group._id) === String(groupId) ? { ...group, lastMessage: optimistic, updatedAt: createdAt } : group) };
    });
    const result = await emitAck('send_group_message', { groupId, text: clean, tempId, replyToMessageId: quoted?._id, forwarded });
    if (result.ok) get().replaceTemp(groupId, tempId, normalize(result.message));
    else {
      get().patchMessage(groupId, tempId, { status: 'failed' });
      toast.error(result.error || 'Message not sent');
    }
    return Boolean(result.ok);
  },
  sendAttachment: async (groupId, file, text = '', quoted = null, forwarded = false) => {
    try {
      const message = normalize(await groupApi.uploadMessage(groupId, file, text, quoted?._id, forwarded));
      get().onSent(message);
      return message;
    } catch (error) {
      toast.error(errMsg(error));
      return null;
    }
  },
  retryMessage: async (groupId, message) => {
    set((state) => ({ threads: { ...state.threads, [groupId]: { ...(state.threads[groupId] || emptyThread), messages: (state.threads[groupId]?.messages || []).filter((item) => String(item._id) !== String(message._id)) } } }));
    await get().sendMessage(groupId, message.text, message.replyTo);
  },

  replaceTemp: (groupId, tempId, message) => set((state) => {
    const thread = state.threads[groupId] || emptyThread;
    const exists = thread.messages.some((item) => String(item._id) === String(message._id));
    const messages = exists ? thread.messages.filter((item) => item._id !== tempId) : thread.messages.map((item) => String(item._id) === String(tempId) ? message : item);
    return { threads: { ...state.threads, [groupId]: { ...thread, messages } }, groups: state.groups.map((group) => String(group._id) === String(groupId) ? { ...group, lastMessage: message, updatedAt: message.createdAt } : group) };
  }),

  insertMessage: (groupId, rawMessage) => set((state) => {
    const thread = state.threads[groupId] || emptyThread;
    const message = normalize(rawMessage);
    if (thread.messages.some((item) => String(item._id) === String(message._id))) return state;
    const messages = [...thread.messages, message].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return { threads: { ...state.threads, [groupId]: { ...thread, messages } } };
  }),

  onReceive: (rawMessage) => {
    const message = normalize(rawMessage);
    const groupId = idOf(message.group);
    const active = get().activeGroupId === groupId && document.visibilityState === 'visible';
    get().insertMessage(groupId, message);
    const mine = idOf(message.sender) === myId();
    const group = get().groups.find((item) => String(item._id) === groupId);
    const member = group?.members?.find((item) => idOf(item.user) === myId());
    set((state) => ({ groups: state.groups.map((group) => String(group._id) === groupId ? {
      ...group, lastMessage: message, updatedAt: message.createdAt,
      unreadCount: active || mine ? 0 : (group.unreadCount || 0) + 1,
    } : group).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) }));
    if (active) void get().markRead(groupId);
    else getSocket()?.emit('group_messages_received', { groupId, messageIds: [message._id] });
    return { groupId, active, muted: Boolean(member?.muted) };
  },

  onSent: (rawMessage) => {
    const message = normalize(rawMessage);
    const groupId = idOf(message.group);
    const thread = get().threads[groupId];
    if (message.tempId && thread?.messages.some((item) => item._id === message.tempId)) get().replaceTemp(groupId, message.tempId, message);
    else get().insertMessage(groupId, message);
    set((state) => ({ groups: state.groups.map((group) => String(group._id) === groupId ? { ...group, lastMessage: message, updatedAt: message.createdAt } : group).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) }));
  },

  onUpdated: (rawMessage) => {
    const message = normalize(rawMessage);
    const groupId = idOf(message.group);
    set((state) => {
      const thread = state.threads[groupId];
      const threads = thread ? { ...state.threads, [groupId]: { ...thread, messages: thread.messages.map((item) => String(item._id) === String(message._id) ? { ...item, ...message } : item) } } : state.threads;
      const groups = state.groups.map((group) => String(group._id) === groupId && String(group.lastMessage?._id) === String(message._id) ? { ...group, lastMessage: message } : group);
      return { threads, groups };
    });
  },

  onReceipts: ({ groupId, messageIds = [], userId, delivered, read }) => set((state) => {
    const target = new Set(messageIds.map(String));
    const thread = state.threads[groupId];
    if (!thread) return state;
    const messages = thread.messages.map((message) => {
      if (!target.has(String(message._id))) return message;
      const deliveredBy = new Set((message.deliveredBy || []).map(idOf));
      const readBy = new Set((message.readBy || []).map(idOf));
      if (delivered) deliveredBy.add(String(userId));
      if (read) readBy.add(String(userId));
      return { ...message, deliveredBy: [...deliveredBy], readBy: [...readBy] };
    });
    return { threads: { ...state.threads, [groupId]: { ...thread, messages } } };
  }),

  patchMessage: (groupId, messageId, patch) => set((state) => {
    const thread = state.threads[groupId];
    if (!thread) return state;
    return { threads: { ...state.threads, [groupId]: { ...thread, messages: thread.messages.map((message) => String(message._id) === String(messageId) ? { ...message, ...patch } : message) } } };
  }),

  markRead: async (groupId) => {
    const thread = get().threads[groupId];
    const unread = (thread?.messages || []).filter((message) => idOf(message.sender) !== myId()).map((message) => message._id);
    getSocket()?.emit('group_messages_read', { groupId });
    set((state) => ({ groups: state.groups.map((group) => String(group._id) === String(groupId) ? { ...group, unreadCount: 0 } : group) }));
    if (unread.length) get().onReceipts({ groupId, messageIds: unread, userId: myId(), delivered: true, read: true });
    try { await groupApi.markRead(groupId); } catch { /* socket acknowledgement remains authoritative */ }
  },
  clearUnread: (groupId) => set((state) => ({ groups: state.groups.map((group) => String(group._id) === String(groupId) ? { ...group, unreadCount: 0 } : group) })),

  loadDetails: async (groupId) => {
    const details = await groupApi.get(groupId);
    get().upsertGroup(details.group);
    set((state) => ({ detailsById: { ...state.detailsById, [groupId]: details } }));
    return details;
  },
  upsertGroup: (group) => set((state) => ({ groups: [group, ...state.groups.filter((item) => String(item._id) !== String(group._id))].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) })),
  removeGroup: (groupId) => set((state) => ({ groups: state.groups.filter((group) => String(group._id) !== String(groupId)), activeGroupId: state.activeGroupId === groupId ? null : state.activeGroupId })),
  setTyping: (groupId, userId, typing) => set((state) => {
    const current = new Set(state.typing[groupId] || []);
    if (typing) current.add(String(userId)); else current.delete(String(userId));
    return { typing: { ...state.typing, [groupId]: [...current] } };
  }),

  createGroup: async (body) => {
    const group = await groupApi.create(body);
    get().upsertGroup(group);
    return group;
  },
  refreshGroup: async (groupId) => { try { const details = await groupApi.get(groupId); get().upsertGroup(details.group); set((state) => ({ detailsById: { ...state.detailsById, [groupId]: details } })); return details.group; } catch { return null; } },
  reset: () => set({ groups: [], threads: {}, detailsById: {}, activeGroupId: null, typing: {}, loading: false }),
}));
