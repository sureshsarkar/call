import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import CallOverlay from '../components/CallOverlay';
import useSocket from '../hooks/useSocket';
import useViewportHeight from '../hooks/useViewportHeight';
import { useChatStore } from '../context/chatStore';
import { useAuthStore } from '../context/authStore';
import { useAppConfigStore } from '../context/appConfigStore';

export default function AppLayout() {
  useSocket();
  useViewportHeight();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const atRoot = pathname === '/';
  const appName = useAppConfigStore((s) => s.config.appName);
  const maintenanceMode = useAppConfigStore((s) => s.config.maintenanceMode);
  const role = useAuthStore((s) => s.user?.role);

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
  useEffect(() => { document.title = unread ? `(${unread}) ${appName}` : `${appName} – Chat, Audio & Video Calls`; }, [unread, appName]);

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
      {maintenanceMode && role !== 'super_admin' && <div className="fixed inset-x-0 top-0 z-[70] bg-amber-400 px-3 py-2 text-center text-sm font-medium text-black">{appName} is in maintenance mode. Some features may be unavailable.</div>}
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
