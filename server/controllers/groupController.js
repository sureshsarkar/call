const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Group = require('../models/Group');
const GroupMessage = require('../models/GroupMessage');
const GroupActivity = require('../models/GroupActivity');
const GroupJoinRequest = require('../models/GroupJoinRequest');
const GroupReport = require('../models/GroupReport');
const Notification = require('../models/Notification');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { cleanLabel, cleanText } = require('../utils/text');
const { cutoff } = require('../utils/retention');
const runtimeConfig = require('../services/runtimeConfig');
const { emitToUser, room: userRoom } = require('../sockets/state');
const { sendPush } = require('../services/push');
const { avatarDir } = require('../middleware/upload');
const { groupMediaDir, typeForMime } = require('../middleware/groupUpload');
const env = require('../config/env');

const room = (id) => `group:${id}`;
const userId = (value) => String(value?._id || value);
const memberFor = (group, id) => group.members.find((member) => userId(member.user) === String(id));
const canAdmin = (member) => member && ['owner', 'admin'].includes(member.role);

function ensureEnabled() {
  if (runtimeConfig.getRuntimeConfig().features.groupChat === false) throw new ApiError(503, 'Group chat is temporarily disabled');
}

async function getMemberGroup(groupId, user) {
  const group = await Group.findOne({ _id: groupId, 'members.user': user._id });
  if (!group) throw new ApiError(404, 'Group not found');
  return group;
}

async function logActivity(group, actor, action, target = null, details = {}) {
  await GroupActivity.create({ group: group._id, actor, action, target, details });
}

async function populateReplies(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const references = new Map(list.map((message) => [String(message._id), message.reply_to_message_id && String(message.reply_to_message_id)]));
  await GroupMessage.populate(list, [
    { path: 'sender', select: 'name username avatar' },
    { path: 'reply_to_message_id', populate: { path: 'sender', select: 'name avatar' } },
    { path: 'reactions.user', select: 'name avatar' },
  ]);
  for (const message of list) {
    const reference = references.get(String(message._id));
    if (reference && !message.reply_to_message_id) message.reply_to_message_id = { _id: reference, unavailable: true };
  }
  return Array.isArray(rows) ? list : list[0];
}

function notifyGroupMembers(req, group, actorId, title, body, url = `/group/${group._id}`, messageId = null) {
  const recipients = group.members.filter((m) => userId(m.user) !== String(actorId) && !m.muted).map((m) => userId(m.user));
  if (!recipients.length) return;
  const now = new Date();
  void Notification.insertMany(recipients.map((id) => ({ user: id, from: actorId, group: group._id, type: 'group_message', body: `${title}: ${body}`.slice(0, 200), read: false, count: 1, createdAt: now, updatedAt: now }))).catch(() => {});
  const io = req.app.get('io');
  for (const id of recipients) {
    emitToUser(io, id, 'notification', { _id: `group-${group._id}-${now.getTime()}-${id}`, user: id, from: { _id: actorId }, group: { _id: group._id, name: group.name }, type: 'group_message', body: `${title}: ${body}`, read: false, count: 1, createdAt: now, updatedAt: now });
    void sendPush(id, { kind: 'message', title, body, url, tag: `group-${group._id}`, groupId: String(group._id), unread: 1, ...(messageId ? { messageId: String(messageId) } : {}) }).catch(() => {});
  }
}

async function deleteGroupFiles(groupId) {
  const messages = await GroupMessage.find({ group: groupId, 'attachment.fileId': { $exists: true } }).select('attachment.fileId').lean();
  await Promise.all(messages.map((message) => fs.promises.unlink(path.join(groupMediaDir, path.basename(message.attachment.fileId))).catch(() => {})));
}

function addSocketsToGroup(req, group, ids = group.members.map((m) => userId(m.user))) {
  const io = req.app.get('io');
  for (const id of ids) io?.in(userRoom(id)).socketsJoin(room(group._id));
}
function removeSocketsFromGroup(req, group, ids) {
  const io = req.app.get('io');
  for (const id of ids) io?.in(userRoom(id)).socketsLeave(room(group._id));
}

