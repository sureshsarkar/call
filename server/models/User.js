const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, minlength: 2, maxlength: 50 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
    },
    username: { type: String, lowercase: true, trim: true, minlength: 3, maxlength: 30 },
    phone: { type: String, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    avatar: { type: String, default: '' },
    about: { type: String, maxlength: 140, default: 'Hey there! I am using Pulse.' },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    tokenVersion: { type: Number, default: 0, select: false },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.index({ name: 1 });
userSchema.index({ isOnline: 1 });
userSchema.index({ username: 1 }, { unique: true, sparse: true });
userSchema.index({ phone: 1 }, { unique: true, sparse: true });

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 11);
});

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.password);
};

/** Fields safe to show to other users. */
userSchema.methods.toPublic = function toPublic() {
  return {
    _id: this._id,
    name: this.name,
    username: this.username,
    avatar: this.avatar,
    about: this.about,
    isOnline: this.isOnline,
    lastSeen: this.lastSeen,
  };
};

/** Fields for the account owner. */
userSchema.methods.toSelf = function toSelf() {
  return { ...this.toPublic(), email: this.email, phone: this.phone, contacts: this.contacts, createdAt: this.createdAt };
};

module.exports = mongoose.model('User', userSchema);
