const mongoose = require('mongoose');

const adminRoleSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 40, unique: true },
  description: { type: String, maxlength: 200, default: '' },
  permissions: [{ type: String, required: true }],
  active: { type: Boolean, default: true },
  system: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('AdminRole', adminRoleSchema);
