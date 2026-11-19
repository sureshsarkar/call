const rateLimit = require('express-rate-limit');

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message },
  });

exports.apiLimiter = make(60 * 1000, 300, 'Too many requests, please slow down.');
exports.authLimiter = make(15 * 60 * 1000, 30, 'Too many attempts, please try again in 15 minutes.');
exports.previewLimiter = make(60 * 1000, 30, 'Too many link previews requested.');
