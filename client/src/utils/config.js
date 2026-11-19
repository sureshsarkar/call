// VITE_USE_PROXY=true -> talk to the backend through the Vite dev proxy on the same origin
// (needed when the app is opened through a tunnel / from a phone). Otherwise use explicit URLs.
const proxied = import.meta.env.VITE_USE_PROXY === 'true';

export const API_URL = proxied ? '/api' : import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
export const SOCKET_URL = proxied ? window.location.origin : import.meta.env.VITE_SOCKET_URL || API_URL.replace(/\/api\/?$/, '');
export const ASSET_URL = proxied ? '' : SOCKET_URL;
