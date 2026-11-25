const mongoose = require('mongoose');
const User = require('../models/User');
const CallHistory = require('../models/CallHistory');
const Notification = require('../models/Notification');
const { emitToUser, isOnline, onlineUsers } = require('./state');
const { sendPush } = require('../services/push');
const { getRuntimeConfig } = require('../services/runtimeConfig');

const RING_TIMEOUT_MS = 45_000;
const GRACE_MS = 60_000; // a dropped socket / network switch may take a while on slow links: keep the call alive
const MAX_QUEUED = 80;

const calls = new Map(); // callId -> call
const userCalls = new Map(); // userId -> callId
const isId = (v) => mongoose.isValidObjectId(v);

const otherParty = (call, me) => (String(call.caller) === String(me) ? call.callee : call.caller);
const involved = (call, me) => call && [String(call.caller), String(call.callee)].includes(String(me));

async function finalize(io, call, status, reason, { notify = true } = {}) {
  if (!calls.has(call.id)) return; // already finalized
  calls.delete(call.id);
  userCalls.delete(String(call.caller));
  userCalls.delete(String(call.callee));
  clearTimeout(call.ringTimer);
  clearTimeout(call.maxDurationTimer);
  Object.values(call.graceTimers).forEach(clearTimeout);

  const endedAt = new Date();
  const duration = call.answeredAt ? Math.round((endedAt - call.answeredAt) / 1000) : 0;
  try {
    await CallHistory.updateOne({ _id: call.historyId }, { status, endedAt, duration });
    if (notify && (status === 'missed' || status === 'cancelled')) {
      const n = await Notification.create({
        user: call.callee, from: call.caller, type: 'missed_call', callType: call.type,
        body: `Missed ${call.type} call`,
      });
      const populated = await n.populate('from', 'name avatar');
      emitToUser(io, call.callee, 'notification', populated);
    }
  } catch (err) {
    console.error('[call] finalize', err.message);
  }
  return { endedAt, duration };
}

function endAndNotify(io, call, status, reason, { notifyUser } = {}) {
  finalize(io, call, status, reason);
  const payload = { callId: call.id, reason };
  if (notifyUser === undefined) {
    emitToUser(io, call.caller, 'end_call', payload);
    emitToUser(io, call.callee, 'end_call', payload);
  } else {
    emitToUser(io, notifyUser, 'end_call', payload);
  }
}

