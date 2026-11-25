const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const CallHistory = require('../models/CallHistory');
const Notification = require('../models/Notification');
const PushSubscription = require('../models/PushSubscription');
const AdminRole = require('../models/AdminRole');
const AdminAuditLog = require('../models/AdminAuditLog');
const AppConfig = require('../models/AppConfig');
const AdminAnnouncement = require('../models/AdminAnnouncement');
const ContentEntry = require('../models/ContentEntry');
const SystemEvent = require('../models/SystemEvent');
const LoginEvent = require('../models/LoginEvent');
const Group = require('../models/Group');
const GroupMessage = require('../models/GroupMessage');
const GroupReport = require('../models/GroupReport');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { normalizeUsername, normalizePhone } = require('../utils/identity');
const { cleanLabel } = require('../utils/text');
const { sendMail } = require('../services/mail');
const env = require('../config/env');
const { sendPush } = require('../services/push');
const { room } = require('../sockets/state');
const runtimeConfig = require('../services/runtimeConfig');
const { encodeBase32, encryptSecret, decryptSecret, verifyTotp } = require('../utils/totp');
const { signToken } = require('../middleware/auth');
const rolePermissions = ['dashboard.view', 'users.view', 'users.edit', 'users.suspend', 'users.reset_password', 'users.delete', 'calls.view', 'settings.view', 'settings.manage', 'reports.view', 'notifications.send', 'content.manage', 'system.view'];

const log = (req, action, targetType = '', targetId = '', details = {}) => AdminAuditLog.create({
  actor: req.user._id, action, targetType, targetId: String(targetId || ''), details,
  ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].slice(0, 64),
});

const populateIo = (req) => req.app.get('io');
const cutOffActiveSessions = (req, userId) => populateIo(req)?.in(room(String(userId))).disconnectSockets(true);

async function directoryBytes(root) {
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) total += (await fs.stat(full)).size;
    }
  }
  return total;
}

exports.publicConfig = asyncHandler(async (_req, res) => {
  const { appName, maintenanceMode, messageTtlHours, maxMessageLength, features } = runtimeConfig.getRuntimeConfig();
  res.json({ appName, maintenanceMode, messageTtlHours, maxMessageLength, features });
});

exports.dashboard = asyncHandler(async (req, res) => {
  const [totalUsers, activeUsers, onlineUsers, messages, calls, callStats, conversations, groups, groupMessages, openGroupReports, notifications, recentActivity, uploadsBytes] = await Promise.all([
    User.countDocuments(), User.countDocuments({ accountStatus: 'active' }), User.countDocuments({ isOnline: true }),
    Message.countDocuments(), CallHistory.countDocuments({ status: { $ne: 'ringing' } }),
    CallHistory.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Conversation.countDocuments(), Group.countDocuments(), GroupMessage.countDocuments(), GroupReport.countDocuments({ status: 'open' }), Notification.countDocuments({ read: false }),
    AdminAuditLog.find().sort({ createdAt: -1 }).limit(10).populate('actor', 'name email role').lean(),
    directoryBytes(path.resolve(env.uploadDir)).catch(() => 0),
  ]);
  const callCounts = Object.fromEntries(callStats.map((x) => [x._id, x.count]));
  const mem = process.memoryUsage();
  await log(req, 'dashboard.view');
  res.json({
    users: { total: totalUsers, active: activeUsers, inactive: totalUsers - activeUsers, online: onlineUsers, offline: totalUsers - onlineUsers },
    messages, calls, activeCalls: callCounts.answered || 0, completedCalls: callCounts.completed || 0,
    callCounts, conversations, groups, groupMessages, openGroupReports, storage: { uploadsBytes, processRssBytes: mem.rss },
    system: { status: 'ok', uptimeSeconds: Math.round(process.uptime()), node: process.version },
    unreadNotifications: notifications, recentActivity,
  });
});

