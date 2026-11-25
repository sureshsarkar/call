# Pulse — real-time chat, audio & video calling (MERN + WebRTC)

WhatsApp-style chat, one-to-one audio/video calls, screen sharing and AI noise cancellation.
Socket.IO carries **signaling and messaging only**; audio/video flows peer-to-peer over **WebRTC** (relayed through TURN when a direct path is impossible).

```
call/
├─ client/   React 19 + Vite + Tailwind 4 + Zustand        → deploy to Vercel
│  └─ src/ components/ pages/ layouts/ hooks/ context/ services/ socket/ webrtc/ utils/ assets/
├─ server/   Node + Express 5 + Mongoose 9 + Socket.IO     → deploy to Render / Railway / VPS
│  └─ config/ controllers/ models/ routes/ middleware/ services/ sockets/ utils/
└─ deploy/   coturn configs, nginx config   (+ render.yaml, docker-compose.yml)
```

## 1. Run locally

Prerequisites: Node 18+, MongoDB (local, Atlas, or `docker compose up -d mongo`).

```powershell
# backend
cd server
npm install
copy .env.example .env      # then edit JWT_SECRET / MONGODB_URI
npm run dev                 # http://localhost:5000  (GET /health)

# frontend (second terminal)
cd client
npm install
copy .env.example .env      # VITE_API_URL=http://localhost:5000/api
npm run dev                 # http://localhost:5173
```

Test it: open two different browsers (or one normal + one incognito window), register two users, search for the other by name, chat, then call.
`getUserMedia` needs a secure context — `http://localhost` works; for other devices on your LAN use HTTPS (e.g. `npx vite --host` behind a tunnel such as ngrok/cloudflared, or a local cert).

Password reset: with no SMTP configured the reset link is printed in the server console **and** shown on the "Forgot password" page (development only; never in production).

### Environment variables

| `server/.env` | Purpose |
|---|---|
| `PORT`, `NODE_ENV` | `production` enables strict secret checks, trust-proxy, no request logging |
| `MONGODB_URI` | Mongo connection string (Atlas in prod) |
| `JWT_SECRET` | ≥ 32 random chars (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) — server refuses to boot in production with a weak one |
| `TWO_FACTOR_ENCRYPTION_KEY` | Separate stable random secret (same generation command as `JWT_SECRET`) used to encrypt the Super Admin authenticator secret. Set this before enabling 2FA in production; never rotate it without resetting 2FA. |
| `JWT_EXPIRES_IN` | e.g. `30d` (default: 30 days) |
| `SUPER_ADMIN_EMAIL` | Email of an already registered account to promote to Super Admin when the backend starts. Set this only in the private backend environment (Render/Railway/VPS), never in the frontend. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push credentials. Generate with `npx web-push generate-vapid-keys`; set both keys in the backend environment to enable background push. Keep the private key secret. |
| `CLIENT_URL` | Comma-separated allowed browser origins (CORS **and** Socket.IO), e.g. `https://pulse.vercel.app` |
| `STUN_URLS` | default Google STUN |
| `TURN_URLS` | e.g. `turn:turn.example.com:3478,turns:turn.example.com:5349?transport=tcp` |
| `TURN_SECRET` / `TURN_TTL` | coturn `static-auth-secret`; the API hands each user 1-hour HMAC credentials (no permanent password reaches the browser) |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | alternative static credentials |
| `SMTP_*`, `MAIL_FROM` | password-reset email |

| `client/.env` | Purpose |
|---|---|
| `VITE_API_URL` | REST base **including** `/api` |
| `VITE_SOCKET_URL` | Socket.IO origin (defaults to `VITE_API_URL` minus `/api`) |

### Mobile app experience (PWA)
Pulse is built phone-first. On a phone it behaves like a native app: bottom tab bar (Chats · Calls · Contacts · Alerts · Me), large titles, an "online now" story strip, a new-chat button, slide-in screens, swipe-from-the-left-edge to go back, long-press a message for a bottom sheet (copy / delete), a WhatsApp-style docked emoji panel, full-screen incoming-call screen with vibration, draggable self-view during video calls, screen wake-lock during calls, haptic feedback, safe-area (notch) support and keyboard-aware layout.
**Install it:** Android/Chrome → *Me* tab → *Install Pulse as an app* (or the browser menu → *Install app*); iPhone → Safari *Share* → *Add to Home Screen*. It then opens full-screen with its own icon. (The service worker is only active in production builds, i.e. on your deployed HTTPS site.) To try it on a real phone during development, expose the dev server over HTTPS (e.g. a Cloudflare/ngrok tunnel) because camera and microphone need a secure context.

## 2. How the call works

