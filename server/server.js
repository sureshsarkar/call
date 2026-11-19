const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');

const config = require('./config/env');
const connectDB = require('./config/db');
const sanitize = require('./middleware/sanitize');
const { apiLimiter } = require('./middleware/rateLimit');
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
app.use('/api', apiLimiter, routes);
app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);
const io = initSockets(server, corsOrigin);
app.set('io', io);

async function start() {
  await connectDB();
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