exports.listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const filter = {};
  if (['active', 'suspended', 'blocked'].includes(req.query.status)) filter.accountStatus = req.query.status;
  if (['super_admin', 'admin', 'moderator', 'support', 'custom', 'user'].includes(req.query.role)) filter.role = req.query.role;
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }, { username: new RegExp(`^${escaped}`, 'i') }];
  }
  const [users, total] = await Promise.all([
    User.find(filter).select('name email username phone avatar role customRole accountStatus suspendedUntil isOnline lastSeen isVerified createdAt').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('customRole', 'name').lean(),
    User.countDocuments(filter),
  ]);
  res.json({ users, total, page, pages: Math.ceil(total / limit) });
});

exports.createUser = asyncHandler(async (req, res) => {
  const name = cleanLabel(req.body.name, 50);
  const email = String(req.body.email || '').trim().toLowerCase();
  const username = normalizeUsername(req.body.username);
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[a-z0-9._]{3,30}$/.test(username)) throw new ApiError(400, 'Name, valid email and a 3–30 character username are required');
  if (req.body.phone && !normalizePhone(req.body.phone)) throw new ApiError(400, 'Enter a valid mobile number');
  if (env.isProd && !env.smtp.host) throw new ApiError(503, 'Account setup email is not configured on the server');
  if (await User.exists({ $or: [{ email }, { username }] })) throw new ApiError(409, 'Email or username is already in use');
  const password = crypto.randomBytes(32).toString('base64url');
  const user = await User.create({ name, email, username, phone: req.body.phone ? normalizePhone(req.body.phone) : undefined, password, role: 'user' });
  const setupToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(setupToken).digest('hex');
  user.resetPasswordExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await user.save({ validateBeforeSave: false });
  const setupUrl = `${env.clientUrls[0]}/reset-password/${setupToken}`;
  await sendMail({ to: user.email, subject: 'Set up your Pulse account', text: `An administrator created your account. Set your password within 24 hours:\n${setupUrl}`, html: `<p>An administrator created your account.</p><p><a href="${setupUrl}">Set your password</a> within 24 hours.</p>` });
  await log(req, 'user.create', 'user', user._id, { email: user.email });
  res.status(201).json({ user: user.toSelf() });
});

exports.updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+tokenVersion');
  if (!user) throw new ApiError(404, 'User not found');
  if (user.role === 'super_admin' && req.user._id.toString() !== user._id.toString()) throw new ApiError(403, 'Super Admin accounts are protected');
  if (req.body.name !== undefined) user.name = cleanLabel(req.body.name, 50);
  if (req.body.username !== undefined) {
    user.username = normalizeUsername(req.body.username);
    if (!/^[a-z0-9._]{3,30}$/.test(user.username)) throw new ApiError(400, 'Username must be 3–30 characters using letters, numbers, dots or underscores');
    if (await User.exists({ _id: { $ne: user._id }, username: user.username })) throw new ApiError(409, 'Username is already in use');
  }
  let identityChanged = false;
  if (req.body.email !== undefined) {
    const email = String(req.body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Enter a valid email address');
    if (email !== user.email && await User.exists({ _id: { $ne: user._id }, email })) throw new ApiError(409, 'Email is already in use');
    if (email !== user.email) { user.email = email; identityChanged = true; user.isVerified = false; }
  }
  if (req.body.phone !== undefined) {
    const phone = req.body.phone ? normalizePhone(req.body.phone) : '';
    if (req.body.phone && !phone) throw new ApiError(400, 'Enter a valid mobile number');
    if (phone !== (user.phone || '')) {
      if (phone && await User.exists({ _id: { $ne: user._id }, phone })) throw new ApiError(409, 'Mobile number is already in use');
      user.phone = phone || undefined;
      identityChanged = true;
    }
  }
  if (identityChanged) user.tokenVersion = (user.tokenVersion || 0) + 1;
  if (req.body.about !== undefined) user.about = cleanLabel(req.body.about, 140);
  let verificationChanged = false;
  if (req.body.isVerified !== undefined) {
    if (typeof req.body.isVerified !== 'boolean') throw new ApiError(400, 'Verification status must be true or false');
    if (user.isVerified !== req.body.isVerified) {
      user.isVerified = req.body.isVerified;
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      verificationChanged = true;
    }
  }
  await user.save();
  if (verificationChanged || identityChanged) cutOffActiveSessions(req, user._id);
  await log(req, 'user.update', 'user', user._id, { fields: Object.keys(req.body).filter((k) => ['name', 'username', 'email', 'phone', 'about', 'isVerified'].includes(k)) });
  res.json({ user: user.toSelf() });
});

