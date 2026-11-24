const { body, param, query } = require('express-validator');
const { normalizePhone } = require('../utils/identity');

const objectId = (name, where = param) => where(name).isMongoId().withMessage('Invalid id');

exports.register = [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  body('email').trim().isEmail().withMessage('Enter a valid email').normalizeEmail({ gmail_remove_dots: false }),
  body('username').isString().trim().matches(/^[a-zA-Z0-9._]{3,30}$/).withMessage('Username must be 3-30 characters using letters, numbers, dots or underscores'),
  body('phone').optional({ checkFalsy: true }).isString().bail().trim().custom((value) => Boolean(normalizePhone(value))).withMessage('Enter a valid mobile number (10-digit Indian number or international number with country code)'),
  body('password').isString().isLength({ min: 6, max: 128 }).withMessage('Password must be at least 6 characters'),
];
exports.login = [
  body('identifier').custom((value, { req }) => {
    const identity = value ?? req.body.email;
    return typeof identity === 'string' && Boolean(identity.trim());
  }).withMessage('Enter your username, email or mobile number'),
  body('identifier').optional().isString().trim().isLength({ max: 254 }).withMessage('Login identifier is too long'),
  body('email').optional().isString().trim().isLength({ max: 254 }).withMessage('Login identifier is too long'),
  body('password').isString().notEmpty().withMessage('Password is required'),
];
exports.forgot = [body('email').trim().isEmail().withMessage('Enter a valid email').normalizeEmail({ gmail_remove_dots: false })];
exports.reset = [
  param('token').isHexadecimal().isLength({ min: 64, max: 64 }).withMessage('Invalid reset token'),
  body('password').isString().isLength({ min: 6, max: 128 }).withMessage('Password must be at least 6 characters'),
];
exports.changePassword = [
  body('currentPassword').isString().notEmpty().withMessage('Current password is required'),
  body('newPassword').isString().isLength({ min: 6, max: 128 }).withMessage('Password must be at least 6 characters'),
];
exports.updateProfile = [
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  body('about').optional().trim().isLength({ max: 140 }).withMessage('About must be at most 140 characters'),
  body('username').optional({ checkFalsy: true }).isString().trim().matches(/^[a-zA-Z0-9._]{3,30}$/).withMessage('Username must be 3-30 characters using letters, numbers, dots or underscores'),
  body('phone').optional({ checkFalsy: true }).isString().bail().trim().custom((value) => Boolean(normalizePhone(value))).withMessage('Enter a valid mobile number (10-digit Indian number or international number with country code)'),
];
exports.idParam = [objectId('id')];
exports.userIdParam = [objectId('userId')];
exports.searchUsers = [query('q').optional().isString().isLength({ max: 100 })];
exports.messageList = [
  objectId('userId'),
  query('before').optional().isISO8601().withMessage('Invalid cursor'),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];
exports.deleteMessage = [objectId('id'), query('scope').optional().isIn(['me', 'everyone'])];
exports.searchMessages = [query('q').isString().trim().isLength({ min: 2, max: 100 }).withMessage('Search needs at least 2 characters')];
exports.previewUrl = [query('url').isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('Invalid URL')];
