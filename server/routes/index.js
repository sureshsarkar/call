const router = require('express').Router();
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const v = require('../middleware/validators');
const { authLimiter, previewLimiter } = require('../middleware/rateLimit');
const { uploadAvatar } = require('../middleware/upload');
const auth = require('../controllers/authController');
const users = require('../controllers/userController');
const conversations = require('../controllers/conversationController');
const messages = require('../controllers/messageController');
const notifications = require('../controllers/notificationController');
const calls = require('../controllers/callController');
const links = require('../controllers/linkController');

// ---- Auth
router.post('/auth/register', authLimiter, v.register, validate, auth.register);
router.post('/auth/login', authLimiter, v.login, validate, auth.login);
router.post('/auth/forgot-password', authLimiter, v.forgot, validate, auth.forgotPassword);
router.post('/auth/reset-password/:token', authLimiter, v.reset, validate, auth.resetPassword);
router.post('/auth/logout', protect, auth.logout);
router.get('/auth/me', protect, auth.me);

// ---- Users / profile / contacts
router.get('/users/search', protect, v.searchUsers, validate, users.searchUsers);
router.get('/users/online', protect, users.onlineUsers);
router.put('/users/me', protect, v.updateProfile, validate, users.updateProfile);
router.put('/users/me/password', protect, authLimiter, v.changePassword, validate, users.changePassword);
router.post('/users/me/avatar', protect, uploadAvatar, users.uploadAvatar);
router.get('/users/contacts', protect, users.listContacts);
router.post('/users/contacts/:id', protect, v.idParam, validate, users.addContact);
router.delete('/users/contacts/:id', protect, v.idParam, validate, users.removeContact);
router.get('/users/:id', protect, v.idParam, validate, users.getUser);

// ---- Conversations / messages
router.get('/conversations', protect, conversations.list);
router.get('/messages/search', protect, v.searchMessages, validate, messages.search);
router.get('/messages/with/:userId', protect, v.messageList, validate, messages.history);
router.get('/messages/:id', protect, v.idParam, validate, messages.getOne);
router.delete('/messages/:id', protect, v.deleteMessage, validate, messages.remove);

// ---- Notifications
router.get('/notifications', protect, notifications.list);
router.put('/notifications/read-all', protect, notifications.markAllRead);
router.put('/notifications/:id/read', protect, v.idParam, validate, notifications.markRead);

// ---- Calls
router.get('/calls/history', protect, calls.history);
router.get('/calls/ice-servers', protect, calls.iceServers);

// ---- Link previews
router.get('/links/preview', protect, previewLimiter, v.previewUrl, validate, links.preview);

module.exports = router;
