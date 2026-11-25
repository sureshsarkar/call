const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Group = require('../models/Group');
const User = require('../models/User');
const { onlineUsers } = require('./state');
const activeCallsByUser = require('./activeCalls');
const { getRuntimeConfig } = require('../services/runtimeConfig');
const { sendPush } = require('../services/push');

const calls = new Map();
const callsByGroup = new Map();
const MAX_PARTICIPANTS = 8; // mesh calls send one stream to every other participant
const INVITE_TIMEOUT_MS = 45_000;
const room = (callId) => `group-call:${callId}`;
const userRoom = (userId) => `user:${userId}`;
const isId = (value) => mongoose.isValidObjectId(value);
const userId = (value) => String(value?._id || value);
const publicUser = (user) => ({ _id: String(user._id), name: user.name, avatar: user.avatar || null });

function publicParticipants(call) {
  return [...call.participants.values()].map((participant) => participant.user);
}

function releaseUser(call, id) {
  if (activeCallsByUser.get(String(id)) === call.id) activeCallsByUser.delete(String(id));
  call.participants.delete(String(id));
}

function endCall(io, call, reason = 'ended') {
  if (!calls.has(call.id)) return;
  calls.delete(call.id);
  if (callsByGroup.get(call.groupId) === call.id) callsByGroup.delete(call.groupId);
  clearTimeout(call.ringTimer);
  for (const id of call.participants.keys()) releaseUser(call, id);
  io.to(room(call.id)).emit('group_call_ended', { callId: call.id, reason });
}

function participantPayload(call, participant) {
  return { callId: call.id, groupId: call.groupId, type: call.type, participant: participant.user };
}

