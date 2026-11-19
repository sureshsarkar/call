const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const { cleanText, extractUrls } = require('../utils/text');
const { getLinkPreview } = require('./linkPreview');

/** Persists a message, updates the conversation and the receiver's notification. */
async function createMessage({ senderId, receiverId, text, receiverOnline }) {
  const body = cleanText(text);
  if (!body) throw new ApiError(400, 'Message cannot be empty');
  if (String(senderId) === String(receiverId)) throw new ApiError(400, 'You cannot message yourself');

  const receiver = await User.exists({ _id: receiverId });
  if (!receiver) throw new ApiError(404, 'Recipient not found');

  const conversation = await Conversation.findOrCreate(senderId, receiverId);
  const message = await Message.create({
    conversation: conversation._id,
    sender: senderId,
    receiver: receiverId,
    text: body,
    links: extractUrls(body).map((url) => ({ url })),
    status: receiverOnline ? 'delivered' : 'sent',
    deliveredAt: receiverOnline ? new Date() : undefined,
  });
  await Conversation.updateOne({ _id: conversation._id }, { lastMessage: message._id });

  const notification = await Notification.findOneAndUpdate(
    { user: receiverId, from: senderId, type: 'message', read: false },
    { $set: { body: body.slice(0, 120) }, $inc: { count: 1 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  ).populate('from', 'name avatar');

  return { message, notification };
}

/** Fetches previews for each link in the background and returns the updated message (or null). */
async function enrichLinks(message) {
  if (!message.links?.length) return null;
  const links = await Promise.all(message.links.map((l) => getLinkPreview(l.url)));
  return Message.findByIdAndUpdate(message._id, { links }, { returnDocument: 'after' });
}

module.exports = { createMessage, enrichLinks };
