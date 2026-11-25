import toast from 'react-hot-toast';
import { useChatStore } from '../context/chatStore';
import { useAuthStore } from '../context/authStore';
import { useSettingsStore } from '../context/settingsStore';
import { callManager } from '../webrtc/CallManager';
import { useCallStore } from '../context/callStore';
import { playMessage } from '../utils/sounds';
import { systemNotify } from '../utils/notify';
import { useAppConfigStore } from '../context/appConfigStore';

/** Wires every Socket.IO event to the stores / call manager. Call once per socket instance. */
export function bindSocket(socket, navigate) {
  const chat = () => useChatStore.getState();
  const myId = () => String(useAuthStore.getState().user?._id);

  socket.on('connect', () => {
    // after (re)connect re-sync anything missed while offline
    chat().loadConversations();
    chat().loadNotifications();
    const active = chat().activeUserId;
    if (active) chat().loadHistory(active);
  });
  socket.on('admin_config_updated', async () => {
    const config = await useAppConfigStore.getState().load();
    if (config?.features?.screenSharing === false && useCallStore.getState().sharing) await callManager.stopScreenShare();
  });

  socket.on('online_users', ({ userIds }) => chat().setOnlineList(userIds));
  socket.on('user_online', ({ userId }) => chat().userOnline(userId));
  socket.on('user_offline', ({ userId, lastSeen }) => {
    chat().userOffline(userId, lastSeen);
    chat().setTyping(userId, false);
  });

  socket.on('receive_message', async (msg) => {
    const { partner, active } = await chat().onReceive(msg);
    socket.emit('messages_received', { messageIds: [msg._id] });
    if (!active) {
      const sender = chat().usersById[partner];
      if (useSettingsStore.getState().sounds) playMessage();
      toast(`${sender?.name || 'New message'}: ${msg.text.slice(0, 60)}`, { icon: '💬', id: `msg-${partner}` });
      systemNotify(sender?.name || 'New message', msg.text.slice(0, 100), { tag: `msg-${partner}`, onClick: () => navigate(`/chat/${partner}`) });
    }
    chat().setTyping(partner, false);
  });
  socket.on('message_sent', (msg) => chat().onSentFromOtherTab(msg));
  socket.on('message_updated', (msg) => chat().onUpdated(msg));
  socket.on('message_seen', ({ by }) => chat().onSeenBy(by));
  socket.on('messages_delivered', ({ messageIds }) => chat().onDeliveredMessages(messageIds));
  socket.on('message_deleted', (p) => chat().onDeleted(p));
  socket.on('chat_cleared', ({ userId }) => chat().applyChatCleared(userId)); // cleared from another tab/device
  socket.on('unread_cleared', ({ from }) => { chat().clearUnread(from); chat().markNotificationsReadFor(from); });
  socket.on('notification', (n) => { if (n.type === 'missed_call' || chat().activeUserId !== String(n.from?._id)) chat().addNotification(n); });

  socket.on('typing', ({ from }) => {
    chat().setTyping(from, true);
    clearTimeout(bindSocket.timers?.[from]);
    bindSocket.timers = { ...(bindSocket.timers || {}), [from]: setTimeout(() => chat().setTyping(from, false), 4000) };
  });
  socket.on('stop_typing', ({ from }) => chat().setTyping(from, false));

  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') useAuthStore.getState().expire();
  });

  callManager.bind(socket);
  void myId;
}
