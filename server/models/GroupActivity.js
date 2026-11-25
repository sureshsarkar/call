const mongoose = require('mongoose');

const groupActivitySchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true, maxlength: 60 },
  target: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

groupActivitySchema.index({ group: 1, createdAt: -1 });
module.exports = mongoose.model('GroupActivity', groupActivitySchema);
