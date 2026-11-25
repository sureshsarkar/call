const mongoose = require('mongoose');

const contentEntrySchema = new mongoose.Schema({
  kind: { type: String, enum: ['page', 'blog', 'faq', 'category', 'contact'], required: true, index: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  excerpt: { type: String, default: '', maxlength: 500 },
  body: { type: String, default: '', maxlength: 50000 },
  category: { type: String, default: '', maxlength: 80 },
  metaTitle: { type: String, default: '', maxlength: 160 },
  metaDescription: { type: String, default: '', maxlength: 320 },
  published: { type: Boolean, default: false, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

contentEntrySchema.index({ kind: 1, published: 1, updatedAt: -1 });
module.exports = mongoose.model('ContentEntry', contentEntrySchema);
