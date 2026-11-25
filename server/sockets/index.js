const { Server } = require('socket.io');
const config = require('../config/env');
const User = require('../models/User');
const { userFromToken } = require('../middleware/auth');
const { onlineUsers, room, emitToUser } = require('./state');
const registerChat = require('./chat');
const registerCall = require('./call');

function initSockets(httpServer, corsOrigin) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    maxHttpBufferSize: 1e6, // SDP/ICE payloads are small
    // Generous keep-alive: on slow or lossy mobile links a 10s window caused false disconnects.
    pingInterval: 25000,
    pingTimeout: 30000,
    connectTimeout: 45000,
  });

  // Secure socket authentication: JWT required in the handshake
  io.use(async (socket, next) => {
    const user = await userFromToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.userId = String(user._id);
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    socket.join(room(userId));

    // Everything below up to the first await runs synchronously, so no client event or disconnect can be missed.
    registerChat(io, socket);
    registerCall(io, socket);

    const sockets = onlineUsers.get(userId) || new Set();
    const firstConnection = sockets.size === 0;
    sockets.add(socket.id);
    onlineUsers.set(userId, sockets);
    if (firstConnection) registerCall.onUserReconnected(io, userId); // cancel any call grace timer immediately

    socket.on('disconnect', async () => {
      const set = onlineUsers.get(userId);
      set?.delete(socket.id);
      if (set && set.size === 0) {
        onlineUsers.delete(userId);
        const lastSeen = new Date();
        io.emit('user_offline', { userId, lastSeen });
        registerCall.onUserGone(io, userId);
        await User.updateOne({ _id: userId }, { isOnline: false, lastSeen }).catch(() => {});
      }
    });

    socket.emit('online_users', { userIds: [...onlineUsers.keys()] });

    if (firstConnection) {
      (async () => {
        await User.updateOne({ _id: userId }, { isOnline: true });
        socket.broadcast.emit('user_online', { userId });
      })().catch((err) => console.error('[socket] presence', err.message));
    }
  });

  return io;
}

module.exports = { initSockets };
void config;
