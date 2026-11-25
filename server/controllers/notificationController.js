const Notification = require('../models/Notification');
const { cutoff } = require('../utils/retention');
const asyncHandler = require('../utils/asyncHandler');

exports.list = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id, updatedAt: { $gte: cutoff() } })
    .sort({ updatedAt: -1 })
    .limit(50)
    .populate('from', 'name avatar')
    .lean();
  res.json({ notifications, unread: notifications.filter((n) => !n.read).length });
});

exports.markRead = asyncHandler(async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, user: req.user._id }, { read: true });
  res.json({ message: 'ok' });
});

exports.markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
  res.json({ message: 'ok' });
});
