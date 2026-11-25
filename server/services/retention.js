const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Notification = require('../models/Notification');
const GroupMessage = require('../models/GroupMessage');
const { ttlSeconds, cutoff } = require('../utils/retention');
const { groupMediaDir } = require('../middleware/groupUpload');
const fs = require('fs');
const path = require('path');

let groupCleanupTimer = null;

/**
 * Auto-delete: MongoDB TTL indexes remove chat data a fixed time after it was created.
 *   messages       -> createdAt  (each message expires N hours after it was sent)
 *   conversations  -> updatedAt  (a chat disappears N hours after its last message)
 *   notifications  -> updatedAt  (previews contain message text, so they expire too)
 * Indexes are managed here (not in the schemas) so the lifetime can be changed or switched off with
 * MESSAGE_TTL_HOURS without index-conflict errors.
 */
async function ensureTtl(model, field) {
  const coll = model.collection;
  const name = `${field}_ttl`;
  const seconds = ttlSeconds();
  let existing = null;
  try { existing = (await coll.indexes()).find((i) => i.name === name); } catch { /* collection does not exist yet */ }

  if (seconds <= 0) {
    if (existing) await coll.dropIndex(name);
    return;
  }
  if (!existing) {
    await coll.createIndex({ [field]: 1 }, { name, expireAfterSeconds: seconds });
  } else if (existing.expireAfterSeconds !== seconds) {
    await model.db.db.command({ collMod: coll.collectionName, index: { name, expireAfterSeconds: seconds } });
  }
}

async function ensureRetention() {
  await Promise.all([ensureTtl(Message, 'createdAt'), ensureTtl(Conversation, 'updatedAt'), ensureTtl(Notification, 'updatedAt')]);
  await cleanupExpiredGroupMessages();
  if (!groupCleanupTimer) {
    groupCleanupTimer = setInterval(() => { void cleanupExpiredGroupMessages().catch((err) => console.error('[retention] group cleanup failed:', err.message)); }, 60_000);
    groupCleanupTimer.unref?.();
  }
  const s = ttlSeconds();
  console.log(s > 0 ? `[retention] chat data auto-deletes after ${s / 3600}h` : '[retention] auto-delete disabled');
}

async function cleanupExpiredGroupMessages() {
  if (ttlSeconds() <= 0) return;
  const expired = { createdAt: { $lt: cutoff() } };
  const rows = await GroupMessage.find({ ...expired, 'attachment.fileId': { $exists: true } }).select('attachment.fileId').lean();
  await Promise.all(rows.map((row) => fs.promises.unlink(path.join(groupMediaDir, path.basename(row.attachment.fileId))).catch(() => {})));
  await GroupMessage.deleteMany(expired);
}

module.exports = { ensureRetention };
