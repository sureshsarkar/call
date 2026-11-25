const crypto = require('crypto');
const { ice } = require('../config/env');

/**
 * Builds the RTCIceServer list for a user. Sources, in order (all that are configured are combined):
 *  1. STUN (public, free)                                        STUN_URLS
 *  2. Cloudflare Realtime TURN (managed, short-lived creds)      CF_TURN_KEY_ID + CF_TURN_API_TOKEN
 *  3. Your own coturn with time-limited HMAC credentials         TURN_URLS + TURN_SECRET
 *  4. Any TURN with static credentials (e.g. Metered)            TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL
 * TURN relays media when a direct peer-to-peer path is impossible (mobile carriers, strict NAT, corporate Wi-Fi).
 */

// One Cloudflare credential set is shared by all users and refreshed hourly, so the API is not hit per call.
// (Credentials live for CF_TURN_TTL seconds, far longer than the cache window, so a call never outlives them.)
let cfCache = null;
const CF_CACHE_MS = 60 * 60 * 1000;

async function cloudflareServers() {
  const { keyId, apiToken, ttl } = ice.cloudflare;
  if (!keyId || !apiToken) return [];
  if (cfCache && cfCache.expires > Date.now()) return cfCache.servers;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    const servers = list.filter((s) => s && s.urls);
    if (!servers.length) throw new Error('empty response');
    cfCache = { servers, expires: Date.now() + CF_CACHE_MS };
    return servers;
  } catch (err) {
    console.warn(`[ice] Cloudflare TURN unavailable: ${err.message}`);
    return cfCache?.servers || []; // stale credentials are still valid for hours: better than none
  }
}

function configuredTurnServers(userId) {
  const out = [];
  if (!ice.turnUrls.length) return out;
  if (ice.turnSecret) {
    const username = `${Math.floor(Date.now() / 1000) + ice.turnTtl}:${userId}`;
    const credential = crypto.createHmac('sha1', ice.turnSecret).update(username).digest('base64');
    out.push({ urls: ice.turnUrls, username, credential });
  } else if (ice.turnUsername) {
    out.push({ urls: ice.turnUrls, username: ice.turnUsername, credential: ice.turnCredential });
  }
  return out;
}

async function getIceServers(userId) {
  const servers = [];
  if (ice.stunUrls.length) servers.push({ urls: ice.stunUrls });
  servers.push(...(await cloudflareServers()));
  servers.push(...configuredTurnServers(userId));
  return servers;
}

const hasTurn = (servers) => servers.some((s) => [].concat(s.urls).some((u) => /^turns?:/i.test(u)));

module.exports = { getIceServers, hasTurn, _resetCache: () => { cfCache = null; } };
