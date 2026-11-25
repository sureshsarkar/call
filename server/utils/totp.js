const crypto = require('crypto');
const env = require('../config/env');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(buffer) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decodeBase32(text) {
  let bits = 0; let value = 0; const bytes = [];
  for (const char of String(text).toUpperCase().replace(/=+$/g, '')) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error('Invalid authenticator secret');
    value = (value << 5) | digit; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

const encryptionKey = () => crypto.createHash('sha256').update(env.twoFactorEncryptionKey).digest();

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptSecret(value) {
  const [iv, tag, encrypted] = String(value).split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function codeAt(secret, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, '0');
}

function verifyTotp(secret, code, now = Date.now()) {
  const provided = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(provided)) return false;
  const step = Math.floor(now / 30_000);
  return [-1, 0, 1].some((offset) => crypto.timingSafeEqual(Buffer.from(codeAt(secret, step + offset)), Buffer.from(provided)));
}

module.exports = { encodeBase32, encryptSecret, decryptSecret, verifyTotp };
