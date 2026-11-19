import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ProtectedRoute, GuestRoute } from './components/ProtectedRoute';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import EmptyChat from './pages/EmptyChat';
import ChatWindow from './components/ChatWindow';
import { useAuthStore } from './context/authStore';
import { setUnauthorizedHandler } from './services/api';

export default function App() {
  useEffect(() => {
    setUnauthorizedHandler(() => useAuthStore.getState().expire());
    useAuthStore.getState().init();
  }, []);

  return (
    <BrowserRouter>
      <Toaster position="top-center" containerStyle={{ top: 'calc(env(safe-area-inset-top) + 8px)' }} toastOptions={{ style: { background: '#2a3942', color: '#e9edef', fontSize: '14px' }, duration: 3500 }} />
      <Routes>
        <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
        <Route path="/register" element={<GuestRoute><Register /></GuestRoute>} />
        <Route path="/forgot-password" element={<GuestRoute><ForgotPassword /></GuestRoute>} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<EmptyChat />} />
          <Route path="chat/:userId" element={<ChatWindow />} />
          <Route path="profile" element={<Profile />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
