// Diagnoses whether calls can connect from this device/network, in particular whether a TURN relay works.
// It gathers ICE candidates against the same ICE servers calls use:
//   host  = local address (direct on the same Wi-Fi)
//   srflx = public address learnt via STUN (direct across the internet)
//   relay = allocated on a TURN server (needed on strict NATs / many mobile networks)
// A "relay" candidate only appears when the TURN server accepted our credentials, so it proves TURN works.

const typeOf = (c) => c.type || /typ (\w+)/.exec(c.candidate || '')?.[1] || 'unknown';

export const hasTurnUrl = (servers) => servers.some((s) => [].concat(s.urls).some((u) => /^turns?:/i.test(u)));

export async function testConnection(iceServers, { timeoutMs = 10000 } = {}) {
  const found = { host: 0, srflx: 0, relay: 0, relayProtocols: [] };
  const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 0 });
  pc.createDataChannel('probe');
  const done = new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const type = typeOf(e.candidate);
      if (type in found) found[type] += 1;
      if (type === 'relay') {
        const proto = /relay.*?(udp|tcp)/i.exec(e.candidate.candidate)?.[1] || e.candidate.protocol;
        if (proto && !found.relayProtocols.includes(proto)) found.relayProtocols.push(proto);
      }
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
    };
  });
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await done;
  } finally {
    pc.close();
  }
  return { ...found, turnConfigured: hasTurnUrl(iceServers) };
}

/** Plain-language verdict for the UI. */
export function interpret(r) {
  const lines = [];
  lines.push(r.srflx > 0
    ? { ok: true, text: 'Internet reachable — direct calls are possible.' }
    : { ok: false, text: 'Could not reach a STUN server. Your network may be blocking call traffic.' });
  if (!r.turnConfigured) {
    lines.push({ ok: false, text: 'No TURN relay is configured on the server. Calls between different networks (e.g. Wi-Fi ↔ mobile data) may fail.' });
  } else if (r.relay > 0) {
    lines.push({ ok: true, text: `TURN relay works (${r.relayProtocols.join('/') || 'ok'}). Calls will connect even on strict networks.` });
  } else {
    lines.push({ ok: false, text: 'A TURN relay is configured but did not respond. Check its credentials, or your network may block relay ports.' });
  }
  return lines;
}
