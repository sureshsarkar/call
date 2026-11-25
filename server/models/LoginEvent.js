const mongoose = require('mongoose');

const loginEventSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  ip: { type: String, default: '', maxlength: 64 },
  userAgent: { type: String, default: '', maxlength: 300 },
  success: { type: Boolean, default: true },
}, { timestamps: true });
loginEventSchema.index({ createdAt: -1 });
module.exports = mongoose.model('LoginEvent', loginEventSchema);
