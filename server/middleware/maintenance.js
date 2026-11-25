const { getRuntimeConfig } = require('../services/runtimeConfig');
const { userFromToken } = require('./auth');

const publicDuringMaintenance = (path) =>
  path === '/app/config' || path === '/auth/login' || path === '/auth/forgot-password' ||
  path.startsWith('/auth/reset-password/');

module.exports = async function maintenance(req, res, next) {
  if (!getRuntimeConfig().maintenanceMode || publicDuringMaintenance(req.path)) return next();

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  try {
    const user = await userFromToken(token);
    if (user?.role === 'super_admin') return next();
  } catch { /* maintenance response is the safe fallback */ }
  return res.status(503).json({ message: 'The application is temporarily under maintenance. Please try again soon.' });
};
