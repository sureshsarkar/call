const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const signToken = (user) =>
  jwt.sign({ id: user._id, v: user.tokenVersion || 0 }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

/** Verifies a JWT and returns the matching user, or null. Used by REST and Socket.IO. */
async function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(payload.id).select('+tokenVersion');
    if (!user || (user.tokenVersion || 0) !== (payload.v || 0)) return null;
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

module.exports = { protect, signToken, userFromToken };
