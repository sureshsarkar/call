const AppConfig = require('../models/AppConfig');
const env = require('../config/env');

const defaults = { appName: 'Pulse', maintenanceMode: false, messageTtlHours: env.messageTtlHours, maxMessageLength: 4000, callDurationLimitMinutes: 0, maxGroupMembers: 256, maxGroupFileSizeMb: 25, features: { chat: true, audioCalls: true, videoCalls: true, screenSharing: true, groupChat: true, fileSharing: true, pushNotifications: true, pwaInstall: true, registration: true, userVerification: false } };
let current = { ...defaults, features: { ...defaults.features } };

function applyRuntimeConfig(value) {
  if (!value) return current;
  current = { ...current, ...value, features: { ...current.features, ...(value.features || {}) } };
  return current;
}
async function loadRuntimeConfig() {
  const record = await AppConfig.findOne({ key: 'global' }).lean();
  return applyRuntimeConfig(record);
}
const getRuntimeConfig = () => current;
module.exports = { defaults, applyRuntimeConfig, loadRuntimeConfig, getRuntimeConfig };