exports.list = asyncHandler(async (req, res) => {
  ensureEnabled();
  const groups = await Group.find({ 'members.user': req.user._id }).sort({ updatedAt: -1 }).limit(200)
    .populate('members.user', 'name username avatar isOnline lastSeen')
    .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'name avatar' } }).lean();
  const ids = groups.map((group) => group._id);
  const since = cutoff();
  const unreadRows = ids.length ? await GroupMessage.aggregate([
    { $match: { group: { $in: ids }, sender: { $ne: new mongoose.Types.ObjectId(req.user._id) }, readBy: { $ne: new mongoose.Types.ObjectId(req.user._id) }, deletedForEveryone: false, createdAt: { $gte: since } } },
    { $group: { _id: '$group', count: { $sum: 1 } } },
  ]) : [];
  const unread = new Map(unreadRows.map((row) => [String(row._id), row.count]));
  res.json({ groups: groups.map((group) => ({ ...group, unreadCount: unread.get(String(group._id)) || 0 })), maxMembers: runtimeConfig.getRuntimeConfig().maxGroupMembers, maxFileSizeMb: runtimeConfig.getRuntimeConfig().maxGroupFileSizeMb });
});

exports.create = asyncHandler(async (req, res) => {
  ensureEnabled();
  const name = cleanLabel(req.body.name, 80);
  const description = cleanText(req.body.description, 500);
  const rawIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
  const maxMembers = runtimeConfig.getRuntimeConfig().maxGroupMembers || 256;
  if (name.length < 2) throw new ApiError(400, 'Group name must be at least 2 characters');
  if (rawIds.length + 1 > maxMembers) throw new ApiError(400, `A group can have at most ${maxMembers} members`);
  if (rawIds.some((id) => !mongoose.isValidObjectId(id))) throw new ApiError(400, 'One or more selected members are invalid');
  const ids = [...new Set(rawIds.map(String))].filter((id) => id !== String(req.user._id));
  if (!ids.length) throw new ApiError(400, 'Select at least one other member');
  const contacts = new Set(req.user.contacts.map(String));
  if (ids.some((id) => !contacts.has(id))) throw new ApiError(403, 'Groups can only be created with your contacts');
  const users = await User.find({ _id: { $in: ids }, accountStatus: 'active' }).select('_id');
  if (users.length !== ids.length) throw new ApiError(400, 'One or more selected members are unavailable');
  const group = await Group.create({
    name, description, owner: req.user._id,
    members: [{ user: req.user._id, role: 'owner' }, ...users.map((user) => ({ user: user._id, role: 'member' }))],
  });
  await logActivity(group, req.user._id, 'group_created');
  addSocketsToGroup(req, group);
  notifyGroupMembers(req, group, req.user._id, 'Added to group', group.name);
  const result = await Group.findById(group._id).populate('members.user', 'name username avatar isOnline lastSeen').lean();
  res.status(201).json({ group: result });
});

exports.details = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  const [activity, requests] = await Promise.all([
    GroupActivity.find({ group: group._id }).sort({ createdAt: -1 }).limit(30).populate('actor target', 'name avatar').lean(),
    canAdmin(memberFor(group, req.user._id)) ? GroupJoinRequest.find({ group: group._id, status: 'pending' }).sort({ createdAt: -1 }).limit(100).populate('user', 'name username avatar').lean() : [],
  ]);
  const data = await Group.findById(group._id).populate('members.user', 'name username avatar isOnline lastSeen').lean();
  res.json({ group: data, activity, joinRequests: requests });
});

