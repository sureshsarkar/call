const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['message', 'missed_call'], required: true },
    callType: { type: String, enum: ['audio', 'video'] },
    body: { type: String, maxlength: 200, default: '' },
    count: { type: Number, default: 1 },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, read: 1, updatedAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
