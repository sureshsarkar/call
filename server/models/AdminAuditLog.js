const mongoose = require('mongoose');

const adminAuditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true, maxlength: 80 },
  targetType: { type: String, default: '', maxlength: 40 },
  targetId: { type: String, default: '', maxlength: 80 },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: { type: String, default: '', maxlength: 64 },
}, { timestamps: true });

adminAuditLogSchema.index({ createdAt: -1 });
adminAuditLogSchema.index({ actor: 1, createdAt: -1 });
module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
