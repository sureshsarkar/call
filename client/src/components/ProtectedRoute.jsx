import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../context/authStore';

export function Splash() {
  return (
    <div className="flex h-dvh-safe items-center justify-center bg-bg">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-panel3 border-t-brand" />
    </div>
  );
}

export function ProtectedRoute({ children }) {
  const { user, ready } = useAuthStore();
  const loc = useLocation();
  if (!ready) return <Splash />;
  return user ? children : <Navigate to="/login" replace state={{ from: `${loc.pathname}${loc.search}` }} />;
}

export function GuestRoute({ children }) {
  const { user, ready } = useAuthStore();
  if (!ready) return <Splash />;
  return user ? <Navigate to="/" replace /> : children;
}
