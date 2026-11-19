const config = require('../config/env');

exports.notFound = (req, _res, next) => {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.status = 404;
  next(err);
};

// eslint-disable-next-line no-unused-vars
exports.errorHandler = (err, _req, res, _next) => {
  let status = err.status || 500;
  let message = err.message || 'Server error';

  if (err.name === 'ValidationError') {
    status = 422;
    message = Object.values(err.errors)[0]?.message || 'Validation failed';
  } else if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid identifier';
  } else if (err.code === 11000) {
    status = 409;
    message = 'Duplicate value';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = 'File is too large (max 2MB)';
  }

  if (status >= 500) {
    console.error('[error]', err);
    if (config.isProd) message = 'Internal server error';
  }
  res.status(status).json({ message, ...(err.details ? { errors: err.details } : {}) });
};
