const mongoose = require('mongoose');

const groupJoinRequestSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: Date,
}, { timestamps: true });

groupJoinRequestSchema.index({ group: 1, user: 1, status: 1 });
groupJoinRequestSchema.index({ group: 1, user: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
module.exports = mongoose.model('GroupJoinRequest', groupJoinRequestSchema);
