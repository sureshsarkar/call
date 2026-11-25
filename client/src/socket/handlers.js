import toast from 'react-hot-toast';
import { useChatStore } from '../context/chatStore';
import { useGroupStore } from '../context/groupStore';
import { useAuthStore } from '../context/authStore';
import { useSettingsStore } from '../context/settingsStore';
import { callManager } from '../webrtc/CallManager';
import { groupCallManager } from '../webrtc/GroupCallManager';
import { useCallStore } from '../context/callStore';
import { playMessage } from '../utils/sounds';
import { systemNotify } from '../utils/notify';
import { useAppConfigStore } from '../context/appConfigStore';

/** Wires every Socket.IO event to the stores / call manager. Call once per socket instance. */
export function bindSocket(socket, navigate) {
  const chat = () => useChatStore.getState();
  const groups = () => useGroupStore.getState();
  const myId = () => String(useAuthStore.getState().user?._id);

  socket.on('connect', () => {
    // after (re)connect re-sync anything missed while offline
    chat().loadConversations();
    chat().loadNotifications();
    groups().loadGroups();
    const active = chat().activeUserId;
    if (active) chat().loadHistory(active);
    const activeGroup = groups().activeGroupId;
    if (activeGroup) groups().loadHistory(activeGroup);
  });
  socket.on('admin_config_updated', async () => {
    const config = await useAppConfigStore.getState().load();
    void groups().loadGroups();
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
  socket.on('notification', (n) => {
    const activeGroup = n.group && groups().activeGroupId === String(n.group?._id);
    if (activeGroup) { void groups().markRead(String(n.group._id)); return; }
    if (n.type === 'missed_call' || (n.group ? true : chat().activeUserId !== String(n.from?._id))) chat().addNotification(n);
  });

  socket.on('group_receive_message', (message) => {
    const { groupId, active, muted } = groups().onReceive(message);
    const mine = String(message.sender?._id || message.sender) === String(useAuthStore.getState().user?._id);
    if (!active && !mine && !muted) {
      const sender = message.sender?.name || 'New message';
      const group = groups().groups.find((item) => String(item._id) === groupId);
      const label = `${sender} · ${group?.name || 'Group'}`;
      if (useSettingsStore.getState().sounds) playMessage();
      toast(`${label}: ${message.deletedForEveryone ? 'Message deleted' : message.text?.slice(0, 60) || 'New message'}`, { icon: '👥', id: `group-msg-${groupId}` });
      systemNotify(label, message.text?.slice(0, 100) || 'New group message', { tag: `group-${groupId}`, onClick: () => navigate(`/group/${groupId}`) });
    }
  });
  socket.on('group_message_updated', (message) => groups().onUpdated(message));
  socket.on('group_receipts_updated', (payload) => groups().onReceipts(payload));
  socket.on('group_unread_cleared', ({ groupId }) => {
    groups().clearUnread(groupId);
  });
  socket.on('group_updated', ({ groupId }) => {
    void groups().refreshGroup(groupId);
  });
  socket.on('group_join_request', ({ groupId }) => { void groups().refreshGroup(groupId); });
  socket.on('group_removed', ({ groupId }) => {
    const wasActive = groups().activeGroupId === String(groupId);
    groups().removeGroup(String(groupId));
    if (wasActive) navigate('/');
    toast('You are no longer a member of this group', { icon: '👥' });
  });
  socket.on('group_join_result', ({ groupId, approved }) => {
    if (approved) {
      toast.success('Your request to join was approved');
      void groups().loadGroups().then(() => navigate(`/group/${groupId}`));
    } else toast('Your request to join was declined');
  });
  socket.on('group_typing', ({ groupId, from }) => {
    groups().setTyping(groupId, from, true);
    const key = `${groupId}-${from}`;
    clearTimeout(bindSocket.groupTimers?.[key]);
    bindSocket.groupTimers = { ...(bindSocket.groupTimers || {}), [key]: setTimeout(() => groups().setTyping(groupId, from, false), 4000) };
  });
  socket.on('group_stop_typing', ({ groupId, from }) => groups().setTyping(groupId, from, false));

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
  groupCallManager.bind(socket);
  void myId;
}