module.exports = function registerGroupCall(io, socket) {
  const me = String(socket.userId);
  let lastStartedAt = 0;

  socket.on('group_call_start', async (data = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const { groupId, type } = data;
      const features = getRuntimeConfig().features;
      if (features.groupChat === false) return reply({ ok: false, error: 'Group chat is temporarily disabled' });
      if (features[`${type}Calls`] === false || !['audio', 'video'].includes(type)) return reply({ ok: false, error: 'This call type is unavailable' });
      if (Date.now() - lastStartedAt < 5000) return reply({ ok: false, error: 'Please wait before starting another call' });
      if (!isId(groupId)) return reply({ ok: false, error: 'Invalid group' });
      if (activeCallsByUser.has(me)) return reply({ ok: false, error: 'You are already in a call' });
      const [group, caller] = await Promise.all([
        Group.findOne({ _id: groupId, 'members.user': me }).select('name members.user').lean(),
        User.findById(me).select('name avatar').lean(),
      ]);
      if (!group || !caller) return reply({ ok: false, error: 'Group not found' });
      if (callsByGroup.has(String(group._id))) return reply({ ok: false, error: 'This group already has an active call' });
      const id = crypto.randomBytes(16).toString('hex');
      const self = { userId: me, socketId: socket.id, user: publicUser({ ...caller, _id: me }) };
      const call = { id, groupId: String(group._id), groupName: group.name, type, initiator: me, participants: new Map([[me, self]]), ringTimer: null };
      calls.set(id, call);
      callsByGroup.set(call.groupId, id);
      activeCallsByUser.set(me, id);
      lastStartedAt = Date.now();
      socket.join(room(id));
      const invitation = { callId: id, groupId: call.groupId, groupName: call.groupName, type, from: self.user };
      for (const member of group.members) {
        const recipientId = userId(member.user);
        if (recipientId !== me) {
          if (onlineUsers.has(recipientId)) io.to(userRoom(recipientId)).emit('group_call_invite', invitation);
          void sendPush(recipientId, { kind: 'call', title: `${group.name} · group ${type} call`, body: `${caller.name} is calling the group`, url: `/group/${group._id}?incomingGroupCall=${id}`, tag: `group-call-${id}`, callId: id, groupId: String(group._id), type, from: self.user }).catch((error) => console.error('[push] group call', error.message));
        }
      }
      call.ringTimer = setTimeout(() => {
        if (call.participants.size < 2) endCall(io, call, 'no_answer');
      }, INVITE_TIMEOUT_MS);
      call.ringTimer.unref?.();
      reply({ ok: true, callId: id, groupId: call.groupId, groupName: call.groupName, type, participants: publicParticipants(call), maxParticipants: MAX_PARTICIPANTS });
    } catch (error) {
      console.error('[group call] start', error.message);
      reply({ ok: false, error: 'Could not start the group call' });
    }
  });

  socket.on('group_call_join', async ({ callId } = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const call = calls.get(String(callId));
    if (!call) return reply({ ok: false, error: 'This group call has ended' });
    const features = getRuntimeConfig().features;
    if (features.groupChat === false || features[`${call.type}Calls`] === false) return reply({ ok: false, error: 'This group call is disabled' });
    if (call.participants.has(me)) return reply({ ok: false, error: 'You already joined this call' });
    if (activeCallsByUser.has(me)) return reply({ ok: false, error: 'You are already in a call' });
    if (call.participants.size >= MAX_PARTICIPANTS) return reply({ ok: false, error: `Group calls support up to ${MAX_PARTICIPANTS} participants` });
    try {
      const [member, user] = await Promise.all([
        Group.exists({ _id: call.groupId, 'members.user': me }),
        User.findById(me).select('name avatar').lean(),
      ]);
      if (!member || !user) return reply({ ok: false, error: 'You are not a member of this group' });
      const participant = { userId: me, socketId: socket.id, user: publicUser({ ...user, _id: me }) };
      const existing = publicParticipants(call);
      call.participants.set(me, participant);
      activeCallsByUser.set(me, call.id);
      socket.join(room(call.id));
      clearTimeout(call.ringTimer);
      socket.to(room(call.id)).emit('group_call_peer_joined', participantPayload(call, participant));
      reply({ ok: true, callId: call.id, groupId: call.groupId, groupName: call.groupName, type: call.type, participants: existing, maxParticipants: MAX_PARTICIPANTS });
    } catch (error) {
      console.error('[group call] join', error.message);
      reply({ ok: false, error: 'Could not join this group call' });
    }
  });

  socket.on('group_call_decline', ({ callId } = {}) => {
    const call = calls.get(String(callId));
    if (!call || call.participants.has(me)) return;
    io.to(room(call.id)).emit('group_call_declined', { callId: call.id, userId: me });
  });

  socket.on('group_call_signal', async ({ callId, to, signal } = {}) => {
    const call = calls.get(String(callId));
    const sender = call?.participants.get(me);
    const target = call?.participants.get(String(to));
    if (!call || !sender || !target || !signal || !['offer', 'answer', 'candidate'].includes(signal.type)) return;
    if (!await Group.exists({ _id: call.groupId, 'members.user': me })) {
      socket.emit('group_call_ended', { callId: call.id, reason: 'membership_changed' });
      return;
    }
    io.to(target.socketId).emit('group_call_signal', { callId: call.id, from: me, signal });
  });

  socket.on('group_call_leave', ({ callId } = {}) => {
    const call = calls.get(String(callId));
    if (!call?.participants.has(me)) return;
    const participant = call.participants.get(me);
    releaseUser(call, me);
    io.to(room(call.id)).emit('group_call_peer_left', { callId: call.id, userId: me });
    io.sockets.sockets.get(participant.socketId)?.leave(room(call.id));
    if (!call.participants.size) endCall(io, call);
  });

  socket.on('disconnect', () => {
    for (const call of calls.values()) {
      const participant = call.participants.get(me);
      if (!participant || participant.socketId !== socket.id) continue;
      releaseUser(call, me);
      io.to(room(call.id)).emit('group_call_peer_left', { callId: call.id, userId: me, reason: 'disconnected' });
      if (!call.participants.size) endCall(io, call);
    }
  });

  void Group.find({ 'members.user': me }).select('_id').lean().then((groups) => {
    const ids = new Set(groups.map((group) => String(group._id)));
    for (const call of calls.values()) {
      if (ids.has(call.groupId) && !call.participants.has(me)) {
        io.to(userRoom(me)).emit('group_call_invite', { callId: call.id, groupId: call.groupId, groupName: call.groupName, type: call.type, from: call.participants.get(call.initiator)?.user });
      }
    }
  }).catch((error) => console.error('[group call] replay invites', error.message));
};
