const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');
const User = require('./models/User');
const AppConfig = require('./models/AppConfig');
const { loadRuntimeConfig } = require('./services/runtimeConfig');

const config = require('./config/env');
const connectDB = require('./config/db');
const sanitize = require('./middleware/sanitize');
const { apiLimiter } = require('./middleware/rateLimit');
const maintenance = require('./middleware/maintenance');
const { notFound, errorHandler } = require('./middleware/error');
const routes = require('./routes');
const { initSockets } = require('./sockets');

const app = express();
if (config.isProd) app.set('trust proxy', 1); // behind Render/Railway/Nginx so rate limiting sees real IPs

const corsOrigin = (origin, cb) => {
  if (!origin || config.clientUrls.includes(origin)) return cb(null, true);
  cb(new Error(`Origin ${origin} not allowed by CORS`));
};

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); // allow client origin to load /uploads
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(sanitize);
if (!config.isProd) app.use(morgan('dev'));

app.use('/uploads', express.static(path.resolve(config.uploadDir), { maxAge: '7d', index: false }));
app.get('/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));
app.use('/api', apiLimiter, maintenance, routes);
app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);
const io = initSockets(server, corsOrigin);
app.set('io', io);

async function start() {
  await connectDB();
  // Presence is held in Socket.IO memory; after a process restart there are no connected users.
  await User.updateMany({ isOnline: true }, { $set: { isOnline: false, lastSeen: new Date() } });
  // Backfill admin/security fields for accounts created before the admin panel existed.
  await User.updateMany({ role: { $exists: false } }, { $set: { role: 'user' } });
  await User.updateMany({ accountStatus: { $exists: false } }, { $set: { accountStatus: 'active' } });
  await User.updateMany({ isVerified: { $exists: false } }, { $set: { isVerified: false } });
  await User.updateMany({ twoFactorEnabled: { $exists: false } }, { $set: { twoFactorEnabled: false } });
  // Group chat was previously a disabled placeholder toggle; enable it now that the module exists.
  await AppConfig.updateOne({ key: 'global', groupChatMigrationV1: { $ne: true } }, { $set: { 'features.groupChat': true, groupChatMigrationV1: true } });
  await AppConfig.updateOne({ key: 'global', groupMediaMigrationV1: { $ne: true } }, { $set: { 'features.fileSharing': true, groupMediaMigrationV1: true } });
  await loadRuntimeConfig();
  try { await require('./services/retention').ensureRetention(); } catch (err) { console.error('[retention] could not set up auto-delete:', err.message); }
  if (config.superAdminEmail) {
    const result = await User.updateOne({ email: config.superAdminEmail, role: { $ne: 'super_admin' } }, { $set: { role: 'super_admin', accountStatus: 'active', suspendedUntil: null }, $inc: { tokenVersion: 1 } });
    if (result.modifiedCount) console.info(`[bootstrap] Super Admin role assigned to configured account (${config.superAdminEmail})`);
  }
  server.listen(config.port, () => console.log(`[server] listening on :${config.port} (${config.isProd ? 'production' : 'development'})`));
}

start().catch((err) => {
  console.error('[server] failed to start:', err.message);
  process.exit(1);
});

const shutdown = () => {
  io.close();
  server.close(() => mongoose.connection.close(false).then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 8000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
