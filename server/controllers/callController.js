const CallHistory = require('../models/CallHistory');
const asyncHandler = require('../utils/asyncHandler');
const { getIceServers, hasTurn } = require('../services/ice');

exports.history = asyncHandler(async (req, res) => {
  const me = req.user._id;
  const calls = await CallHistory.find({ $or: [{ caller: me }, { callee: me }], status: { $ne: 'ringing' }, hiddenFor: { $ne: me } })
    .sort({ startedAt: -1 })
    .limit(60)
    .populate('caller callee', 'name avatar')
    .lean();
  res.json({
    calls: calls.map((c) => {
      const outgoing = String(c.caller._id) === String(me);
      return {
        _id: c._id,
        type: c.type,
        status: c.status,
        direction: outgoing ? 'outgoing' : 'incoming',
        peer: outgoing ? c.callee : c.caller,
        startedAt: c.startedAt,
        duration: c.duration,
      };
    }),
  });
});

exports.clearHistory = asyncHandler(async (req, res) => {
  const result = await CallHistory.updateMany(
    { $or: [{ caller: req.user._id }, { callee: req.user._id }], status: { $ne: 'ringing' }, hiddenFor: { $ne: req.user._id } },
    { $addToSet: { hiddenFor: req.user._id } }
  );
  res.json({ cleared: result.modifiedCount });
});

exports.iceServers = asyncHandler(async (req, res) => {
  const iceServers = await getIceServers(req.user._id);
  res.json({ iceServers, turnConfigured: hasTurn(iceServers) });
});

exports.incoming = asyncHandler(async (req, res) => {
  const incoming = await require('../sockets/call').getIncomingCall(req.params.id, req.user._id);
  if (!incoming) return res.status(404).json({ message: 'Call is no longer available' });
  res.json({ incoming });
});
