// In-memory realtime state. For horizontal scaling replace with Redis + @socket.io/redis-adapter.
const onlineUsers = new Map(); // userId -> Set<socketId>

const room = (userId) => `user:${userId}`;
const isOnline = (userId) => (onlineUsers.get(String(userId))?.size || 0) > 0;
const emitToUser = (io, userId, event, payload) => io.to(room(userId)).emit(event, payload);

module.exports = { onlineUsers, room, isOnline, emitToUser };
