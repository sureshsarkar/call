const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { escapeRegex } = require('../utils/text');
const { emitToUser } = require('../sockets/state');

exports.history = asyncHandler(async (req, res) => {
  const me = req.user._id;
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const conversation = await Conversation.findOne({ participantsKey: Conversation.keyFor(me, req.params.userId) });
  if (!conversation) return res.json({ messages: [], hasMore: false });

  const filter = { conversation: conversation._id, deletedFor: { $ne: me } };
  if (req.query.before) filter.createdAt = { $lt: new Date(req.query.before) };

  const rows = await Message.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  res.json({ messages: rows.slice(0, limit).reverse(), hasMore });
});

exports.search = asyncHandler(async (req, res) => {
  const me = req.user._id;
  const convs = await Conversation.find({ participants: me }).select('_id participants').lean();
  const byId = new Map(convs.map((c) => [String(c._id), c]));
  const rows = await Message.find({
    conversation: { $in: [...byId.keys()] },
    deletedFor: { $ne: me },
    deletedForEveryone: false,
    text: new RegExp(escapeRegex(req.query.q), 'i'),
  })
    .sort({ createdAt: -1 })
    .limit(30)
    .populate('sender receiver', 'name avatar')
    .lean();

  res.json({
    results: rows.map((m) => {
      const other = String(m.sender._id) === String(me) ? m.receiver : m.sender;
      return { _id: m._id, text: m.text, createdAt: m.createdAt, sender: m.sender._id, withUser: other };
    }),
  });
});

exports.remove = asyncHandler(async (req, res) => {
  const me = String(req.user._id);
  const message = await Message.findById(req.params.id);
  if (!message || (String(message.sender) !== me && String(message.receiver) !== me)) {
    throw new ApiError(404, 'Message not found'); // also hides existence from non-participants
  }
  const scope = req.query.scope === 'everyone' ? 'everyone' : 'me';
  const io = req.app.get('io');

  if (scope === 'everyone') {
    if (String(message.sender) !== me) throw new ApiError(403, 'Only the sender can delete a message for everyone');
    message.deletedForEveryone = true;
    message.text = '';
    message.links = [];
    await message.save();
    const payload = { messageId: message._id, conversationId: message.conversation, scope: 'everyone' };
    emitToUser(io, message.sender, 'message_deleted', payload);
    emitToUser(io, message.receiver, 'message_deleted', payload);
  } else {
    await Message.updateOne({ _id: message._id }, { $addToSet: { deletedFor: req.user._id } });
    emitToUser(io, me, 'message_deleted', { messageId: message._id, conversationId: message.conversation, scope: 'me' });
  }
  res.json({ message: 'Deleted' });
});
