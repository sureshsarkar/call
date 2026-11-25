require('dotenv').config({ quiet: true });

const list = (v, d = []) =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d;

const isProd = process.env.NODE_ENV === 'production';

const config = {
  isProd,
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pulse',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  twoFactorEncryptionKey: process.env.TWO_FACTOR_ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  twoFactorEncryptionKeyConfigured: Boolean(process.env.TWO_FACTOR_ENCRYPTION_KEY),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  superAdminEmail: String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase(),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@pulse.app',
  clientUrls: list(process.env.CLIENT_URL, ['http://localhost:5173']),
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  // Auto-delete chat data this many hours after it was created (0 disables). Fractions allowed (0.5 = 30 min).
  messageTtlHours: process.env.MESSAGE_TTL_HOURS !== undefined && process.env.MESSAGE_TTL_HOURS !== '' ? Math.max(0, Number(process.env.MESSAGE_TTL_HOURS) || 0) : 24,
  ice: {
    stunUrls: list(process.env.STUN_URLS, ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']),
    turnUrls: list(process.env.TURN_URLS),
    turnUsername: process.env.TURN_USERNAME || '',
    turnCredential: process.env.TURN_CREDENTIAL || '',
    turnSecret: process.env.TURN_SECRET || '', // coturn static-auth-secret (REST API credentials)
    turnTtl: Number(process.env.TURN_TTL) || 3600,
    // Cloudflare Realtime TURN (managed, short-lived credentials generated server-side)
    cloudflare: {
      keyId: process.env.CF_TURN_KEY_ID || '',
      apiToken: process.env.CF_TURN_API_TOKEN || '',
      ttl: Number(process.env.CF_TURN_TTL) || 86400, // credential lifetime (seconds)
    },
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Pulse <no-reply@pulse.local>',
  },
};

if (isProd && (config.jwtSecret.length < 32 || config.jwtSecret.startsWith('dev-only'))) {
  throw new Error('JWT_SECRET must be set to a random string of at least 32 characters in production');
}
if (isProd && process.env.TWO_FACTOR_ENCRYPTION_KEY && process.env.TWO_FACTOR_ENCRYPTION_KEY.length < 32) {
  throw new Error('TWO_FACTOR_ENCRYPTION_KEY must be at least 32 characters in production');
}

module.exports = config;
