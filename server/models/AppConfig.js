const mongoose = require('mongoose');

const appConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },
  appName: { type: String, default: 'Pulse', maxlength: 60 },
  maintenanceMode: { type: Boolean, default: false },
  messageTtlHours: { type: Number, min: 0, max: 8760, default: 24 },
  maxMessageLength: { type: Number, min: 1, max: 10000, default: 4000 },
  callDurationLimitMinutes: { type: Number, min: 0, max: 1440, default: 0 },
  features: {
    chat: { type: Boolean, default: true },
    audioCalls: { type: Boolean, default: true },
    videoCalls: { type: Boolean, default: true },
    screenSharing: { type: Boolean, default: true },
    groupChat: { type: Boolean, default: false },
    fileSharing: { type: Boolean, default: false },
    pushNotifications: { type: Boolean, default: true },
    pwaInstall: { type: Boolean, default: true },
    registration: { type: Boolean, default: true },
    userVerification: { type: Boolean, default: false },
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('AppConfig', appConfigSchema);
