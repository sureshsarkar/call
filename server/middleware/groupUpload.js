const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');

const groupMediaDir = path.resolve(config.uploadDir, '.group-media');
fs.mkdirSync(groupMediaDir, { recursive: true });

const TYPES = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
  'application/pdf': '.pdf', 'text/plain': '.txt', 'text/csv': '.csv', 'application/zip': '.zip',
  'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

const uploadGroupFile = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, groupMediaDir),
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(24).toString('hex')),
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').split(';')[0].trim().toLowerCase();
    if (!TYPES[mime]) return cb(new ApiError(415, 'This file type is not supported'));
    file.pulseMime = mime;
    cb(null, true);
  },
}).single('file');

const typeForMime = (mime) => mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document';
const extensionForMime = (mime) => TYPES[mime];

module.exports = { uploadGroupFile, groupMediaDir, typeForMime, extensionForMime };