exports.update = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  const actor = memberFor(group, req.user._id);
  if (!canAdmin(actor) && group.onlyAdminsCanEditInfo) throw new ApiError(403, 'Only group admins can change group information');
  const changed = {};
  if (req.body.name !== undefined) {
    const name = cleanLabel(req.body.name, 80);
    if (name.length < 2) throw new ApiError(400, 'Group name must be at least 2 characters');
    group.name = name; changed.name = name;
  }
  if (req.body.description !== undefined) { group.description = cleanText(req.body.description, 500); changed.description = true; }
  if (req.body.onlyAdminsCanEditInfo !== undefined || req.body.approvalRequired !== undefined) {
    if (!canAdmin(actor)) throw new ApiError(403, 'Only admins can change group settings');
    for (const key of ['onlyAdminsCanEditInfo', 'approvalRequired']) if (req.body[key] !== undefined) {
      if (typeof req.body[key] !== 'boolean') throw new ApiError(400, `${key} must be true or false`);
      group[key] = req.body[key]; changed[key] = req.body[key];
    }
  }
  await group.save();
  await logActivity(group, req.user._id, 'group_updated', null, changed);
  req.app.get('io')?.to(room(group._id)).emit('group_updated', { groupId: String(group._id), fields: changed });
  res.json({ group: await Group.findById(group._id).populate('members.user', 'name username avatar isOnline lastSeen').lean() });
});

exports.uploadAvatar = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  if (!req.file) throw new ApiError(400, 'Choose a group image first');
  const actor = memberFor(group, req.user._id);
  if (!canAdmin(actor) && group.onlyAdminsCanEditInfo) { fs.unlink(req.file.path, () => {}); throw new ApiError(403, 'Only group admins can change the group picture'); }
  const { hasImageSignature } = require('../middleware/upload');
  if (!hasImageSignature(req.file.path)) { fs.unlink(req.file.path, () => {}); throw new ApiError(415, 'File content is not a valid image'); }
  const old = group.avatar;
  group.avatar = `/uploads/avatars/${req.file.filename}`;
  await group.save();
  if (old?.startsWith('/uploads/avatars/')) fs.unlink(path.join(avatarDir, path.basename(old)), () => {});
  await logActivity(group, req.user._id, 'group_avatar_updated');
  req.app.get('io')?.to(room(group._id)).emit('group_updated', { groupId: String(group._id), fields: { avatar: group.avatar } });
  res.json({ avatar: group.avatar });
});

exports.addMembers = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  if (!canAdmin(memberFor(group, req.user._id))) throw new ApiError(403, 'Only group admins can add members');
  const rawIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
  if (!rawIds.length || rawIds.length > 100 || rawIds.some((id) => !mongoose.isValidObjectId(id))) throw new ApiError(400, 'Select valid members to add');
  const ids = [...new Set(rawIds.map(String))].filter((id) => !group.members.some((m) => userId(m.user) === id));
  const maxMembers = runtimeConfig.getRuntimeConfig().maxGroupMembers || 256;
  if (group.members.length + ids.length > maxMembers) throw new ApiError(400, `A group can have at most ${maxMembers} members`);
  const contacts = new Set(req.user.contacts.map(String));
  if (ids.some((id) => !contacts.has(id))) throw new ApiError(403, 'You can only add people from your contacts');
  const users = await User.find({ _id: { $in: ids }, accountStatus: 'active' }).select('_id name avatar username isOnline lastSeen');
  if (users.length !== ids.length) throw new ApiError(400, 'One or more selected members are unavailable');
  group.members.push(...users.map((user) => ({ user: user._id, role: 'member' })));
  await group.save();
  await Promise.all(users.map((user) => logActivity(group, req.user._id, 'member_added', user._id)));
  addSocketsToGroup(req, group, users.map((u) => String(u._id)));
  notifyGroupMembers(req, group, req.user._id, 'Added to group', group.name);
  req.app.get('io')?.to(room(group._id)).emit('group_updated', { groupId: String(group._id), fields: { members: true } });
  res.json({ group: await Group.findById(group._id).populate('members.user', 'name username avatar isOnline lastSeen').lean() });
});

