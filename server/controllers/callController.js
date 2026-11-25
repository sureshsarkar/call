const CallHistory = require('../models/CallHistory');
const asyncHandler = require('../utils/asyncHandler');
const { getIceServers, hasTurn } = require('../services/ice');

exports.history = asyncHandler(async (req, res) => {
  const me = req.user._id;
  const calls = await CallHistory.find({ $or: [{ caller: me }, { callee: me }], status: { $ne: 'ringing' } })
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

exports.iceServers = asyncHandler(async (req, res) => {
  const iceServers = await getIceServers(req.user._id);
  res.json({ iceServers, turnConfigured: hasTurn(iceServers) });
});