1. Caller captures mic/camera (with `echoCancellation`, `noiseSuppression`, `autoGainControl`), then emits `incoming_call`; server checks busy/offline, writes a `CallHistory` row, rings the callee (45 s timeout → missed + notification).
2. Callee `accept_call` → caller creates the `RTCPeerConnection` (ICE servers fetched from `/api/calls/ice-servers`) and adds tracks → `negotiationneeded` → `webrtc_offer` → `webrtc_answer`; both sides trickle `ice_candidate` (queued until the remote description exists).
3. **Perfect negotiation** (polite/impolite peers) makes renegotiation glare-safe. ICE `disconnected`/`failed` triggers `restartIce()`, a "reconnecting" banner, and ends the call after 25 s. If the *socket* drops, the server keeps the call for 15 s; the client re-joins with `rejoin_call` after reconnecting.
4. **Screen share** (`getDisplayMedia`) swaps the outgoing video track with `RTCRtpSender.replaceTrack` (no renegotiation), signals `start_screen_share`/`stop_screen_share`, and switches back to the camera when stopped or when the browser's "Stop sharing" bar is used. Permission/cancel errors are shown as toasts.
5. **Cleanup**: on hang-up/reject/failure every track, the `RTCPeerConnection`, the RNNoise `AudioContext`, timers and ringtone are released.

### Noise cancellation
* Always on: browser DSP via constraints (`echoCancellation`, `noiseSuppression`, `autoGainControl`, mono, `voiceIsolation` where supported).
* Optional (Settings → *AI noise cancellation*): **RNNoise** (neural suppressor compiled to WASM, from `@sapphi-red/web-noise-suppressor`) in an `AudioWorklet`: `mic → RNNoise → MediaStreamDestination → RTCPeerConnection`. Runs locally at 48 kHz; if it can't load it falls back to browser processing automatically. A built-in mic test (Settings) shows the live level.

## 2b. Auto-delete (privacy)
All chat data is deleted from MongoDB automatically **24 hours after it is created** (change with `MESSAGE_TTL_HOURS`, `0` = keep forever):
* **messages** — 24 h after each message was sent; **chats** (conversation records) and **notification previews** — 24 h after the last activity.
* Implemented with MongoDB TTL indexes (created on server start; changing the value updates them in place). Expired data is also hidden by every API query immediately, and removed from open screens within ~30 s.
* **Not** deleted: user accounts and call history (who called whom, when, and for how long — no content).
* On the first start after enabling it, everything older than the lifetime is removed within about a minute. This cannot be undone — take an Atlas backup first if you need the old data.

## 3. Security measures
bcrypt (cost 11) · JWT with server-side revocation (`tokenVersion` bumps on password reset/change) · Socket.IO handshake auth · `helmet` · strict CORS allow-list · rate limits (global, stricter on auth, link previews) · `express-validator` on every route · NoSQL-operator stripping · control-char/angle-bracket sanitising + React output escaping · only `http(s)` links are rendered, with `rel="noopener noreferrer nofollow"` · avatar upload: MIME allow-list + magic-byte check + random filenames + 2 MB cap · conversations are looked up by *authenticated participant pair*, so one user can never read another's messages · link-preview fetcher blocks private/loopback/link-local IPs at connect time (SSRF/DNS-rebinding safe), 512 KB / 6 s caps · call signaling only relays between the two call participants · per-socket message rate limit · coturn config denies relaying to private ranges.

### Admin panel
Register the account first, then set `SUPER_ADMIN_EMAIL` and `TWO_FACTOR_ENCRYPTION_KEY` in the backend environment and restart/redeploy the backend. Sign in with that account and open **Admin panel** from the profile/navigation. Super Admin tools remain locked until authenticator-based 2FA is enabled. The first setup shows a one-time authenticator secret; save it in an authenticator app before enabling.

The existing product is a private 1:1 chat/call application. Group chat, message/file moderation, call recording, SMS setup, backup/restore, per-device session listings, editable brand/theme assets, and in-panel email/API secret management are not implemented in its current architecture; those controls are not exposed as active features. Session revocation signs a user out of all devices, and content entries currently render as plain text with SEO title/description metadata. External service secrets remain managed in the backend environment.

## 4. Deployment

