const { body, param, query } = require('express-validator');

const objectId = (name, where = param) => where(name).isMongoId().withMessage('Invalid id');

exports.register = [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  body('email').trim().isEmail().withMessage('Enter a valid email').normalizeEmail({ gmail_remove_dots: false }),
  body('password').isString().isLength({ min: 1, max: 128 }).withMessage('Password is required'),
];
exports.login = [
  body('email').trim().isEmail().withMessage('Enter a valid email').normalizeEmail({ gmail_remove_dots: false }),
  body('password').isString().notEmpty().withMessage('Password is required'),
];
exports.forgot = [body('email').trim().isEmail().withMessage('Enter a valid email').normalizeEmail({ gmail_remove_dots: false })];
exports.reset = [
  param('token').isHexadecimal().isLength({ min: 64, max: 64 }).withMessage('Invalid reset token'),
  body('password')
    .isLength({ min: 8, max: 128 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Za-z]/).withMessage('Password must contain a letter')
    .matches(/\d/).withMessage('Password must contain a number'),
];
exports.changePassword = [
  body('currentPassword').isString().notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8, max: 128 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Za-z]/).withMessage('Password must contain a letter')
    .matches(/\d/).withMessage('Password must contain a number'),
];
exports.updateProfile = [
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  body('about').optional().trim().isLength({ max: 140 }).withMessage('About must be at most 140 characters'),
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
