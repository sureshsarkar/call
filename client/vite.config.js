import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    // allow access through a tunnel hostname (dev only) e.g. https://xxxx.trycloudflare.com
    allowedHosts: true,
    // Same-origin proxy so ONE public HTTPS tunnel on :5173 serves the app, the API and the websocket.
    // Used when VITE_USE_PROXY=true (see .env.example). The Origin header is normalised so the
    // backend's CORS / Socket.IO allow-list keeps working for any tunnel hostname.
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true, headers: { origin: 'http://localhost:5173' } },
      '/uploads': { target: 'http://localhost:5000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:5000', changeOrigin: true, ws: true, headers: { origin: 'http://localhost:5173' } },
    },
  },
});
