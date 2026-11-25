const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    title: String,
    description: String,
    image: String,
    siteName: String,
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reply_to_message_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    text: { type: String, default: '', maxlength: 10000 },
    links: [linkSchema],
    status: { type: String, enum: ['sent', 'delivered', 'seen'], default: 'sent' },
    deliveredAt: Date,
    seenAt: Date,
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    deletedForEveryone: { type: Boolean, default: false },
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, status: 1 });

module.exports = mongoose.model('Message', messageSchema);
