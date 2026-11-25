const mongoose = require('mongoose');

const groupReportSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  message: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupMessage', default: null },
  reason: { type: String, required: true, maxlength: 500 },
  status: { type: String, enum: ['open', 'reviewed', 'dismissed'], default: 'open', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: Date,
}, { timestamps: true });

groupReportSchema.index({ status: 1, createdAt: -1 });
module.exports = mongoose.model('GroupReport', groupReportSchema);