exports.setUserStatus = asyncHandler(async (req, res) => {
  const { status, until } = req.body;
  if (!['active', 'suspended', 'blocked'].includes(status)) throw new ApiError(400, 'Invalid account status');
  const user = await User.findById(req.params.id).select('+tokenVersion');
  if (!user) throw new ApiError(404, 'User not found');
  if (user.role === 'super_admin') throw new ApiError(403, 'Super Admin accounts cannot be suspended or blocked');
  if (status === 'suspended' && until && (!Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.now())) throw new ApiError(400, 'Suspension end must be a future date');
  user.accountStatus = status;
  user.suspendedUntil = status === 'suspended' && until ? new Date(until) : null;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  cutOffActiveSessions(req, user._id);
  await log(req, `user.${status}`, 'user', user._id, { until: user.suspendedUntil });
  res.json({ user: { _id: user._id, accountStatus: user.accountStatus, suspendedUntil: user.suspendedUntil } });
});

exports.setUserRole = asyncHandler(async (req, res) => {
  const role = String(req.body.role || '');
  if (!['admin', 'moderator', 'support', 'user', 'custom'].includes(role)) throw new ApiError(400, 'Select a supported role; Super Admin is assigned only through server bootstrap');
  const user = await User.findById(req.params.id).select('+tokenVersion');
  if (!user) throw new ApiError(404, 'User not found');
  if (user.role === 'super_admin' || user._id.equals(req.user._id)) throw new ApiError(403, 'Cannot change this account role');
  let customRole = null;
  if (role === 'custom') {
    if (!mongoose.isValidObjectId(req.body.customRole)) throw new ApiError(400, 'Choose a valid custom role');
    customRole = await AdminRole.findOne({ _id: req.body.customRole, active: true });
    if (!customRole) throw new ApiError(404, 'Role not found or inactive');
  }
  user.role = role;
  user.customRole = customRole?._id || null;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  cutOffActiveSessions(req, user._id);
  await log(req, 'user.role_change', 'user', user._id, { role, customRole: customRole?.name });
  res.json({ user: { _id: user._id, role: user.role, customRole } });
});

exports.resetUserPassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+resetPasswordToken +resetPasswordExpires +tokenVersion');
  if (!user) throw new ApiError(404, 'User not found');
  if (user.role === 'super_admin') throw new ApiError(403, 'Use the account owner password recovery for Super Admin');
  if (env.isProd && !env.smtp.host) throw new ApiError(503, 'Password reset email is not configured on the server');
  const token = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');
  user.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save({ validateBeforeSave: false });
  cutOffActiveSessions(req, user._id);
  const url = `${env.clientUrls[0]}/reset-password/${token}`;
  await sendMail({ to: user.email, subject: 'Reset your Pulse password', text: `An administrator initiated a password reset. Use this one-time link within 30 minutes:\n${url}`, html: `<p>An administrator initiated a password reset.</p><p><a href="${url}">Reset your password</a> (valid for 30 minutes).</p>` });
  await log(req, 'user.password_reset_requested', 'user', user._id);
  res.json({ message: 'A one-time password reset link was sent to the user email.' });
});

exports.revokeUserSessions = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+tokenVersion');
  if (!user) throw new ApiError(404, 'User not found');
  if (user.role === 'super_admin') throw new ApiError(403, 'Super Admin sessions must be managed by the account owner');
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save({ validateBeforeSave: false });
  cutOffActiveSessions(req, user._id);
  await log(req, 'user.sessions_revoked', 'user', user._id);
  res.json({ revoked: true });
});

exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  if (user.role === 'super_admin' || user._id.equals(req.user._id)) throw new ApiError(403, 'This account cannot be deleted');
  const id = user._id;
  cutOffActiveSessions(req, id);
  await Promise.all([
    Message.deleteMany({ $or: [{ sender: id }, { receiver: id }] }), Conversation.deleteMany({ participants: id }),
    CallHistory.deleteMany({ $or: [{ caller: id }, { callee: id }] }), Notification.deleteMany({ $or: [{ user: id }, { from: id }] }),
    PushSubscription.deleteMany({ user: id }), LoginEvent.deleteMany({ user: id }),
    User.updateMany({ contacts: id }, { $pull: { contacts: id } }), User.deleteOne({ _id: id }),
  ]);
  await log(req, 'user.delete', 'user', id, { email: user.email });
  res.json({ deleted: true });
});

exports.userActivity = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('name email role accountStatus createdAt lastSeen isOnline');
  if (!user) throw new ApiError(404, 'User not found');
  const [sent, received, calls, loginHistory] = await Promise.all([
    Message.countDocuments({ sender: user._id }), Message.countDocuments({ receiver: user._id }),
    CallHistory.countDocuments({ $or: [{ caller: user._id }, { callee: user._id }] }),
    LoginEvent.find({ user: user._id }).sort({ createdAt: -1 }).limit(20).select('ip userAgent createdAt success').lean(),
  ]);
  res.json({ user, activity: { messagesSent: sent, messagesReceived: received, calls, loginHistory } });
});

exports.getConfig = asyncHandler(async (_req, res) => {
  const defaults = runtimeConfig.getRuntimeConfig();
  const config = await AppConfig.findOneAndUpdate({ key: 'global' }, {
    $setOnInsert: {
      key: 'global',
      appName: defaults.appName,
      maintenanceMode: defaults.maintenanceMode,
      messageTtlHours: defaults.messageTtlHours,
      maxMessageLength: defaults.maxMessageLength,
      callDurationLimitMinutes: defaults.callDurationLimitMinutes,
      maxGroupMembers: defaults.maxGroupMembers,
      maxGroupFileSizeMb: defaults.maxGroupFileSizeMb,
      features: defaults.features,
    },
  }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  res.json({ config });
});

exports.updateConfig = asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body.appName !== undefined) {
    patch.appName = cleanLabel(req.body.appName, 60);
    if (patch.appName.length < 2) throw new ApiError(400, 'Application name must be at least 2 characters');
  }
  if (req.body.maintenanceMode !== undefined) {
    if (typeof req.body.maintenanceMode !== 'boolean') throw new ApiError(400, 'Maintenance mode must be true or false');
    patch.maintenanceMode = req.body.maintenanceMode;
  }
  if (req.body.messageTtlHours !== undefined) {
    const n = Number(req.body.messageTtlHours);
    if (!Number.isFinite(n) || n < 0 || n > 8760) throw new ApiError(400, 'Message retention must be between 0 and 8760 hours');
    patch.messageTtlHours = n;
  }
  if (req.body.maxMessageLength !== undefined) {
    const n = Number(req.body.maxMessageLength);
    if (!Number.isInteger(n) || n < 1 || n > 10000) throw new ApiError(400, 'Message limit must be from 1 to 10000 characters');
    patch.maxMessageLength = n;
  }
  if (req.body.callDurationLimitMinutes !== undefined) {
    const n = Number(req.body.callDurationLimitMinutes);
    if (!Number.isInteger(n) || n < 0 || n > 1440) throw new ApiError(400, 'Call duration limit must be 0 to 1440 minutes');
    patch.callDurationLimitMinutes = n;
  }
  if (req.body.maxGroupMembers !== undefined) {
    const n = Number(req.body.maxGroupMembers);
    if (!Number.isInteger(n) || n < 2 || n > 512) throw new ApiError(400, 'Maximum group members must be from 2 to 512');
    patch.maxGroupMembers = n;
  }
  if (req.body.maxGroupFileSizeMb !== undefined) {
    const n = Number(req.body.maxGroupFileSizeMb);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new ApiError(400, 'Maximum group file size must be from 1 to 100 MB');
    patch.maxGroupFileSizeMb = n;
  }
  if (req.body.features !== undefined) {
    const keys = ['chat', 'audioCalls', 'videoCalls', 'screenSharing', 'groupChat', 'fileSharing', 'pushNotifications', 'pwaInstall', 'registration', 'userVerification'];
    if (!req.body.features || typeof req.body.features !== 'object' || Object.keys(req.body.features).some((k) => !keys.includes(k) || typeof req.body.features[k] !== 'boolean')) throw new ApiError(400, 'Invalid feature configuration');
    for (const key of keys) if (req.body.features[key] !== undefined) patch[`features.${key}`] = req.body.features[key];
  }
  const config = await AppConfig.findOneAndUpdate({ key: 'global' }, { $set: { ...patch, updatedBy: req.user._id }, $setOnInsert: { key: 'global' } }, { upsert: true, new: true, runValidators: true });
  runtimeConfig.applyRuntimeConfig(config.toObject());
  let retentionWarning = '';
  if (patch.messageTtlHours !== undefined) {
    try { await require('../services/retention').ensureRetention(); }
    catch (error) { retentionWarning = 'The new retention value is active in queries, but MongoDB could not update its auto-delete index. Check database index permissions.'; console.error('[retention] admin update failed:', error.message); }
  }
  await log(req, 'settings.update', 'app_config', 'global', { fields: Object.keys(patch) });
  populateIo(req)?.emit('admin_config_updated', { updatedAt: config.updatedAt });
  res.json({ config, ...(retentionWarning ? { retentionWarning } : {}) });
});

