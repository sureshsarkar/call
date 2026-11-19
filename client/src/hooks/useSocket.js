import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../context/authStore';
import { useChatStore } from '../context/chatStore';
import { connectSocket, disconnectSocket } from '../socket/socket';
import { bindSocket } from '../socket/handlers';
import { ensureNotificationPermission } from '../utils/notify';

/** Opens the authenticated Socket.IO connection while the user is logged in. */
export default function useSocket() {
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.user?._id);
  const navigate = useNavigate();

  useEffect(() => {
    if (!token || !userId) return undefined;
    const socket = connectSocket(token);
    bindSocket(socket, navigate);
    ensureNotificationPermission();
    useChatStore.getState().loadContacts();
    return () => {
      disconnectSocket();
      useChatStore.getState().reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, userId]);
}
