const mongoose = require('mongoose');
const Group = require('../models/Group');
const GroupMessage = require('../models/GroupMessage');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { cleanText } = require('../utils/text');
const { cutoff } = require('../utils/retention');
const { getRuntimeConfig } = require('../services/runtimeConfig');
const { emitToUser } = require('./state');
const { sendPush } = require('../services/push');

const room = (id) => `group:${id}`;
const isId = (value) => mongoose.isValidObjectId(value);
const uid = (value) => String(value?._id || value);

async function populateMessage(message) {
  const row = await GroupMessage.findById(message._id).lean();
  if (!row) return null;
  const replyRef = row.reply_to_message_id && String(row.reply_to_message_id);
  await GroupMessage.populate(row, [
    { path: 'sender', select: 'name username avatar' },
    { path: 'reply_to_message_id', populate: { path: 'sender', select: 'name avatar' } },
    { path: 'reactions.user', select: 'name avatar' },
  ]);
  if (replyRef && !row.reply_to_message_id) row.reply_to_message_id = { _id: replyRef, unavailable: true };
  return row;
}

module.exports = function registerGroupChat(io, socket) {
  const me = String(socket.userId);
  let tokens = 20;
  const refill = setInterval(() => { tokens = Math.min(20, tokens + 2); }, 1000);
  socket.on('disconnect', () => clearInterval(refill));

  void Group.find({ 'members.user': me }).select('_id').lean().then((groups) => {
    for (const group of groups) socket.join(room(group._id));
  }).catch((err) => console.error('[socket] group rooms', err.message));

  socket.on('send_group_message', async (data = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      if (getRuntimeConfig().features.groupChat === false) return reply({ ok: false, error: 'Group chat is temporarily disabled' });
      if (getRuntimeConfig().features.chat === false) return reply({ ok: false, error: 'Chat and messaging are temporarily disabled' });
      if (!isId(data.groupId)) return reply({ ok: false, error: 'Invalid group' });
      if (tokens <= 0) return reply({ ok: false, error: 'You are sending messages too fast' });
      tokens -= 1;
      const group = await Group.findOne({ _id: data.groupId, 'members.user': me });
      if (!group) return reply({ ok: false, error: 'Group not found' });
      const text = cleanText(data.text, getRuntimeConfig().maxMessageLength || 4000);
      if (!text) return reply({ ok: false, error: 'Message cannot be empty' });
      let replyTo = null;
      if (data.replyToMessageId) {
        if (!isId(data.replyToMessageId)) return reply({ ok: false, error: 'Invalid message being replied to' });
        const original = await GroupMessage.findOne({ _id: data.replyToMessageId, group: group._id, deletedForEveryone: false, createdAt: { $gte: cutoff() } }).select('_id');
        if (!original) return reply({ ok: false, error: 'Original message is unavailable' });
        replyTo = original._id;
      }
      const message = await GroupMessage.create({ group: group._id, sender: me, text, reply_to_message_id: replyTo, forwarded: data.forwarded === true });
      await Group.updateOne({ _id: group._id }, { lastMessage: message._id, updatedAt: message.createdAt });
      const payload = await populateMessage(message);
      const ioPayload = { ...payload, tempId: data.tempId };
      socket.to(room(group._id)).emit('group_receive_message', ioPayload);
      reply({ ok: true, message: payload });
      const recipients = group.members.filter((member) => uid(member.user) !== me && !member.muted);
      const handles = [...new Set([...text.matchAll(/@([a-zA-Z0-9._]{3,30})/g)].map((match) => match[1].toLowerCase()))];
      const mentionedIds = new Set(handles.length ? (await User.find({ username: { $in: handles }, _id: { $in: recipients.map((member) => uid(member.user)) } }).select('_id').lean()).map((user) => String(user._id)) : []);
      for (const recipient of recipients) {
        const recipientId = uid(recipient.user);
        const notification = await Notification.findOneAndUpdate(
          { user: recipientId, group: group._id, from: me, type: 'group_message', read: false },
          { $set: { body: `${mentionedIds.has(recipientId) ? 'Mentioned you · ' : ''}${text}`.slice(0, 120) }, $inc: { count: 1 } },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        ).populate('from', 'name avatar').lean();
        emitToUser(io, recipientId, 'notification', { ...notification, group: { _id: group._id, name: group.name } });
        void sendPush(recipientId, { kind: 'message', messageId: String(message._id), groupId: String(group._id), unread: notification.count, title: `${group.name} · ${payload.sender.name}`, body: text.slice(0, 120), url: `/group/${group._id}`, tag: `group-${group._id}` }).catch((err) => console.error('[push] group message', err.message));
      }
    } catch (err) {
      reply({ ok: false, error: err.message || 'Failed to send group message' });
    }
  });

  socket.on('group_messages_received', async ({ groupId, messageIds } = {}) => {
    if (!isId(groupId) || !Array.isArray(messageIds)) return;
    const ids = messageIds.filter(isId).slice(0, 100);
    try {
      const group = await Group.findOne({ _id: groupId, 'members.user': me }).select('_id');
      if (!group || !ids.length) return;
      const result = await GroupMessage.updateMany({ _id: { $in: ids }, group: group._id, sender: { $ne: me }, deliveredBy: { $ne: me } }, { $addToSet: { deliveredBy: me } });
      if (result.modifiedCount) io.to(room(group._id)).emit('group_receipts_updated', { groupId: String(group._id), messageIds: ids, userId: me, delivered: true });
    } catch (err) { console.error('[socket] group delivery ack', err.message); }
  });

  socket.on('group_messages_read', async ({ groupId } = {}) => {
    if (!isId(groupId)) return;
    try {
      const group = await Group.findOne({ _id: groupId, 'members.user': me });
      if (!group) return;
      const unread = await GroupMessage.find({ group: groupId, sender: { $ne: me }, readBy: { $ne: me }, createdAt: { $gte: cutoff() } }).select('_id').lean();
      if (unread.length) {
        const ids = unread.map((item) => item._id);
        await GroupMessage.updateMany({ _id: { $in: ids } }, { $addToSet: { deliveredBy: me, readBy: me } });
        io.to(room(groupId)).emit('group_receipts_updated', { groupId, messageIds: ids.map(String), userId: me, delivered: true, read: true });
      }
      const member = group.members.find((entry) => uid(entry.user) === me);
      member.lastReadAt = new Date(); await group.save();
      await Notification.updateMany({ user: me, group: groupId, type: 'group_message', read: false }, { read: true });
      emitToUser(io, me, 'group_unread_cleared', { groupId });
    } catch (err) { console.error('[socket] group read ack', err.message); }
  });

  socket.on('group_typing', async ({ groupId } = {}) => {
    if (!isId(groupId)) return;
    const member = await Group.exists({ _id: groupId, 'members.user': me }).catch(() => false);
    if (member) socket.to(room(groupId)).emit('group_typing', { groupId, from: me });
  });
  socket.on('group_stop_typing', async ({ groupId } = {}) => {
    if (!isId(groupId)) return;
    const member = await Group.exists({ _id: groupId, 'members.user': me }).catch(() => false);
    if (member) socket.to(room(groupId)).emit('group_stop_typing', { groupId, from: me });
  });
};