exports.listAuditLogs = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const [logs, total] = await Promise.all([AdminAuditLog.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('actor', 'name email role').lean(), AdminAuditLog.countDocuments()]);
  res.json({ logs, total, page });
});

exports.listRoles = asyncHandler(async (_req, res) => res.json({ roles: await AdminRole.find().sort({ system: -1, name: 1 }).lean() }));
exports.createRole = asyncHandler(async (req, res) => {
  const name = cleanLabel(req.body.name, 40);
  const permissions = req.body.permissions;
  if (name.length < 2 || !Array.isArray(permissions) || permissions.some((p) => !rolePermissions.includes(p))) throw new ApiError(400, 'Role name and valid permissions are required');
  const role = await AdminRole.create({ name, description: cleanLabel(req.body.description, 200), permissions: [...new Set(permissions)] });
  await log(req, 'role.create', 'admin_role', role._id, { name });
  res.status(201).json({ role });
});
exports.updateRole = asyncHandler(async (req, res) => {
  const role = await AdminRole.findById(req.params.id);
  if (!role) throw new ApiError(404, 'Role not found');
  if (role.system) throw new ApiError(403, 'Built-in roles cannot be edited here');
  if (req.body.name !== undefined) role.name = cleanLabel(req.body.name, 40);
  if (req.body.description !== undefined) role.description = cleanLabel(req.body.description, 200);
  if (req.body.permissions !== undefined) {
    if (!Array.isArray(req.body.permissions) || req.body.permissions.some((p) => !rolePermissions.includes(p))) throw new ApiError(400, 'Invalid role permissions');
    role.permissions = [...new Set(req.body.permissions)];
  }
  if (req.body.active !== undefined) {
    if (typeof req.body.active !== 'boolean') throw new ApiError(400, 'Role active status must be true or false');
    role.active = req.body.active;
  }
  await role.save();
  await log(req, 'role.update', 'admin_role', role._id, { name: role.name });
  res.json({ role });
});
exports.deleteRole = asyncHandler(async (req, res) => {
  const role = await AdminRole.findById(req.params.id);
  if (!role) throw new ApiError(404, 'Role not found');
  if (role.system) throw new ApiError(403, 'Built-in roles cannot be deleted');
  const assigned = await User.find({ customRole: role._id }).select('_id').lean();
  await User.updateMany({ customRole: role._id }, { $set: { role: 'user', customRole: null }, $inc: { tokenVersion: 1 } });
  assigned.forEach((user) => cutOffActiveSessions(req, user._id));
  await AdminRole.deleteOne({ _id: role._id });
  await log(req, 'role.delete', 'admin_role', role._id, { name: role.name });
  res.json({ deleted: true });
});

