const mongoose = require('mongoose');

const systemEventSchema = new mongoose.Schema({
  status: { type: Number, required: true, index: true },
  method: { type: String, maxlength: 12, default: '' },
  path: { type: String, maxlength: 200, default: '' },
  message: { type: String, maxlength: 300, default: '' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

systemEventSchema.index({ createdAt: -1 });
module.exports = mongoose.model('SystemEvent', systemEventSchema);
