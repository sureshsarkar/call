import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import CallOverlay from '../components/CallOverlay';
import useSocket from '../hooks/useSocket';
import useViewportHeight from '../hooks/useViewportHeight';
import { useChatStore } from '../context/chatStore';

export default function AppLayout() {
  useSocket();
  useViewportHeight();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const atRoot = pathname === '/';

  useEffect(() => {
    useChatStore.getState().loadConversations();
    useChatStore.getState().loadNotifications();
  }, []);

  // keep the screen in step with server-side auto-delete (24h by default)
  useEffect(() => {
    const id = setInterval(() => useChatStore.getState().pruneExpired(), 30_000);
    return () => clearInterval(id);
  }, []);

  // Dynamic title with unread count
  const unread = useChatStore((s) => s.conversations.reduce((a, c) => a + c.unreadCount, 0));
  useEffect(() => { document.title = unread ? `(${unread}) Pulse` : 'Pulse – Chat, Audio & Video Calls'; }, [unread]);

  // iOS-style swipe from the left edge to go back (phones only)
  const touch = useRef(null);
  const onTouchStart = (e) => {
    const t = e.touches[0];
    touch.current = t.clientX < 28 && window.innerWidth < 768 ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e) => {
    const s = touch.current;
    touch.current = null;
    if (!s || atRoot) return;
    const t = e.changedTouches[0];
    if (t.clientX - s.x > 80 && Math.abs(t.clientY - s.y) < 60) navigate('/');
  };

  return (
    <div className="mx-auto flex h-dvh-safe max-w-[1700px] overflow-hidden bg-bg pl-safe pr-safe 2xl:border-x 2xl:border-line"
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className={`${atRoot ? 'flex' : 'hidden'} h-full w-full shrink-0 border-r border-line md:flex md:w-[360px] lg:w-[400px]`}>
        <Sidebar />
      </div>
      <main key={pathname} className={`${atRoot ? 'hidden' : 'slide-in flex'} h-full min-w-0 flex-1 flex-col bg-bg md:flex md:animate-none`}>
        <Outlet />
      </main>
      <CallOverlay />
    </div>
  );
}
