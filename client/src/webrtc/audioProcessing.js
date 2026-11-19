// Optional advanced noise cancellation: RNNoise (recurrent-neural-network noise suppressor, compiled to WASM)
// running inside an AudioWorklet. Pipeline: mic -> RNNoise worklet -> MediaStreamDestination -> RTCPeerConnection.
// The browser's own echoCancellation / noiseSuppression / autoGainControl stay on (applied at capture time).
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseWasmSimdPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

let wasmPromise;
const loadWasm = () => (wasmPromise ??= loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseWasmSimdPath }));

export const rnnoiseSupported = () =>
  typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined' && (window.AudioContext || window.webkitAudioContext);

/**
 * @param {MediaStreamTrack} micTrack raw (browser-processed) microphone track
 * @returns {{track: MediaStreamTrack, destroy: () => void}}
 */
export async function createRnnoisePipeline(micTrack) {
  if (!rnnoiseSupported()) throw new Error('RNNoise is not supported in this browser');
  const ctx = new AudioContext({ sampleRate: 48000 }); // RNNoise requires 48 kHz
  try {
    const [wasmBinary] = await Promise.all([loadWasm(), ctx.audioWorklet.addModule(rnnoiseWorkletPath)]);
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createMediaStreamSource(new MediaStream([micTrack]));
    const node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
    const dest = ctx.createMediaStreamDestination();
    source.connect(node);
    node.connect(dest);
    const track = dest.stream.getAudioTracks()[0];
    return {
      track,
      destroy() {
        try { source.disconnect(); node.disconnect(); node.destroy(); } catch { /* already gone */ }
        track.stop();
        ctx.close().catch(() => {});
      },
    };
  } catch (err) {
    ctx.close().catch(() => {});
    wasmPromise = undefined;
    throw err;
  }
}
