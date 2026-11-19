const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      validate: [(v) => v.length === 2, 'A conversation must have exactly 2 participants'],
      required: true,
    },
    // sorted "idA_idB" — guarantees exactly one conversation per pair
    participantsKey: { type: String, required: true, unique: true },
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1, updatedAt: -1 });

conversationSchema.statics.keyFor = (a, b) => [String(a), String(b)].sort().join('_');

conversationSchema.statics.findOrCreate = function findOrCreate(a, b) {
  const participantsKey = this.keyFor(a, b);
  return this.findOneAndUpdate(
    { participantsKey },
    { $setOnInsert: { participants: [a, b], participantsKey } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
};

module.exports = mongoose.model('Conversation', conversationSchema);