exports.sendAnnouncement = asyncHandler(async (req, res) => {
  const title = cleanLabel(req.body.title, 120);
  const body = cleanLabel(req.body.body, 500);
  if (title.length < 2 || body.length < 2) throw new ApiError(400, 'Title and message are required');
  if (req.body.audience !== undefined && !['all', 'selected'].includes(req.body.audience)) throw new ApiError(400, 'Choose a valid announcement audience');
  let recipients;
  if (req.body.audience === 'selected') {
    if (!Array.isArray(req.body.recipients) || req.body.recipients.length < 1 || req.body.recipients.length > 500) throw new ApiError(400, 'Select between 1 and 500 users');
    recipients = await User.find({ _id: { $in: req.body.recipients }, accountStatus: 'active' }).select('_id');
  } else recipients = await User.find({ accountStatus: 'active', _id: { $ne: req.user._id } }).select('_id');
  const announcement = await AdminAnnouncement.create({ title, body, audience: req.body.audience === 'selected' ? 'selected' : 'all', recipients: recipients.map((u) => u._id), sender: req.user._id });
  const now = new Date();
  const docs = recipients.map((u) => ({ user: u._id, from: req.user._id, type: 'announcement', body: `${title}: ${body}`.slice(0, 200), read: false, count: 1, createdAt: now, updatedAt: now }));
  if (docs.length) await Notification.insertMany(docs);
  await log(req, 'announcement.send', 'announcement', announcement._id, { audience: announcement.audience, recipientCount: docs.length });
  await Promise.all(recipients.map((u) => sendPush(u._id, { kind: 'announcement', title, body, url: '/', tag: `announcement-${announcement._id}` }).catch(() => {})));
  res.status(201).json({ announcement: { _id: announcement._id, title, audience: announcement.audience }, deliveredTo: docs.length });
});

exports.listAnnouncements = asyncHandler(async (_req, res) => {
  const announcements = await AdminAnnouncement.find().sort({ createdAt: -1 }).limit(50).populate('sender', 'name email').lean();
  res.json({ announcements: announcements.map((item) => ({ ...item, recipientCount: item.recipients.length })) });
});

