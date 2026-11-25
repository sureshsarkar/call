const mongoose = require('mongoose');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Notification = require('../models/Notification');
const { createMessage, enrichLinks, populateReplies } = require('../services/messageService');
const { emitToUser, isOnline } = require('./state');
const { sendPush } = require('../services/push');

const isId = (v) => mongoose.isValidObjectId(v);

module.exports = function registerChat(io, socket) {
  const me = socket.userId;
  // simple token bucket: 20 messages / 10s per socket
  let tokens = 20;
  const refill = setInterval(() => { tokens = Math.min(20, tokens + 2); }, 1000);
  socket.on('disconnect', () => clearInterval(refill));

  socket.on('send_message', async (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      if (!data || !isId(data.to)) return reply({ ok: false, error: 'Invalid recipient' });
      if (tokens <= 0) return reply({ ok: false, error: 'You are sending messages too fast' });
      tokens -= 1;

      const online = isOnline(data.to);
      const { message, notification } = await createMessage({
        senderId: me,
        receiverId: data.to,
        text: data.text,
        replyToMessageId: data.replyToMessageId,
        receiverOnline: online,
      });
      const senderPayload = message.toObject();
      const receiverPayload = message.toObject();
      await Promise.all([populateReplies(senderPayload, me), populateReplies(receiverPayload, data.to)]);

      emitToUser(io, data.to, 'receive_message', receiverPayload);
      emitToUser(io, me, 'message_sent', { ...senderPayload, tempId: data.tempId }); // all of my tabs
      emitToUser(io, data.to, 'notification', notification);
      void sendPush(data.to, { kind: 'message', title: notification.from?.name || 'New message', body: message.text || 'Sent you a message', url: `/chat/${me}`, tag: `msg-${me}`, unread: notification.count }).catch((err) => console.error('[push] message', err.message));
      reply({ ok: true, message: senderPayload });

      // link previews are fetched after delivery so sending is never blocked
      if (senderPayload.links?.length) {
        enrichLinks(message)
          .then((updated) => {
            if (!updated) return;
            const senderUpdate = updated.toObject();
            const receiverUpdate = updated.toObject();
            return Promise.all([populateReplies(senderUpdate, me), populateReplies(receiverUpdate, data.to)]).then(() => {
              emitToUser(io, me, 'message_updated', senderUpdate);
              emitToUser(io, data.to, 'message_updated', receiverUpdate);
            });
          })
          .catch(() => {});
      }
    } catch (err) {
      reply({ ok: false, error: err.message || 'Failed to send' });
    }
  });

  socket.on('typing', ({ to } = {}) => isId(to) && emitToUser(io, to, 'typing', { from: me }));
  socket.on('stop_typing', ({ to } = {}) => isId(to) && emitToUser(io, to, 'stop_typing', { from: me }));

  // The viewer opened a chat / received a message while looking at it
  socket.on('message_seen', async ({ from } = {}) => {
    if (!isId(from)) return;
    try {
      const res = await Message.updateMany(
        { sender: from, receiver: me, status: { $ne: 'seen' } },
        { status: 'seen', seenAt: new Date() }
      );
      await Notification.updateMany({ user: me, from, type: 'message', read: false }, { read: true });
      if (res.modifiedCount > 0) {
        const conv = await Conversation.findOne({ participantsKey: Conversation.keyFor(me, from) }).select('_id');
        emitToUser(io, from, 'message_seen', { by: me, conversationId: conv?._id });
      }
      emitToUser(io, me, 'unread_cleared', { from }); // sync my other tabs
    } catch (err) {
      console.error('[socket] message_seen', err.message);
    }
  });
};
