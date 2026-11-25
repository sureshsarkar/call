const { getRuntimeConfig } = require('../services/runtimeConfig');

/** Seconds a message lives (0 = forever). */
const ttlSeconds = () => Math.round(getRuntimeConfig().messageTtlHours * 3600);

/**
 * Oldest creation time that is still valid. Queries use it so expired data is invisible immediately,
 * even in the short window before MongoDB's background TTL job physically deletes it (it runs ~every 60s).
 */
const cutoff = () => (ttlSeconds() > 0 ? new Date(Date.now() - ttlSeconds() * 1000) : new Date(0));

module.exports = { ttlSeconds, cutoff };
