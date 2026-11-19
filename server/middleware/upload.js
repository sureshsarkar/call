const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');

const avatarDir = path.resolve(config.uploadDir, 'avatars');
fs.mkdirSync(avatarDir, { recursive: true });

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarDir),
  // never trust the client's filename: random name + extension derived from MIME type
  filename: (_req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}${EXT[file.mimetype]}`),
});

const uploadAvatar = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    EXT[file.mimetype] ? cb(null, true) : cb(new ApiError(415, 'Only JPG, PNG, WEBP or GIF images are allowed')),
}).single('avatar');

/** Verify the file's magic bytes match an image (the MIME header alone can be spoofed). */
function hasImageSignature(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  const hex = buf.toString('hex');
  return (
    hex.startsWith('ffd8ff') || // jpeg
    hex.startsWith('89504e470d0a1a0a') || // png
    buf.toString('ascii', 0, 4) === 'GIF8' ||
    (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
  );
}

module.exports = { uploadAvatar, hasImageSignature, avatarDir };