exports.removeMember = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  const actor = memberFor(group, req.user._id);
  const target = memberFor(group, req.params.userId);
  if (!target) throw new ApiError(404, 'Member not found');
  if (userId(target.user) === String(req.user._id)) return res.status(400).json({ message: 'Use leave group to remove yourself' });
  if (!canAdmin(actor)) throw new ApiError(403, 'Only group admins can remove members');
  if (target.role === 'owner' || (target.role === 'admin' && actor.role !== 'owner')) throw new ApiError(403, 'You cannot remove this administrator');
  group.members = group.members.filter((member) => userId(member.user) !== String(req.params.userId));
  await group.save();
  await logActivity(group, req.user._id, 'member_removed', req.params.userId);
  removeSocketsFromGroup(req, group, [String(req.params.userId)]);
  emitToUser(req.app.get('io'), req.params.userId, 'group_removed', { groupId: String(group._id) });
  req.app.get('io')?.to(room(group._id)).emit('group_updated', { groupId: String(group._id), fields: { members: true } });
  res.json({ group: await Group.findById(group._id).populate('members.user', 'name username avatar isOnline lastSeen').lean() });
});

exports.setMemberRole = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  const actor = memberFor(group, req.user._id);
  const target = memberFor(group, req.params.userId);
  const role = req.body.role;
  if (!target) throw new ApiError(404, 'Member not found');
  if (!canAdmin(actor)) throw new ApiError(403, 'Only admins can manage member roles');
  if (!['admin', 'member'].includes(role) || target.role === 'owner' || userId(target.user) === String(req.user._id)) throw new ApiError(400, 'That role change is not allowed');
  if (target.role === 'admin' && actor.role !== 'owner') throw new ApiError(403, 'Only the group owner can remove another admin');
  target.role = role;
  await group.save();
  await logActivity(group, req.user._id, role === 'admin' ? 'member_promoted' : 'admin_demoted', target.user);
  req.app.get('io')?.to(room(group._id)).emit('group_updated', { groupId: String(group._id), fields: { members: true } });
  res.json({ group: await Group.findById(group._id).populate('members.user', 'name username avatar isOnline lastSeen').lean() });
});

exports.leave = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  const leaving = memberFor(group, req.user._id);
  const oldOwner = group.owner;
  group.members = group.members.filter((member) => userId(member.user) !== String(req.user._id));
  if (!group.members.length) {
    await deleteGroupFiles(group._id);
    await Promise.all([GroupMessage.deleteMany({ group: group._id }), GroupActivity.deleteMany({ group: group._id }), GroupJoinRequest.deleteMany({ group: group._id }), GroupReport.deleteMany({ group: group._id }), Group.deleteOne({ _id: group._id })]);
  } else if (String(oldOwner) === String(req.user._id)) {
    const successor = group.members.find((member) => member.role === 'admin') || group.members[0];
    successor.role = 'owner'; group.owner = successor.user;
    await group.save();
  } else await group.save();
  if (group.members.length) await logActivity(group, req.user._id, 'member_left', null, { role: leaving.role });
  removeSocketsFromGroup(req, group, [String(req.user._id)]);
  req.app.get('io')?.to(room(group._id)).emit('group_updated', { groupId: String(group._id), fields: { members: true, owner: String(group.owner) } });
  res.json({ left: true });
});

exports.mute = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  if (typeof req.body.muted !== 'boolean') throw new ApiError(400, 'Muted must be true or false');
  memberFor(group, req.user._id).muted = req.body.muted;
  await group.save();
  res.json({ muted: req.body.muted });
});

exports.createInvite = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  if (!canAdmin(memberFor(group, req.user._id))) throw new ApiError(403, 'Only admins can create invitation links');
  group.inviteCode = crypto.randomBytes(24).toString('base64url');
  await group.save();
  await logActivity(group, req.user._id, 'invite_link_created');
  const configured = env.clientUrls.map((value) => { try { return new URL(value).origin; } catch { return ''; } }).filter(Boolean);
  let origin = configured[0] || '';
  try {
    const requested = new URL(req.body.origin || req.get('origin')).origin;
    if (configured.includes(requested)) origin = requested;
  } catch { /* use the configured app origin */ }
  res.json({ inviteCode: group.inviteCode, inviteUrl: `${origin}/?joinGroup=${group.inviteCode}` });
});

