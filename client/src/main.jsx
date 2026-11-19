import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { useUiStore } from './context/uiStore';

// PWA: capture the install prompt so the "Install app" button can trigger it later
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  useUiStore.getState().setInstallEvent(e);
});
window.addEventListener('appinstalled', () => {
  useUiStore.getState().setInstallEvent(null);
  useUiStore.getState().setInstalled(true);
});

// PWA: service worker only in production builds (it would interfere with Vite's dev server)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
