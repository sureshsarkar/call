const crypto = require('crypto');
const { ice } = require('../config/env');

/**
 * Builds the RTCIceServer list for a user.
 * - STUN always.
 * - TURN with either static credentials or short-lived HMAC credentials
 *   (coturn `use-auth-secret` / `static-auth-secret`), which never expose a permanent password.
 */
function getIceServers(userId) {
  const servers = [];
  if (ice.stunUrls.length) servers.push({ urls: ice.stunUrls });

  if (ice.turnUrls.length) {
    if (ice.turnSecret) {
      const username = `${Math.floor(Date.now() / 1000) + ice.turnTtl}:${userId}`;
      const credential = crypto.createHmac('sha1', ice.turnSecret).update(username).digest('base64');
      servers.push({ urls: ice.turnUrls, username, credential });
    } else if (ice.turnUsername) {
      servers.push({ urls: ice.turnUrls, username: ice.turnUsername, credential: ice.turnCredential });
    }
  }
  return servers;
}

module.exports = { getIceServers };
