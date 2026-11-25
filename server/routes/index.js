const router = require('express').Router();
const { protect, requirePermission, requireSuperAdminTwoFactor } = require('../middleware/auth');
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
const push = require('../controllers/pushController');
const admin = require('../controllers/adminController');
const adminAuth = [protect, requireSuperAdminTwoFactor];

// ---- Auth
router.get('/app/config', admin.publicConfig);
router.get('/content', admin.publicContentList);
router.get('/content/:slug', admin.publicContentBySlug);
router.get('/admin/dashboard', ...adminAuth, requirePermission('dashboard.view'), admin.dashboard);
router.get('/admin/users', ...adminAuth, requirePermission('users.view'), admin.listUsers);
router.post('/admin/users', ...adminAuth, requirePermission('users.edit'), admin.createUser);
router.get('/admin/users/:id/activity', ...adminAuth, requirePermission('users.view'), v.idParam, validate, admin.userActivity);
router.put('/admin/users/:id', ...adminAuth, requirePermission('users.edit'), v.idParam, validate, admin.updateUser);
router.put('/admin/users/:id/status', ...adminAuth, requirePermission('users.suspend'), v.idParam, validate, admin.setUserStatus);
router.put('/admin/users/:id/role', ...adminAuth, requirePermission('roles.manage'), v.idParam, validate, admin.setUserRole);
router.post('/admin/users/:id/reset-password', ...adminAuth, requirePermission('users.reset_password'), v.idParam, validate, admin.resetUserPassword);
router.post('/admin/users/:id/revoke-sessions', ...adminAuth, requirePermission('users.reset_password'), v.idParam, validate, admin.revokeUserSessions);
router.delete('/admin/users/:id', ...adminAuth, requirePermission('users.delete'), v.idParam, validate, admin.deleteUser);
router.get('/admin/config', ...adminAuth, requirePermission('settings.view'), admin.getConfig);
router.put('/admin/config', ...adminAuth, requirePermission('settings.manage'), admin.updateConfig);
router.get('/admin/audit-logs', ...adminAuth, requirePermission('system.view'), admin.listAuditLogs);
router.get('/admin/reports', ...adminAuth, requirePermission('reports.view'), admin.reports);
router.get('/admin/roles', ...adminAuth, requirePermission('roles.manage'), admin.listRoles);
router.post('/admin/roles', ...adminAuth, requirePermission('roles.manage'), admin.createRole);
router.put('/admin/roles/:id', ...adminAuth, requirePermission('roles.manage'), v.idParam, validate, admin.updateRole);
router.delete('/admin/roles/:id', ...adminAuth, requirePermission('roles.manage'), v.idParam, validate, admin.deleteRole);
router.post('/admin/announcements', ...adminAuth, requirePermission('notifications.send'), admin.sendAnnouncement);
router.get('/admin/announcements', ...adminAuth, requirePermission('notifications.send'), admin.listAnnouncements);
router.get('/admin/content', ...adminAuth, requirePermission('content.manage'), admin.listContent);
router.post('/admin/content', ...adminAuth, requirePermission('content.manage'), admin.createContent);
router.put('/admin/content/:id', ...adminAuth, requirePermission('content.manage'), v.idParam, validate, admin.updateContent);
router.delete('/admin/content/:id', ...adminAuth, requirePermission('content.manage'), v.idParam, validate, admin.deleteContent);
router.get('/admin/security/2fa', protect, requirePermission('settings.view'), admin.twoFactorStatus);
router.post('/admin/security/2fa/setup', protect, requirePermission('settings.manage'), admin.setupTwoFactor);
router.post('/admin/security/2fa/enable', authLimiter, protect, requirePermission('settings.manage'), admin.enableTwoFactor);
router.post('/admin/security/2fa/disable', authLimiter, protect, requirePermission('settings.manage'), admin.disableTwoFactor);
router.get('/push/public-key', push.publicKey);
router.post('/push/delivery-ack', push.deliveryAck);
router.post('/push/subscribe', protect, push.subscribe);
router.delete('/push/subscribe', protect, push.unsubscribe);
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
router.delete('/messages/with/:userId', protect, v.userIdParam, validate, messages.clearChat);
router.get('/messages/:id', protect, v.idParam, validate, messages.getOne);
router.delete('/messages/:id', protect, v.deleteMessage, validate, messages.remove);

// ---- Notifications
router.get('/notifications', protect, notifications.list);
router.put('/notifications/read-all', protect, notifications.markAllRead);
router.delete('/notifications', protect, notifications.clearAll);
router.put('/notifications/:id/read', protect, v.idParam, validate, notifications.markRead);

// ---- Calls
router.get('/calls/history', protect, calls.history);
router.delete('/calls/history', protect, calls.clearHistory);
router.get('/calls/incoming/:id', protect, v.idParam, validate, calls.incoming);
router.get('/calls/ice-servers', protect, calls.iceServers);

// ---- Link previews
router.get('/links/preview', protect, previewLimiter, v.previewUrl, validate, links.preview);

module.exports = router;
