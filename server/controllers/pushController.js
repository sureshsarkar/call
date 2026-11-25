const PushSubscription = require('../models/PushSubscription');
const { ready } = require('../services/push');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

exports.publicKey = (_req, res) => res.json({ publicKey: ready() ? require('../config/env').vapidPublicKey : null });

exports.subscribe = asyncHandler(async (req, res) => {
  const sub = req.body;
  if (!ready()) throw new ApiError(503, 'Push notifications are not configured on the server');
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new ApiError(400, 'Invalid push subscription');
  await PushSubscription.findOneAndUpdate(
    { endpoint: sub.endpoint },
    { user: req.user._id, endpoint: sub.endpoint, keys: sub.keys },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  res.json({ enabled: true });
});

exports.unsubscribe = asyncHandler(async (req, res) => {
  if (req.body?.endpoint) await PushSubscription.deleteOne({ user: req.user._id, endpoint: req.body.endpoint });
  res.json({ enabled: false });
});
