const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const asyncHandler = require('../utils/asyncHandler');

exports.list = asyncHandler(async (req, res) => {
  const me = req.user._id;
  const conversations = await Conversation.find({ participants: me, lastMessage: { $exists: true } })
    .sort({ updatedAt: -1 })
    .limit(100)
    .populate('participants', 'name avatar about isOnline lastSeen')
    .populate('lastMessage')
    .lean();

  const unread = await Message.aggregate([
    { $match: { receiver: new mongoose.Types.ObjectId(me), status: { $ne: 'seen' }, deletedForEveryone: false, deletedFor: { $ne: me } } },
    { $group: { _id: '$conversation', count: { $sum: 1 } } },
  ]);
  const unreadMap = new Map(unread.map((u) => [String(u._id), u.count]));

  const items = conversations.map((c) => {
    const participant = c.participants.find((p) => String(p._id) !== String(me));
    let last = c.lastMessage;
    if (last && last.deletedFor?.some((id) => String(id) === String(me))) last = { ...last, text: '', deletedForMe: true };
    return {
      _id: c._id,
      participant,
      lastMessage: last || null,
      unreadCount: unreadMap.get(String(c._id)) || 0,
      updatedAt: c.updatedAt,
    };
  }).filter((c) => c.participant);

  res.json({ conversations: items });
});