### MongoDB Atlas
Create a free cluster → Database Access user → Network Access (allow your host's IPs, or `0.0.0.0/0` with a strong password) → copy the `mongodb+srv://…/pulse` string into `MONGODB_URI`.

### Backend — Render (or Railway)
* Render: *New → Blueprint* using `render.yaml` (root dir `server`, start `node server.js`, health `/health`). Set `MONGODB_URI`, `CLIENT_URL=https://<your-vercel-domain>`, `TURN_URLS`, `TURN_SECRET`. Render terminates TLS, so Socket.IO automatically runs over **wss://**; WebSockets are supported out of the box.
* Railway: new project from repo, root `server`, same variables; it injects `PORT`.
* **Uploads caveat**: avatars are written to `server/uploads`. PaaS disks are ephemeral — attach a persistent disk (Render Disk mounted at `/opt/render/project/src/server/uploads`) or swap `middleware/upload.js` for S3/Cloudinary.
* Scaling beyond one instance: add `@socket.io/redis-adapter` and move `sockets/state.js` + the active-call map in `sockets/call.js` to Redis.

### Backend — VPS
```bash
git clone … && cd call/server && npm ci --omit=dev
cp .env.example .env && nano .env            # NODE_ENV=production …
npm i -g pm2 && pm2 start server.js --name pulse && pm2 save && pm2 startup
# TLS + wss: install nginx, copy deploy/nginx-pulse.conf, then
sudo certbot --nginx -d api.example.com
```

### Frontend — Vercel
Import the repo, **Root Directory = `client`**, framework *Vite*. Env vars: `VITE_API_URL=https://api.example.com/api`, `VITE_SOCKET_URL=https://api.example.com`. `client/vercel.json` adds the SPA rewrite and a `Permissions-Policy` that permits camera, microphone and display-capture. After deploying, put the Vercel URL into the backend's `CLIENT_URL` (no trailing slash; add a custom domain too if you have one).

### TURN — required for reliable calls (pick ONE option)
STUN alone fails for users behind symmetric NAT / many mobile carriers / strict Wi-Fi. A TURN server relays the media in those cases.

**Option 1 — Cloudflare Realtime TURN (recommended, free 1,000 GB/month, no server to run)**
1. Cloudflare dashboard → *Realtime* → *TURN Server* → create a TURN key. Copy the **Key ID** and **API Token**.
2. Render → your service → *Environment*: add `CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN` (keep them secret; they only live on the server). Optionally `CF_TURN_TTL` (seconds, default 86400).
3. Save — Render redeploys. The server mints short-lived credentials per hour and hands them to logged-in users only.

**Option 2 — Metered (free 20 GB/month)**: create a free account, then set `TURN_URLS=turn:standard.relay.metered.ca:80,turn:standard.relay.metered.ca:443,turns:standard.relay.metered.ca:443?transport=tcp`, plus the `TURN_USERNAME` and `TURN_CREDENTIAL` shown in the Metered dashboard.

**Option 3 — your own coturn** (below).

**Verify it works:** in the app open *Settings → Call connection test → Run test*. You should see "TURN relay works". Test once on Wi-Fi and once on mobile data.

### Self-hosted TURN (coturn)
STUN alone fails for users behind symmetric NAT / many mobile carriers / corporate firewalls (~10–20 % of calls).
```bash
sudo apt install coturn
sudo certbot certonly --standalone -d turn.example.com
sudo cp deploy/coturn/turnserver.conf /etc/turnserver.conf     # edit IP, domain, secret
echo "TURNSERVER_ENABLED=1" | sudo tee -a /etc/default/coturn
sudo systemctl enable --now coturn
# open: 3478 udp+tcp, 5349 tcp+udp, 49160-49200 udp
```
Backend env: `TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349?transport=tcp` and `TURN_SECRET=<same as static-auth-secret>`.
Verify with <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/> (use a username of `<unix-expiry>:test` and the HMAC-SHA1 credential) — you should see `relay` candidates.
Local TURN for development: `docker compose up -d coturn`, then in `server/.env` set `TURN_URLS=turn:localhost:3478` and `TURN_SECRET=dev-turn-secret`.

## 5. API summary
`/api/auth` register · login · logout · me · forgot-password · reset-password/:token — `/api/users` search · online · contacts · :id · me (PUT) · me/password · me/avatar — `/api/conversations` — `/api/messages` with/:userId?before= · search?q= · :id?scope=me|everyone (DELETE) — `/api/notifications` — `/api/calls` history · ice-servers — `/api/links/preview?url=`

Socket events: `user_online` `user_offline` `online_users` `send_message` (ack) `receive_message` `message_sent` `message_updated` `message_seen` `messages_delivered` `message_deleted` `typing` `stop_typing` `notification` `incoming_call` `accept_call` `reject_call` `end_call` `call_handled` `webrtc_offer` `webrtc_answer` `ice_candidate` `start_screen_share` `stop_screen_share` `call_media_state` `call_peer_status` `rejoin_call`.

## 6. Verified / not verified
The backend (auth, reset flow, chat delivery/seen/typing, deletion, authorization, SSRF guard, call signaling relay, busy/reject/cancel/missed, history) is covered by an end-to-end script run against an in-memory MongoDB, and the client production build succeeds. Real audio/video between two browsers, TURN relay, screen-share prompts and RNNoise depend on browser hardware/permissions and must be checked manually on your devices (see §1).