exports.joinInvite = asyncHandler(async (req, res) => {
  ensureEnabled();
  const code = String(req.params.code || '').slice(0, 100);
  const group = await Group.findOne({ inviteCode: code }).select('+inviteCode');
  if (!group) throw new ApiError(404, 'This invitation link is invalid or expired');
  if (memberFor(group, req.user._id)) return res.json({ joined: true, groupId: String(group._id) });
  const maxMembers = runtimeConfig.getRuntimeConfig().maxGroupMembers || 256;
  if (group.members.length >= maxMembers) throw new ApiError(400, 'This group has reached its member limit');
  if (group.approvalRequired) {
    await GroupJoinRequest.findOneAndUpdate({ group: group._id, user: req.user._id, status: 'pending' }, { $setOnInsert: { group: group._id, user: req.user._id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    req.app.get('io')?.to(room(group._id)).emit('group_join_request', { groupId: String(group._id) });
    return res.json({ requested: true, groupId: String(group._id) });
  }
  group.members.push({ user: req.user._id, role: 'member' });
  await group.save();
  await logActivity(group, req.user._id, 'member_joined');
  addSocketsToGroup(req, group, [String(req.user._id)]);
  req.app.get('io')?.to(room(group._id)).emit('group_updated', { groupId: String(group._id), fields: { members: true } });
  res.json({ joined: true, groupId: String(group._id) });
});

exports.reviewJoinRequest = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  if (!canAdmin(memberFor(group, req.user._id))) throw new ApiError(403, 'Only admins can review join requests');
  const approve = req.body.approve === true;
  const request = await GroupJoinRequest.findOne({ _id: req.params.requestId, group: group._id, status: 'pending' });
  if (!request) throw new ApiError(404, 'Pending join request not found');
  if (approve && !memberFor(group, request.user)) {
    if (group.members.length >= (runtimeConfig.getRuntimeConfig().maxGroupMembers || 256)) throw new ApiError(400, 'This group has reached its member limit');
    group.members.push({ user: request.user, role: 'member' }); await group.save();
    addSocketsToGroup(req, group, [String(request.user)]);
  }
  request.status = approve ? 'approved' : 'rejected'; request.reviewedBy = req.user._id; request.reviewedAt = new Date(); await request.save();
  await logActivity(group, req.user._id, approve ? 'join_request_approved' : 'join_request_rejected', request.user);
  emitToUser(req.app.get('io'), request.user, 'group_join_result', { groupId: String(group._id), approved: approve });
  req.app.get('io')?.to(room(group._id)).emit('group_updated', { groupId: String(group._id), fields: { members: true } });
  res.json({ request });
});

exports.messages = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const filter = { group: group._id, createdAt: { $gte: cutoff() } };
  if (req.query.before) filter.createdAt.$lt = new Date(req.query.before);
  let rows = await GroupMessage.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean();
  await populateReplies(rows);
  const hasMore = rows.length > limit;
  res.json({ messages: rows.slice(0, limit).reverse(), hasMore, maxMessageLength: runtimeConfig.getRuntimeConfig().maxMessageLength, maxFileSizeMb: runtimeConfig.getRuntimeConfig().maxGroupFileSizeMb });
});

