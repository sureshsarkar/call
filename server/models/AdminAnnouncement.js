const mongoose = require('mongoose');

const adminAnnouncementSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  body: { type: String, required: true, trim: true, maxlength: 500 },
  audience: { type: String, enum: ['all', 'selected'], default: 'all' },
  recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

module.exports = mongoose.model('AdminAnnouncement', adminAnnouncementSchema);