module.exports = function registerCall(io, socket) {
  const me = String(socket.userId);

  // ---- caller starts a call
  socket.on('incoming_call', async (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const { to, type } = data || {};
      if (!isId(to) || !['audio', 'video'].includes(type)) return reply({ ok: false, error: 'Invalid call request' });
      const flags = getRuntimeConfig().features;
      if (flags[`${type}Calls`] === false) return reply({ ok: false, error: `${type === 'audio' ? 'Audio' : 'Video'} calls are temporarily disabled` });
      if (String(to) === me) return reply({ ok: false, error: 'You cannot call yourself' });
      if (userCalls.has(me)) return reply({ ok: false, error: 'You are already in a call' });

      const [caller, callee] = await Promise.all([
        User.findById(me).select('name avatar'),
        User.findById(to).select('name avatar'),
      ]);
      if (!callee) return reply({ ok: false, error: 'User not found' });

      const base = { caller: me, callee: to, type };
      if (userCalls.has(String(to))) {
        await CallHistory.create({ ...base, status: 'busy', endedAt: new Date() });
        return reply({ ok: false, busy: true, error: `${callee.name} is on another call` });
      }
      if (!isOnline(to)) {
        await CallHistory.create({ ...base, status: 'missed', endedAt: new Date() });
        const n = await Notification.create({ user: to, from: me, type: 'missed_call', callType: type, body: `Missed ${type} call` });
        void n;
        return reply({ ok: false, offline: true, error: `${callee.name} is offline` });
      }

      const history = await CallHistory.create({ ...base, status: 'ringing' });
      const call = {
        id: String(history._id), caller: me, callee: String(to), type, state: 'ringing',
        historyId: history._id, answeredAt: null, ringTimer: null, maxDurationTimer: null, graceTimers: {}, pending: {},
      };
      calls.set(call.id, call);
      userCalls.set(me, call.id);
      userCalls.set(String(to), call.id);

      call.ringTimer = setTimeout(() => {
        if (call.state === 'ringing') endAndNotify(io, call, 'missed', 'no_answer');
      }, RING_TIMEOUT_MS);

      emitToUser(io, to, 'incoming_call', { callId: call.id, type, from: caller.toPublic() });
      void sendPush(to, { kind: 'call', title: `Incoming ${type} call`, body: `${caller.name} is calling`, url: `/?incomingCall=${call.id}`, tag: `call-${call.id}`, callId: call.id, type, from: caller.toPublic() }).catch((err) => console.error('[push] call', err.message));
      reply({ ok: true, callId: call.id, callee: callee.toPublic() });
    } catch (err) {
      console.error('[call] incoming_call', err);
      reply({ ok: false, error: 'Could not start the call' });
    }
  });

  // ---- callee accepts
  socket.on('accept_call', async ({ callId } = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const call = calls.get(callId);
    if (!call || String(call.callee) !== me || call.state !== 'ringing') return reply({ ok: false, error: 'Call is no longer available' });
    clearTimeout(call.ringTimer);
    call.state = 'active';
    call.answeredAt = new Date();
    await CallHistory.updateOne({ _id: call.historyId }, { status: 'answered', answeredAt: call.answeredAt }).catch(() => {});
    const durationLimit = getRuntimeConfig().callDurationLimitMinutes;
    if (durationLimit > 0) call.maxDurationTimer = setTimeout(() => endAndNotify(io, call, 'completed', 'time_limit'), durationLimit * 60_000);
    socket.to(`user:${me}`).emit('call_handled', { callId }); // dismiss ringing on my other tabs
    emitToUser(io, call.caller, 'accept_call', { callId });
    reply({ ok: true });
  });

  socket.on('reject_call', ({ callId } = {}) => {
    const call = calls.get(callId);
    if (!call || String(call.callee) !== me || call.state !== 'ringing') return;
    socket.to(`user:${me}`).emit('call_handled', { callId });
    finalize(io, call, 'rejected', 'rejected');
    emitToUser(io, call.caller, 'reject_call', { callId });
  });

  socket.on('end_call', ({ callId } = {}) => {
    const call = calls.get(callId);
    if (!involved(call, me)) return;
    const other = otherParty(call, me);
    if (call.state === 'ringing') {
      // caller hung up before answer (cancelled); callee may also decline via end_call
      const cancelled = String(call.caller) === me;
      finalize(io, call, cancelled ? 'cancelled' : 'rejected', cancelled ? 'cancelled' : 'rejected');
      socket.to(`user:${other}`).emit('end_call', { callId, reason: cancelled ? 'cancelled' : 'rejected' });
      io.to(`user:${other}`).emit('end_call', { callId, reason: cancelled ? 'cancelled' : 'rejected' });
      socket.to(`user:${me}`).emit('call_handled', { callId });
      return;
    }
    finalize(io, call, 'completed', 'ended');
    emitToUser(io, other, 'end_call', { callId, reason: 'ended' });
    socket.to(`user:${me}`).emit('end_call', { callId, reason: 'ended' });
  });

  // ---- WebRTC signaling relay (server never touches media)
  const relay = (event, { requireActive = true } = {}) =>
    socket.on(event, (data = {}) => {
      if (event === 'start_screen_share' && getRuntimeConfig().features.screenSharing === false) return;
      const call = calls.get(data.callId);
      if (!involved(call, me)) return;
      if (requireActive && call.state !== 'active') return;
      const target = otherParty(call, me);
      const payload = { ...data, from: me };
      if (isOnline(target)) return emitToUser(io, target, event, payload);
      // peer's socket is down right now: hold the message and deliver it as soon as it reconnects
      const q = (call.pending[target] ||= []);
      if (event === 'ice_candidate' && q.length >= MAX_QUEUED) q.shift();
      q.push({ event, payload });
      return undefined;
    });
  relay('webrtc_offer');
  relay('webrtc_answer');
  relay('ice_candidate');
  relay('start_screen_share');
  relay('stop_screen_share');
  relay('call_media_state');

  // ---- socket came back after a drop: tell it whether its call still exists
  socket.on('rejoin_call', ({ callId } = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    // Reconcile: the client reports which call it believes it is in on every (re)connect.
    // If the server still holds a call for this user that the client no longer knows about (e.g. the page was
    // reloaded) and this is the user's only socket, that call is a ghost -> end it so new calls are not blocked.
    const mine = calls.get(userCalls.get(me));
    if (mine && String(callId || '') !== mine.id && (onlineUsers.get(me)?.size || 0) <= 1) {
      endAndNotify(io, mine, mine.state === 'active' ? 'completed' : 'missed', 'connection_lost');
    }
    const call = calls.get(callId);
    if (!involved(call, me)) return reply({ ok: false });
    reply({ ok: true, state: call.state });
  });
};

module.exports.getIncomingCall = async (callId, userId) => {
  const call = calls.get(String(callId));
  if (!call || String(call.callee) !== String(userId) || call.state !== 'ringing') return null;
  const caller = await User.findById(call.caller).select('name avatar');
  return caller ? { callId: call.id, type: call.type, from: caller.toPublic() } : null;
};

// ---- presence hooks called from sockets/index.js
module.exports.onUserReconnected = (io, userId) => {
  const call = calls.get(userCalls.get(String(userId)));
  if (!call) return;
  clearTimeout(call.graceTimers[userId]);
  delete call.graceTimers[userId];
  emitToUser(io, otherParty(call, userId), 'call_peer_status', { callId: call.id, status: 'reconnected' });
  // flush signaling that arrived while this user was offline (offers, answers, ICE candidates ...)
  const queued = call.pending[userId];
  if (queued?.length) {
    delete call.pending[userId];
    setTimeout(() => queued.forEach(({ event, payload }) => emitToUser(io, userId, event, payload)), 100);
  }
};

module.exports.onUserGone = (io, userId) => {
  const call = calls.get(userCalls.get(String(userId)));
  if (!call) return;
  if (call.state === 'ringing' && String(call.caller) === String(userId)) {
    endAndNotify(io, call, 'cancelled', 'cancelled'); // caller vanished while ringing
    return;
  }
  emitToUser(io, otherParty(call, userId), 'call_peer_status', { callId: call.id, status: 'disconnected' });
  call.graceTimers[userId] = setTimeout(() => {
    endAndNotify(io, call, call.state === 'active' ? 'completed' : 'missed', 'connection_lost');
  }, GRACE_MS);
};
