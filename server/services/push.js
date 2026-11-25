const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const config = require('../config/env');

let configured = false;
function ready() {
  if (!config.vapidPublicKey || !config.vapidPrivateKey) return false;
  if (!configured) {
    webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
    configured = true;
  }
  return true;
}

async function sendPush(userId, payload) {
  if (!ready()) return;
  const rows = await PushSubscription.find({ user: userId }).lean();
  await Promise.all(rows.map(async (row) => {
    try {
      const receipt = payload.kind === 'message' ? { messageId: payload.messageId, ackUrl: row.ackUrl } : {};
      await webpush.sendNotification({ endpoint: row.endpoint, keys: row.keys }, JSON.stringify({ ...payload, ...receipt }), { TTL: payload.kind === 'call' ? 60 : 86400, urgency: payload.kind === 'call' ? 'high' : 'normal' });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) await PushSubscription.deleteOne({ _id: row._id });
      else console.error('[push] delivery failed', err.statusCode || err.message);
    }
  }));
}

module.exports = { ready, sendPush };
