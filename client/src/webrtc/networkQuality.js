// Network-quality classification + adaptive bitrate policy for a call.
// Pure functions / classes only (no DOM, no WebRTC objects) so the policy can be unit-tested in Node.
//
// Goal on slow or lossy links: NEVER drop the call. Audio is protected first; video quality is reduced step by
// step (bitrate -> frame rate -> resolution) and, as a last resort, paused until the link recovers.

export const LEVELS = ['good', 'fair', 'poor', 'critical'];
const rank = (l) => LEVELS.indexOf(l);

/** Video encoder limits per quality level. `active:false` = video paused (audio only). */
export const VIDEO_PROFILES = {
  good: { active: true, maxBitrate: 1_200_000, maxFramerate: 30, scaleResolutionDownBy: 1 },
  fair: { active: true, maxBitrate: 600_000, maxFramerate: 24, scaleResolutionDownBy: 1.5 },
  poor: { active: true, maxBitrate: 250_000, maxFramerate: 15, scaleResolutionDownBy: 2 },
  critical: { active: false, maxBitrate: 100_000, maxFramerate: 8, scaleResolutionDownBy: 4 },
};

/**
 * Data-saver cap while media travels through a TURN relay. Relays are metered (free plans have small monthly
 * quotas), so video is held to a low bitrate. Both directions pass through the relay, so this is roughly
 * 4x the per-stream rate in relay traffic: ~150 kbps video => roughly 300 MB per hour of video call.
 */
export const RELAY_VIDEO_CAP = { maxBitrate: 150_000, maxFramerate: 12, scaleResolutionDownBy: 2 };

/** The profile to actually apply: the adaptive-quality profile, further limited when on a relay. */
export function effectiveVideoProfile(level, onRelay) {
  const base = VIDEO_PROFILES[level];
  if (!onRelay || !base.active) return base;
  return {
    active: true,
    maxBitrate: Math.min(base.maxBitrate, RELAY_VIDEO_CAP.maxBitrate),
    maxFramerate: Math.min(base.maxFramerate, RELAY_VIDEO_CAP.maxFramerate),
    scaleResolutionDownBy: Math.max(base.scaleResolutionDownBy, RELAY_VIDEO_CAP.scaleResolutionDownBy),
  };
}

/** Audio is tiny (Opus ~24-32 kbps) and always kept at high priority. */
export const AUDIO_PROFILE = { maxBitrate: 32_000 };

/**
 * @param {{rttMs?:number, loss?:number, availKbps?:number|null}} sample
 *   rttMs: round-trip time, loss: fraction 0..1 (worst of in/out), availKbps: estimated outgoing bandwidth
 * @returns one of LEVELS
 */
export function classify({ rttMs = 0, loss = 0, availKbps = null, hasVideo = true } = {}) {
  let level = 'good';
  const worsen = (l) => { if (rank(l) > rank(level)) level = l; };
  if (loss > 0.2 || rttMs > 1200) worsen('critical');
  else if (loss > 0.1 || rttMs > 700) worsen('poor');
  else if (loss > 0.04 || rttMs > 350) worsen('fair');
  if (hasVideo && availKbps != null) {
    if (availKbps < 100) worsen('critical');
    else if (availKbps < 250) worsen('poor');
    else if (availKbps < 600) worsen('fair');
  }
  return level;
}

/**
 * Hysteresis so the picture does not flap: degrade quickly (2 bad samples), recover slowly (5 good samples,
 * one step at a time).
 */
export class QualityController {
  constructor({ degradeAfter = 2, recoverAfter = 5 } = {}) {
    this.level = 'good';
    this.degradeAfter = degradeAfter;
    this.recoverAfter = recoverAfter;
    this.worse = 0;
    this.better = 0;
  }

  /** @returns the new level if it changed, otherwise null */
  step(sampleLevel) {
    const diff = rank(sampleLevel) - rank(this.level);
    if (diff > 0) {
      this.better = 0;
      this.worse += 1;
      if (this.worse >= this.degradeAfter) {
        this.worse = 0;
        this.level = sampleLevel; // jump straight to the observed level
        return this.level;
      }
    } else if (diff < 0) {
      this.worse = 0;
      this.better += 1;
      if (this.better >= this.recoverAfter) {
        this.better = 0;
        this.level = LEVELS[rank(this.level) - 1]; // recover one step at a time
        return this.level;
      }
    } else {
      this.worse = 0;
      this.better = 0;
    }
    return null;
  }

  reset() { this.level = 'good'; this.worse = 0; this.better = 0; }
}

/**
 * Turns two consecutive RTCPeerConnection.getStats() reports into one sample.
 * @param {RTCStatsReport|Map} report current stats
 * @param {{lost:number, received:number}|null} prev totals from the previous call (for deltas)
 * @returns {{sample: object, totals: {lost:number, received:number}}}
 */
export function sampleFromStats(report, prev) {
  let rttMs = 0;
  let availKbps = null;
  let outLoss = 0;
  let lost = 0;
  let received = 0;
  let hasVideo = false;
  let pair = null;
  const candidates = {};
  report.forEach((s) => {
    if (s.type === 'local-candidate' || s.type === 'remote-candidate') candidates[s.id] = s;
    if (s.type === 'candidate-pair' && (s.nominated || s.selected) && s.state === 'succeeded') pair = s;
    if (s.type === 'candidate-pair' && (s.nominated || s.selected) && s.state === 'succeeded') {
      if (typeof s.currentRoundTripTime === 'number') rttMs = Math.max(rttMs, s.currentRoundTripTime * 1000);
      if (typeof s.availableOutgoingBitrate === 'number') availKbps = s.availableOutgoingBitrate / 1000;
    } else if (s.type === 'remote-inbound-rtp') {
      if (typeof s.fractionLost === 'number') outLoss = Math.max(outLoss, s.fractionLost);
      if (typeof s.roundTripTime === 'number') rttMs = Math.max(rttMs, s.roundTripTime * 1000);
    } else if (s.type === 'inbound-rtp') {
      lost += s.packetsLost || 0;
      received += s.packetsReceived || 0;
    } else if (s.type === 'outbound-rtp' && s.kind === 'video') {
      hasVideo = true;
    }
  });
  // media goes through a TURN relay if either end of the selected pair is a relay candidate
  const typeOfId = (id) => candidates[id]?.candidateType;
  const relay = Boolean(pair) && (typeOfId(pair.localCandidateId) === 'relay' || typeOfId(pair.remoteCandidateId) === 'relay');
  const dLost = prev ? Math.max(0, lost - prev.lost) : 0;
  const dRecv = prev ? Math.max(0, received - prev.received) : 0;
  const inLoss = dLost + dRecv > 20 ? dLost / (dLost + dRecv) : 0; // ignore tiny samples
  return { sample: { rttMs, loss: Math.max(outLoss, inLoss), availKbps, hasVideo, relay }, totals: { lost, received } };
}
