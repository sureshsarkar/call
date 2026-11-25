const mongoose = require('mongoose');

const groupReactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  emoji: { type: String, required: true, maxlength: 16 },
}, { _id: false });

const groupAttachmentSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  name: { type: String, required: true, maxlength: 200 },
  mimeType: { type: String, required: true, maxlength: 120 },
  size: { type: Number, required: true, min: 0 },
  type: { type: String, enum: ['image', 'video', 'audio', 'document'], required: true },
}, { _id: false });

const groupMessageSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, default: '', maxlength: 10000 },
  attachment: { type: groupAttachmentSchema, default: null },
  forwarded: { type: Boolean, default: false },
  reply_to_message_id: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupMessage', default: null },
  reactions: { type: [groupReactionSchema], default: [] },
  deliveredBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  editedAt: Date,
  deletedForEveryone: { type: Boolean, default: false },
}, { timestamps: true });

groupMessageSchema.index({ group: 1, createdAt: -1 });
groupMessageSchema.index({ group: 1, sender: 1, createdAt: -1 });
module.exports = mongoose.model('GroupMessage', groupMessageSchema);