exports.uploadMessage = asyncHandler(async (req, res) => {
  ensureEnabled();
  const config = runtimeConfig.getRuntimeConfig();
  if (config.features.chat === false) throw new ApiError(503, 'Chat and messaging are temporarily disabled');
  if (config.features.fileSharing === false) throw new ApiError(503, 'Group media sharing is temporarily disabled');
  const group = await getMemberGroup(req.params.groupId, req.user);
  if (!req.file) throw new ApiError(400, 'Choose a file to send');
  const removeUpload = () => fs.unlink(req.file.path, () => {});
  const maxBytes = (config.maxGroupFileSizeMb || 25) * 1024 * 1024;
  if (req.file.size > maxBytes) { removeUpload(); throw new ApiError(413, `Files can be up to ${config.maxGroupFileSizeMb || 25} MB`); }
  const mimeType = req.file.pulseMime || String(req.file.mimetype).split(';')[0].toLowerCase();
  const text = cleanText(req.body.text, config.maxMessageLength || 4000);
  if (req.body.replyToMessageId && !mongoose.isValidObjectId(req.body.replyToMessageId)) { removeUpload(); throw new ApiError(400, 'Invalid message being replied to'); }
  let replyTo = null;
  if (req.body.replyToMessageId) {
    const original = await GroupMessage.findOne({ _id: req.body.replyToMessageId, group: group._id, deletedForEveryone: false, createdAt: { $gte: cutoff() } }).select('_id');
    if (!original) { removeUpload(); throw new ApiError(400, 'Original message is unavailable'); }
    replyTo = original._id;
  }
  const { hasImageSignature } = require('../middleware/upload');
  if (mimeType.startsWith('image/') && !hasImageSignature(req.file.path)) { removeUpload(); throw new ApiError(415, 'File content is not a valid image'); }
  const fileId = path.basename(req.file.filename);
  const attachment = {
    fileId,
    name: cleanLabel(path.basename(req.file.originalname || 'file'), 200) || 'file',
    mimeType,
    size: req.file.size,
    type: typeForMime(mimeType),
  };
  let message;
  try { message = await GroupMessage.create({ group: group._id, sender: req.user._id, text, reply_to_message_id: replyTo, attachment, forwarded: req.body.forwarded === 'true' }); }
  catch (error) { removeUpload(); throw error; }
  await Group.updateOne({ _id: group._id }, { lastMessage: message._id, updatedAt: message.createdAt });
  const payload = await populateReplies(await GroupMessage.findById(message._id).lean());
  const io = req.app.get('io');
  for (const member of group.members) emitToUser(io, member.user, 'group_receive_message', payload);
  notifyGroupMembers(req, group, req.user._id, 'New group message', text || attachment.type, `/group/${group._id}`, message._id);
  res.status(201).json({ message: payload });
});

