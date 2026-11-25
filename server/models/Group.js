const mongoose = require('mongoose');

const groupMemberSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
  joinedAt: { type: Date, default: Date.now },
  muted: { type: Boolean, default: false },
  lastReadAt: { type: Date, default: Date.now },
}, { _id: false });

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  description: { type: String, maxlength: 500, default: '' },
  avatar: { type: String, default: '' },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: { type: [groupMemberSchema], validate: [(v) => v.length >= 1, 'A group needs an active member'] },
  onlyAdminsCanEditInfo: { type: Boolean, default: true },
  approvalRequired: { type: Boolean, default: false },
  inviteCode: { type: String, unique: true, sparse: true, select: false },
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupMessage', default: null },
}, { timestamps: true });

groupSchema.index({ 'members.user': 1, updatedAt: -1 });
module.exports = mongoose.model('Group', groupSchema);
