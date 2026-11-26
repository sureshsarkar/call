import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ProtectedRoute, GuestRoute } from './components/ProtectedRoute';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AdminPanel from './pages/AdminPanel';
import ContentPage from './pages/ContentPage';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import EmptyChat from './pages/EmptyChat';
import ChatWindow from './components/ChatWindow';
import GroupChatWindow from './components/GroupChatWindow';
import GroupChatErrorBoundary from './components/GroupChatErrorBoundary';
import { useAuthStore } from './context/authStore';
import { setUnauthorizedHandler } from './services/api';
import { callApi } from './services/api';
import { useCallStore } from './context/callStore';
import { callManager } from './webrtc/CallManager';
import { useSettingsStore } from './context/settingsStore';
import { useAppConfigStore } from './context/appConfigStore';
import { enablePush } from './utils/push';

export default function App() {
  const token = useAuthStore((s) => s.token);
  const desktopNotifications = useSettingsStore((s) => s.desktopNotifications);
  const pushEnabled = useAppConfigStore((s) => s.config.features.pushNotifications);
  useEffect(() => {
    setUnauthorizedHandler(() => useAuthStore.getState().expire());
    useAuthStore.getState().init();
    useAppConfigStore.getState().load();
  }, []);

  useEffect(() => {
    if (token && desktopNotifications && pushEnabled && 'serviceWorker' in navigator && 'Notification' in window && Notification.permission === 'granted') void enablePush().catch(() => {});
  }, [token, desktopNotifications, pushEnabled]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const callId = url.searchParams.get('incomingCall');
    if (!callId || !useAuthStore.getState().token) return;
    callApi.incoming(callId).then((incoming) => {
      useCallStore.setState({ status: 'incoming', callId: incoming.callId, type: incoming.type, peer: incoming.from, isCaller: false });
      if (url.searchParams.get('pushAction') === 'reject') setTimeout(() => callManager.reject(), 0);
      url.searchParams.delete('incomingCall');
      url.searchParams.delete('pushAction');
      window.history.replaceState({}, '', url);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.data?.type !== 'PUSH_OPEN') return;
      const next = new URL(event.data.url, window.location.origin);
      if (event.data.action) next.searchParams.set('pushAction', event.data.action);
      window.location.assign(next.href);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);

  return (
    <BrowserRouter>
      <Toaster position="top-center" containerStyle={{ top: 'calc(env(safe-area-inset-top) + 8px)' }} toastOptions={{ style: { background: '#2a3942', color: '#e9edef', fontSize: '14px' }, duration: 3500 }} />
      <Routes>
        <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
        <Route path="/register" element={<GuestRoute><Register /></GuestRoute>} />
        <Route path="/forgot-password" element={<GuestRoute><ForgotPassword /></GuestRoute>} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
        <Route path="/content/:slug" element={<ContentPage />} />
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<EmptyChat />} />
          <Route path="chat/:userId" element={<ChatWindow />} />
          <Route path="group/:groupId" element={<GroupChatErrorBoundary><GroupChatWindow /></GroupChatErrorBoundary>} />
          <Route path="admin" element={<AdminPanel />} />
          <Route path="profile" element={<Profile />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