exports.downloadFile = asyncHandler(async (req, res, next) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  const fileId = String(req.params.fileId || '');
  if (!/^[a-f0-9]{48}$/i.test(fileId)) throw new ApiError(404, 'File not found');
  const message = await GroupMessage.findOne({ group: group._id, 'attachment.fileId': fileId, deletedForEveryone: false, createdAt: { $gte: cutoff() } }).select('attachment').lean();
  if (!message?.attachment) throw new ApiError(404, 'File not found');
  const filePath = path.join(groupMediaDir, fileId);
  const inline = ['image', 'video', 'audio'].includes(message.attachment.type);
  const safeName = message.attachment.name.replace(/["\\\r\n]/g, '_');
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, '_');
  let encodedName;
  try { encodedName = encodeURIComponent(safeName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`); }
  catch { encodedName = encodeURIComponent(asciiName); }
  res.set({
    'Content-Type': message.attachment.mimeType,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(filePath, (error) => { if (error && !res.headersSent) next(error); });
});

exports.getMessage = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  let message = await GroupMessage.findOne({ _id: req.params.messageId, group: group._id, createdAt: { $gte: cutoff() } }).lean();
  if (!message) throw new ApiError(404, 'Message not found');
  message = await populateReplies(message);
  res.json({ message });
});

exports.markRead = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  const ids = await GroupMessage.find({ group: group._id, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id }, createdAt: { $gte: cutoff() } }).select('_id').lean();
  if (ids.length) {
    await GroupMessage.updateMany({ _id: { $in: ids.map((m) => m._id) } }, { $addToSet: { readBy: req.user._id, deliveredBy: req.user._id } });
    req.app.get('io')?.to(room(group._id)).emit('group_receipts_updated', { groupId: String(group._id), messageIds: ids.map((m) => String(m._id)), userId: String(req.user._id), read: true });
  }
  const member = memberFor(group, req.user._id); member.lastReadAt = new Date(); await group.save();
  await Notification.updateMany({ user: req.user._id, group: group._id, type: 'group_message', read: false }, { read: true });
  res.json({ read: ids.length });
});

exports.toggleReaction = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  const emoji = String(req.body.emoji || '');
  if (!emoji || [...emoji].length > 8) throw new ApiError(400, 'Choose a valid emoji reaction');
  const message = await GroupMessage.findOne({ _id: req.params.messageId, group: group._id, deletedForEveryone: false });
  if (!message) throw new ApiError(404, 'Message not found');
  const existing = message.reactions.find((r) => userId(r.user) === String(req.user._id));
  if (existing?.emoji === emoji) message.reactions = message.reactions.filter((r) => userId(r.user) !== String(req.user._id));
  else if (existing) existing.emoji = emoji;
  else message.reactions.push({ user: req.user._id, emoji });
  await message.save();
  const payload = await populateReplies(await GroupMessage.findById(message._id).lean());
  req.app.get('io')?.to(room(group._id)).emit('group_message_updated', payload);
  res.json({ message: payload });
});

exports.editMessage = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  const message = await GroupMessage.findOne({ _id: req.params.messageId, group: group._id });
  if (!message) throw new ApiError(404, 'Message not found');
  if (String(message.sender) !== String(req.user._id)) throw new ApiError(403, 'You can only edit your own messages');
  if (message.deletedForEveryone) throw new ApiError(400, 'Deleted messages cannot be edited');
  const text = cleanText(req.body.text, runtimeConfig.getRuntimeConfig().maxMessageLength || 4000);
  if (!text) throw new ApiError(400, 'Message cannot be empty');
  message.text = text; message.editedAt = new Date(); await message.save();
  const payload = await populateReplies(await GroupMessage.findById(message._id).lean());
  req.app.get('io')?.to(room(group._id)).emit('group_message_updated', payload);
  res.json({ message: payload });
});

exports.deleteMessage = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  const message = await GroupMessage.findOne({ _id: req.params.messageId, group: group._id });
  if (!message) throw new ApiError(404, 'Message not found');
  if (String(message.sender) !== String(req.user._id) && !canAdmin(memberFor(group, req.user._id))) throw new ApiError(403, 'Only the sender or an admin can delete this message');
  const fileId = message.attachment?.fileId;
  message.deletedForEveryone = true; message.text = ''; message.attachment = null; message.reactions = []; await message.save();
  if (fileId) await fs.promises.unlink(path.join(groupMediaDir, path.basename(fileId))).catch(() => {});
  const payload = await populateReplies(await GroupMessage.findById(message._id).lean());
  req.app.get('io')?.to(room(group._id)).emit('group_message_updated', payload);
  res.json({ deleted: true });
});

exports.report = asyncHandler(async (req, res) => {
  ensureEnabled();
  const group = await getMemberGroup(req.params.groupId, req.user);
  const reason = cleanText(req.body.reason, 500);
  if (reason.length < 3) throw new ApiError(400, 'Please provide a short report reason');
  const messageId = req.body.messageId || null;
  if (messageId && !await GroupMessage.exists({ _id: messageId, group: group._id })) throw new ApiError(404, 'Message not found');
  const report = await GroupReport.create({ group: group._id, reporter: req.user._id, message: messageId, reason });
  await logActivity(group, req.user._id, 'report_submitted', null, { reportId: String(report._id) });
  res.status(201).json({ reportId: report._id });
});

exports.listAdminReports = asyncHandler(async (req, res) => {
  const reports = await GroupReport.find(req.query.status === 'all' ? {} : { status: req.query.status || 'open' }).sort({ createdAt: -1 }).limit(200).populate('group', 'name avatar').populate('reporter', 'name email').populate('message', 'text sender createdAt').lean();
  res.json({ reports });
});

exports.reviewAdminReport = asyncHandler(async (req, res) => {
  if (!['reviewed', 'dismissed'].includes(req.body.status)) throw new ApiError(400, 'Choose reviewed or dismissed');
  const report = await GroupReport.findByIdAndUpdate(req.params.reportId, { status: req.body.status, reviewedBy: req.user._id, reviewedAt: new Date() }, { new: true });
  if (!report) throw new ApiError(404, 'Report not found');
  res.json({ report });
});

exports.activity = asyncHandler(async (req, res) => {
  const group = await getMemberGroup(req.params.groupId, req.user);
  const items = await GroupActivity.find({ group: group._id }).sort({ createdAt: -1 }).limit(100).populate('actor target', 'name avatar').lean();
  res.json({ activity: items });
});

void notifyGroupMembers;
