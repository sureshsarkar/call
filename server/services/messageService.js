const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const { cleanText, extractUrls } = require('../utils/text');
const { getLinkPreview } = require('./linkPreview');
const { cutoff } = require('../utils/retention');
const { getRuntimeConfig } = require('./runtimeConfig');

/** Persists a message, updates the conversation and the receiver's notification. */
async function createMessage({ senderId, receiverId, text, receiverOnline, replyToMessageId }) {
  const settings = getRuntimeConfig();
  if (settings.features.chat === false) throw new ApiError(503, 'Chat is temporarily disabled');
  const body = cleanText(text, settings.maxMessageLength || 4000);
  if (!body) throw new ApiError(400, 'Message cannot be empty');
  if (String(senderId) === String(receiverId)) throw new ApiError(400, 'You cannot message yourself');

  const receiver = await User.exists({ _id: receiverId });
  if (!receiver) throw new ApiError(404, 'Recipient not found');

  const conversation = await Conversation.findOrCreate(senderId, receiverId);
  let replyTo = null;
  if (replyToMessageId) {
    if (!require('mongoose').isValidObjectId(replyToMessageId)) throw new ApiError(400, 'Invalid message being replied to');
    const original = await Message.findOne({ _id: replyToMessageId, conversation: conversation._id, deletedForEveryone: false, deletedFor: { $ne: senderId }, createdAt: { $gte: cutoff() } }).select('_id');
    if (!original) throw new ApiError(404, 'Original message is unavailable');
    replyTo = original._id;
  }
  const message = await Message.create({
    conversation: conversation._id,
    sender: senderId,
    receiver: receiverId,
    text: body,
    reply_to_message_id: replyTo,
    links: extractUrls(body).map((url) => ({ url })),
    // A live socket or accepted push request is not proof that the receiver device got the message.
    status: 'sent',
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

async function populateReplies(messages, viewerId) {
  const list = Array.isArray(messages) ? messages : [messages];
  await Message.populate(list, {
    path: 'reply_to_message_id',
    select: 'sender text links deletedFor deletedForEveryone type media fileName attachment createdAt',
    populate: { path: 'sender', select: 'name' },
  });
  for (const message of list) {
    const original = message.reply_to_message_id;
    if (!original) continue;
    if (original.createdAt < cutoff() || original.deletedFor?.some((id) => String(id) === String(viewerId))) {
      message.replyTo = { unavailable: true };
    } else {
      message.replyTo = {
        _id: original._id,
        sender: original.sender,
        text: original.text,
        links: original.links,
        deletedForEveryone: original.deletedForEveryone,
        type: original.type,
        media: original.media,
        fileName: original.fileName,
        attachment: original.attachment,
        createdAt: original.createdAt,
      };
    }
  }
  return messages;
}

module.exports = { createMessage, enrichLinks, populateReplies };
