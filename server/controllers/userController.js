const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const config = require('../config/env');
const { escapeRegex, cleanLabel } = require('../utils/text');
const { hasImageSignature, avatarDir } = require('../middleware/upload');
const { signToken } = require('../middleware/auth');
const { onlineUsers } = require('../sockets/state');

const PUBLIC_FIELDS = 'name avatar about isOnline lastSeen';

exports.searchUsers = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ users: [] });
  // partial match on name, exact match on email (prevents harvesting addresses)
  const users = await User.find({
    _id: { $ne: req.user._id },
    $or: [{ name: new RegExp(escapeRegex(q), 'i') }, { email: q.toLowerCase() }],
  })
    .select(PUBLIC_FIELDS)
    .limit(20)
    .lean();
  const mine = new Set(req.user.contacts.map(String));
  res.json({ users: users.map((u) => ({ ...u, isContact: mine.has(String(u._id)) })) });
});

exports.getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select(PUBLIC_FIELDS).lean();
  if (!user) throw new ApiError(404, 'User not found');
  res.json({ user: { ...user, isContact: req.user.contacts.some((c) => String(c) === String(user._id)) } });
});

exports.onlineUsers = asyncHandler(async (req, res) => {
  const ids = [...onlineUsers.keys()].filter((id) => id !== String(req.user._id)).slice(0, 50);
  const users = await User.find({ _id: { $in: ids } }).select(PUBLIC_FIELDS).lean();
  res.json({ users });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  if (req.body.name !== undefined) req.user.name = cleanLabel(req.body.name, 50);
  if (req.body.about !== undefined) req.user.about = cleanLabel(req.body.about, 140);
  await req.user.save();
  res.json({ user: req.user.toSelf() });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password +tokenVersion');
  if (!(await user.comparePassword(req.body.currentPassword))) throw new ApiError(400, 'Current password is incorrect');
  user.password = req.body.newPassword;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  res.json({ token: signToken(user), user: user.toSelf(), message: 'Password updated' });
});

exports.uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No image uploaded');
  if (!hasImageSignature(req.file.path)) {
    fs.unlink(req.file.path, () => {});
    throw new ApiError(415, 'File content is not a valid image');
  }
  const old = req.user.avatar;
  req.user.avatar = `/uploads/avatars/${req.file.filename}`;
  await req.user.save();
  if (old?.startsWith('/uploads/avatars/')) fs.unlink(path.join(avatarDir, path.basename(old)), () => {});
  res.json({ user: req.user.toSelf() });
});

exports.listContacts = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('contacts', PUBLIC_FIELDS);
  const contacts = [...user.contacts].sort((a, b) => a.name.localeCompare(b.name));
  res.json({ contacts });
});

exports.addContact = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) throw new ApiError(400, 'You cannot add yourself');
  const target = await User.findById(req.params.id).select(PUBLIC_FIELDS);
  if (!target) throw new ApiError(404, 'User not found');
  await User.updateOne({ _id: req.user._id }, { $addToSet: { contacts: target._id } });
  res.status(201).json({ contact: target });
});

exports.removeContact = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $pull: { contacts: req.params.id } });
  res.json({ message: 'Contact removed' });
});

void config;
