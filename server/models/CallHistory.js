const mongoose = require('mongoose');

const callHistorySchema = new mongoose.Schema(
  {
    caller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    callee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['audio', 'video'], required: true },
    status: {
      type: String,
      enum: ['ringing', 'answered', 'completed', 'missed', 'rejected', 'cancelled', 'busy', 'failed'],
      default: 'ringing',
    },
    startedAt: { type: Date, default: Date.now },
    answeredAt: Date,
    endedAt: Date,
    duration: { type: Number, default: 0 }, // seconds of connected time
  },
  { timestamps: true }
);

callHistorySchema.index({ caller: 1, startedAt: -1 });
callHistorySchema.index({ callee: 1, startedAt: -1 });

module.exports = mongoose.model('CallHistory', callHistorySchema);
