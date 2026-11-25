const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const asyncHandler = require('../utils/asyncHandler');
const config = require('../config/env');
const { cutoff } = require('../utils/retention');

exports.list = asyncHandler(async (req, res) => {
  const me = req.user._id;
  const since = cutoff();
  const conversations = await Conversation.find({ participants: me, lastMessage: { $exists: true }, updatedAt: { $gte: since } })
    .sort({ updatedAt: -1 })
    .limit(100)
    .populate('participants', 'name avatar about isOnline lastSeen')
    .populate('lastMessage')
    .lean();

  const unread = await Message.aggregate([
    { $match: { receiver: new mongoose.Types.ObjectId(me), status: { $ne: 'seen' }, deletedForEveryone: false, deletedFor: { $ne: me }, createdAt: { $gte: since } } },
    { $group: { _id: '$conversation', count: { $sum: 1 } } },
  ]);
  const unreadMap = new Map(unread.map((u) => [String(u._id), u.count]));

  // If the newest message was deleted/cleared for me, show the latest one I can still see (none after "Clear chat").
  const hiddenFromMe = (m) => m && (m.createdAt < since || m.deletedFor?.some((id) => String(id) === String(me)));
  await Promise.all(conversations.map(async (c) => {
    if (!hiddenFromMe(c.lastMessage)) return;
    c.lastMessage = await Message.findOne({ conversation: c._id, deletedFor: { $ne: me }, createdAt: { $gte: since } }).sort({ createdAt: -1 }).lean();
  }));

  const items = conversations.map((c) => {
    const participant = c.participants.find((p) => String(p._id) !== String(me));
    const last = c.lastMessage;
    return {
      _id: c._id,
      participant,
      lastMessage: last || null,
      unreadCount: unreadMap.get(String(c._id)) || 0,
      updatedAt: c.updatedAt,
    };
  }).filter((c) => c.participant);

  res.json({ conversations: items, ttlHours: config.messageTtlHours });
});