exports.reports = asyncHandler(async (req, res) => {
  const fromValue = String(req.query.from || '');
  const toValue = String(req.query.to || '');
  const from = fromValue ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(fromValue) ? `${fromValue}T00:00:00.000Z` : fromValue) : new Date(Date.now() - 30 * 86400000);
  const to = toValue ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(toValue) ? `${toValue}T23:59:59.999Z` : toValue) : new Date();
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) throw new ApiError(400, 'Invalid report date range');
  const activePipeline = (fieldNames) => [
    { $match: { createdAt: { $gte: from, $lte: to }, ...(fieldNames.length === 1 ? { success: true } : {}) } },
    { $project: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, users: fieldNames.map((field) => `$${field}`) } },
    { $unwind: '$users' }, { $group: { _id: '$day', users: { $addToSet: '$users' } } },
  ];
  const [registrations, messages, calls, logins, loginActivity, messageActivity, callActivity, systemErrors, systemErrorCount] = await Promise.all([
    User.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Message.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    CallHistory.aggregate([{ $match: { startedAt: { $gte: from, $lte: to }, status: { $ne: 'ringing' } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    LoginEvent.countDocuments({ success: true, createdAt: { $gte: from, $lte: to } }),
    LoginEvent.aggregate(activePipeline(['user'])),
    Message.aggregate(activePipeline(['sender', 'receiver'])),
    CallHistory.aggregate([{ $match: { createdAt: { $gte: from, $lte: to }, status: { $ne: 'ringing' } } }, { $project: { createdAt: '$startedAt', caller: 1, callee: 1 } }, ...activePipeline(['caller', 'callee']).slice(1)]),
    SystemEvent.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    SystemEvent.countDocuments({ createdAt: { $gte: from, $lte: to } }),
  ]);
  const dailyUsers = new Map();
  for (const row of [...loginActivity, ...messageActivity, ...callActivity]) {
    if (!dailyUsers.has(row._id)) dailyUsers.set(row._id, new Set());
    for (const id of row.users) dailyUsers.get(row._id).add(String(id));
  }
  const monthlyUsers = new Map();
  for (const [day, ids] of dailyUsers) {
    const month = day.slice(0, 7);
    if (!monthlyUsers.has(month)) monthlyUsers.set(month, new Set());
    for (const id of ids) monthlyUsers.get(month).add(id);
  }
  res.json({ from, to, registrations, messages, calls, logins, systemErrors, systemErrorCount,
    activeUsersByDay: [...dailyUsers].sort(([a], [b]) => a.localeCompare(b)).map(([_id, ids]) => ({ _id, count: ids.size })),
    activeUsersByMonth: [...monthlyUsers].sort(([a], [b]) => a.localeCompare(b)).map(([_id, ids]) => ({ _id, count: ids.size })),
  });
});

const contentKinds = ['page', 'blog', 'faq', 'category', 'contact'];
const slugify = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
const cleanContentFields = (body, current = {}) => {
  const title = body.title === undefined ? current.title : cleanLabel(body.title, 160);
  const kind = body.kind === undefined ? current.kind : String(body.kind);
  const slug = body.slug === undefined ? (current.slug || slugify(title)) : slugify(body.slug);
  if (!title || title.length < 2 || !contentKinds.includes(kind) || !slug) throw new ApiError(400, 'A valid content type, title and URL slug are required');
  if (body.published !== undefined && typeof body.published !== 'boolean') throw new ApiError(400, 'Publish status must be true or false');
  return {
    kind, title, slug,
    excerpt: body.excerpt === undefined ? current.excerpt : cleanLabel(body.excerpt, 500),
    body: body.body === undefined ? current.body : require('../utils/text').cleanText(body.body, 50000),
    category: body.category === undefined ? current.category : cleanLabel(body.category, 80),
    metaTitle: body.metaTitle === undefined ? current.metaTitle : cleanLabel(body.metaTitle, 160),
    metaDescription: body.metaDescription === undefined ? current.metaDescription : require('../utils/text').cleanText(body.metaDescription, 320),
    published: body.published === undefined ? Boolean(current.published) : Boolean(body.published),
  };
};

exports.publicContentList = asyncHandler(async (req, res) => {
  const filter = { published: true };
  if (contentKinds.includes(req.query.kind)) filter.kind = req.query.kind;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const entries = await ContentEntry.find(filter).select('kind slug title excerpt category metaTitle metaDescription updatedAt').sort({ updatedAt: -1 }).limit(limit).lean();
  res.json({ entries });
});

exports.publicContentBySlug = asyncHandler(async (req, res) => {
  const entry = await ContentEntry.findOne({ slug: slugify(req.params.slug), published: true }).lean();
  if (!entry) throw new ApiError(404, 'Page not found');
  res.json({ entry });
});

exports.listContent = asyncHandler(async (req, res) => {
  const filter = {};
  if (contentKinds.includes(req.query.kind)) filter.kind = req.query.kind;
  const entries = await ContentEntry.find(filter).sort({ updatedAt: -1 }).limit(200).lean();
  res.json({ entries });
});

exports.createContent = asyncHandler(async (req, res) => {
  const fields = cleanContentFields(req.body);
  if (await ContentEntry.exists({ slug: fields.slug })) throw new ApiError(409, 'That URL slug is already in use');
  const entry = await ContentEntry.create({ ...fields, author: req.user._id });
  await log(req, 'content.create', 'content', entry._id, { kind: entry.kind, slug: entry.slug });
  res.status(201).json({ entry });
});

exports.updateContent = asyncHandler(async (req, res) => {
  const entry = await ContentEntry.findById(req.params.id);
  if (!entry) throw new ApiError(404, 'Content entry not found');
  const fields = cleanContentFields(req.body, entry.toObject());
  if (await ContentEntry.exists({ _id: { $ne: entry._id }, slug: fields.slug })) throw new ApiError(409, 'That URL slug is already in use');
  Object.assign(entry, fields);
  await entry.save();
  await log(req, 'content.update', 'content', entry._id, { kind: entry.kind, slug: entry.slug });
  res.json({ entry });
});

exports.deleteContent = asyncHandler(async (req, res) => {
  const entry = await ContentEntry.findByIdAndDelete(req.params.id);
  if (!entry) throw new ApiError(404, 'Content entry not found');
  await log(req, 'content.delete', 'content', entry._id, { kind: entry.kind, slug: entry.slug });
  res.json({ deleted: true });
});

function requireSuperAdmin(req) {
  if (req.user?.role !== 'super_admin') throw new ApiError(403, 'Only the Super Admin can manage two-factor authentication');
}

exports.twoFactorStatus = asyncHandler(async (req, res) => {
  requireSuperAdmin(req);
  res.json({ enabled: Boolean(req.user.twoFactorEnabled) });
});

exports.setupTwoFactor = asyncHandler(async (req, res) => {
  requireSuperAdmin(req);
  if (env.isProd && !env.twoFactorEncryptionKeyConfigured) throw new ApiError(503, 'Set TWO_FACTOR_ENCRYPTION_KEY in the backend environment before enabling two-factor authentication');
  if (req.user.twoFactorEnabled) throw new ApiError(409, 'Two-factor authentication is already enabled');
  const secret = encodeBase32(crypto.randomBytes(20));
  const user = await User.findById(req.user._id).select('+twoFactorSecretEncrypted');
  user.twoFactorSecretEncrypted = encryptSecret(secret);
  await user.save({ validateBeforeSave: false });
  const label = encodeURIComponent(`Pulse:${user.email}`);
  const issuer = encodeURIComponent('Pulse');
  res.json({ secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` });
});

exports.enableTwoFactor = asyncHandler(async (req, res) => {
  requireSuperAdmin(req);
  const user = await User.findById(req.user._id).select('+twoFactorSecretEncrypted +tokenVersion');
  let valid = false;
  try { valid = Boolean(user.twoFactorSecretEncrypted) && verifyTotp(decryptSecret(user.twoFactorSecretEncrypted), req.body.code); } catch { valid = false; }
  if (!valid) throw new ApiError(400, 'The authenticator code is not valid');
  user.twoFactorEnabled = true;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save({ validateBeforeSave: false });
  cutOffActiveSessions(req, user._id);
  await log(req, 'security.2fa_enabled', 'user', user._id);
  res.json({ enabled: true, token: signToken(user), user: user.toSelf() });
});

exports.disableTwoFactor = asyncHandler(async (req, res) => {
  requireSuperAdmin(req);
  const user = await User.findById(req.user._id).select('+twoFactorSecretEncrypted +tokenVersion');
  let valid = false;
  try { valid = user.twoFactorEnabled && verifyTotp(decryptSecret(user.twoFactorSecretEncrypted), req.body.code); } catch { valid = false; }
  if (!valid) throw new ApiError(400, 'The authenticator code is not valid');
  user.twoFactorEnabled = false;
  user.twoFactorSecretEncrypted = undefined;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save({ validateBeforeSave: false });
  cutOffActiveSessions(req, user._id);
  await log(req, 'security.2fa_disabled', 'user', user._id);
  res.json({ enabled: false });
});
