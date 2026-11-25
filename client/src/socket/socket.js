import { io } from 'socket.io-client';
import { SOCKET_URL } from '../utils/config';

let socket = null;

export const getSocket = () => socket;

export function connectSocket(token) {
  if (socket) return socket;
  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 30000, // slow links: allow a long handshake
  });
  if (import.meta.env.DEV) window.__socket = socket; // handy for debugging in dev tools
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/** Promise wrapper for acks, with a timeout so UI never hangs. */
export function emitAck(event, payload, timeout = 20000) {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve({ ok: false, error: 'Not connected to the server' });
    const timer = setTimeout(() => resolve({ ok: false, error: 'Server did not respond' }), timeout);
    socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res || { ok: false }); });
  });
}
