const crypto = require('crypto');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const config = require('../config/env');
const { cleanLabel } = require('../utils/text');
const { signToken } = require('../middleware/auth');
const { sendMail } = require('../services/mail');

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

exports.register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (await User.exists({ email })) throw new ApiError(409, 'An account with this email already exists');
  const user = await User.create({ name: cleanLabel(name, 50), email, password });
  res.status(201).json({ token: signToken(user), user: user.toSelf() });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password +tokenVersion');
  if (!user || !(await user.comparePassword(password))) throw new ApiError(401, 'Invalid email or password');
  res.json({ token: signToken(user), user: user.toSelf() });
});

exports.logout = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { isOnline: false, lastSeen: new Date() });
  res.json({ message: 'Logged out' });
});

exports.me = asyncHandler(async (req, res) => res.json({ user: req.user.toSelf() }));

exports.forgotPassword = asyncHandler(async (req, res) => {
  const generic = { message: 'If that email is registered, a reset link has been sent.' };
  const user = await User.findOne({ email: req.body.email });
  if (!user) return res.json(generic); // do not reveal whether the account exists

  const token = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = hashToken(token);
  user.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000);
  await user.save({ validateBeforeSave: false });

  const url = `${config.clientUrls[0]}/reset-password/${token}`;
  await sendMail({
    to: user.email,
    subject: 'Reset your Pulse password',
    text: `Hi ${user.name},\n\nReset your password using this link (valid for 30 minutes):\n${url}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Hi ${user.name.replace(/[<>&]/g, '')},</p><p><a href="${url}">Reset your password</a> (valid for 30 minutes).</p><p>If you did not request this, ignore this email.</p>`,
  });

  // convenience for local development without SMTP — never exposed in production
  res.json(config.isProd || config.smtp.host ? generic : { ...generic, devResetUrl: url });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    resetPasswordToken: hashToken(req.params.token),
    resetPasswordExpires: { $gt: new Date() },
  }).select('+tokenVersion +resetPasswordToken +resetPasswordExpires');
  if (!user) throw new ApiError(400, 'Reset link is invalid or has expired');

  user.password = req.body.password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  user.tokenVersion = (user.tokenVersion || 0) + 1; // invalidates every existing session
  await user.save();
  res.json({ token: signToken(user), user: user.toSelf() });
});
