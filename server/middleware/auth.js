const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { getRuntimeConfig } = require('../services/runtimeConfig');

const signToken = (user) =>
  jwt.sign({ id: user._id, v: user.tokenVersion || 0 }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

/** Verifies a JWT and returns the matching user, or null. Used by REST and Socket.IO. */
async function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(payload.id).select('+tokenVersion');
    if (user?.accountStatus === 'suspended' && user.suspendedUntil && user.suspendedUntil <= new Date()) {
      user.accountStatus = 'active';
      user.suspendedUntil = null;
      await user.save({ validateBeforeSave: false });
    }
    const suspended = user?.accountStatus === 'suspended' && (!user.suspendedUntil || user.suspendedUntil > new Date());
    const awaitingVerification = getRuntimeConfig().features.userVerification && user?.role === 'user' && !user.isVerified;
    if (!user || user.accountStatus === 'blocked' || suspended || awaitingVerification || (user.tokenVersion || 0) !== (payload.v || 0)) return null;
    return user;
  } catch {
    return null;
  }
}

const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = await userFromToken(token);
  if (!user) throw new ApiError(401, 'Not authenticated');
  req.user = user;
  next();
});

const permissionMap = {
  admin: ['dashboard.view', 'users.view', 'users.edit', 'users.suspend', 'users.reset_password', 'calls.view', 'settings.view', 'reports.view', 'notifications.send'],
  moderator: ['dashboard.view', 'users.view', 'users.suspend', 'reports.view'],
  support: ['dashboard.view', 'users.view'],
};

const requirePermission = (permission) => asyncHandler(async (req, _res, next) => {
  if (req.user?.role === 'super_admin') return next();
  if (permission === 'roles.manage') throw new ApiError(403, 'Only the Super Admin can manage roles or administrator assignments');
  if (!req.user || req.user.accountStatus !== 'active') throw new ApiError(403, 'Administrator access required');
  if (permissionMap[req.user.role]?.includes(permission)) return next();
  if (req.user.customRole) {
    const AdminRole = require('../models/AdminRole');
    const role = await AdminRole.findById(req.user.customRole).select('permissions active');
    if (permission !== 'roles.manage' && role?.active && role.permissions.includes(permission)) return next();
  }
  throw new ApiError(403, 'You do not have permission to perform this action');
});

const requireSuperAdminTwoFactor = asyncHandler(async (req, _res, next) => {
  if (req.user?.role === 'super_admin' && !req.user.twoFactorEnabled) {
    throw new ApiError(403, 'Set up authenticator two-factor authentication before using the Super Admin panel');
  }
  next();
});

module.exports = { protect, signToken, userFromToken, requirePermission, requireSuperAdminTwoFactor };
