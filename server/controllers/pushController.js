const PushSubscription = require('../models/PushSubscription');
const { ready } = require('../services/push');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Message = require('../models/Message');
const { emitToUser } = require('../sockets/state');

exports.publicKey = (_req, res) => res.json({ publicKey: ready() ? require('../config/env').vapidPublicKey : null });

exports.subscribe = asyncHandler(async (req, res) => {
  const sub = req.body;
  if (!ready()) throw new ApiError(503, 'Push notifications are not configured on the server');
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new ApiError(400, 'Invalid push subscription');
  await PushSubscription.findOneAndUpdate(
    { endpoint: sub.endpoint },
    { user: req.user._id, endpoint: sub.endpoint, keys: sub.keys, ackUrl: `${req.protocol}://${req.get('host')}/api/push/delivery-ack` },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  res.json({ enabled: true });
});

// The push endpoint URL acts as a per-device bearer credential for the service worker ack.
exports.deliveryAck = asyncHandler(async (req, res) => {
  const { endpoint, messageId } = req.body || {};
  if (!endpoint || !messageId) throw new ApiError(400, 'Invalid delivery receipt');
  const subscription = await PushSubscription.findOne({ endpoint }).select('user');
  if (!subscription) return res.status(204).end();
  const message = await Message.findOneAndUpdate(
    { _id: messageId, receiver: subscription.user, status: 'sent' },
    { $set: { status: 'delivered', deliveredAt: new Date() } },
    { returnDocument: 'after' }
  ).select('_id sender');
  if (message) emitToUser(req.app.get('io'), message.sender, 'messages_delivered', { messageIds: [String(message._id)] });
  res.json({ delivered: Boolean(message) });
});

exports.unsubscribe = asyncHandler(async (req, res) => {
  if (req.body?.endpoint) await PushSubscription.deleteOne({ user: req.user._id, endpoint: req.body.endpoint });
  res.json({ enabled: false });
});
