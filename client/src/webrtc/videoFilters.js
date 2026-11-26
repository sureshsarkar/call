export const VIDEO_FILTERS = [
  { id: 'none', label: 'None' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'grayscale', label: 'Grayscale' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'vintage', label: 'Vintage' },
];

const FILTER_STYLES = {
  warm: 'saturate(1.3) sepia(0.16) hue-rotate(-8deg)',
  cool: 'saturate(0.92) hue-rotate(12deg) brightness(1.04)',
  grayscale: 'grayscale(1)',
  sepia: 'sepia(0.85)',
  vintage: 'sepia(0.28) saturate(0.8) contrast(1.12) brightness(0.96)',
};

const FRAME_RATE = 24;
const MAX_DIMENSION = 960;
const FACE_MAX_DIMENSION = 640;

function supportsCanvasTrack() {
  try {
    if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false;
    if (typeof MediaStream === 'undefined' || typeof requestAnimationFrame !== 'function') return false;
    const canvas = document.createElement('canvas');
    return typeof canvas.captureStream === 'function' && Boolean(canvas.getContext('2d'));
  } catch {
    return false;
  }
}

export function supportsLiveVideoFilters() {
  if (!supportsCanvasTrack()) return false;
  try {
    return 'filter' in document.createElement('canvas').getContext('2d');
  } catch {
    return false;
  }
}

export function supportsFaceEffects() {
  return supportsCanvasTrack() && typeof WebAssembly !== 'undefined';
}

/** Creates a processed outgoing video track while leaving the camera source untouched. */
export async function createVideoFilterPipeline(sourceTrack, filterId = 'none', {
  faceEffectId = 'none',
  onPerformanceDegraded,
  onFaceEffectLoading,
  onFaceEffectError,
} = {}) {
  if (filterId !== 'none' && !FILTER_STYLES[filterId]) throw new Error('Choose a supported video filter.');
  if (!sourceTrack || sourceTrack.readyState !== 'live') throw new Error('Your camera is not available.');
  if (!supportsCanvasTrack()) throw new Error('Live video effects are not supported by this browser. The call can continue without an effect.');
  if (filterId !== 'none' && !supportsLiveVideoFilters()) throw new Error('Live color filters are not supported by this browser. The call can continue without a filter.');
  if (faceEffectId !== 'none' && !supportsFaceEffects()) throw new Error('Face effects are not supported by this browser. The call can continue without an effect.');

  const video = document.createElement('video');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!context) throw new Error('This browser cannot process live video. The call can continue without an effect.');
  const source = new MediaStream([sourceTrack]);
  let output = null;
  let frameHandle = 0;
  let running = true;
  let lastFrameAt = 0;
  let nextDetectionAt = 0;
  let performanceWindowStart = 0;
  let renderedFrames = 0;
  let slowWindows = 0;
  let slowDetections = 0;
  let performanceWarningSent = false;
  let metadataTimeout;
  let onMetadata;
  let onError;
  let tracker = null;
  let drawEffect = null;
  let landmarks = null;
  let activeEffect = faceEffectId;
  let activeFilter = filterId;
  let effectErrorSent = false;

  const closeTracker = () => {
    try { tracker?.close(); } catch { /* a tracker can already be closed after a runtime failure */ }
    tracker = null;
    landmarks = null;
  };
  const dispose = () => {
    running = false;
    cancelAnimationFrame(frameHandle);
    clearTimeout(metadataTimeout);
    if (onMetadata) video.removeEventListener('loadedmetadata', onMetadata);
    if (onError) video.removeEventListener('error', onError);
    closeTracker();
    output?.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    video.remove();
    canvas.width = 0;
    canvas.height = 0;
  };

  try {
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText = 'position:fixed;width:1px;height:1px;left:-2px;top:-2px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);

    const metadata = new Promise((resolve, reject) => {
      onMetadata = resolve;
      onError = () => reject(new Error('Could not read camera frames for the video effect.'));
      video.addEventListener('loadedmetadata', onMetadata, { once: true });
      video.addEventListener('error', onError, { once: true });
      metadataTimeout = setTimeout(() => reject(new Error('Camera video did not start in time.')), 5000);
    });
    video.srcObject = source;
    await video.play();
    if (!video.videoWidth) await metadata;
    clearTimeout(metadataTimeout);
    video.removeEventListener('loadedmetadata', onMetadata);
    video.removeEventListener('error', onError);
    onMetadata = null;
    onError = null;

    const maxDimension = faceEffectId === 'none' ? MAX_DIMENSION : FACE_MAX_DIMENSION;
    const scale = Math.min(1, maxDimension / video.videoWidth, maxDimension / video.videoHeight);
    canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(2, Math.round(video.videoHeight * scale));

    if (faceEffectId !== 'none') {
      onFaceEffectLoading?.(true);
      try {
        const { createFaceTracker, drawFaceEffect } = await import('./faceEffects');
        tracker = await createFaceTracker();
        drawEffect = drawFaceEffect;
      } finally {
        onFaceEffectLoading?.(false);
      }
    }

    output = canvas.captureStream(FRAME_RATE);
    const track = output.getVideoTracks()[0];
    if (!track) throw new Error('This browser could not create a processed video track.');
    track.contentHint = 'motion';

    const drawFrame = (time) => {
      if (!running) return;
      if (time - lastFrameAt >= 1000 / FRAME_RATE && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          context.save();
          try {
            context.filter = FILTER_STYLES[activeFilter] || 'none';
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
          } finally {
            context.restore();
          }
          lastFrameAt = time;
          renderedFrames += 1;

          if (activeEffect !== 'none' && tracker && time >= nextDetectionAt) {
            try {
              const detectionStarted = performance.now();
              landmarks = tracker.detect(video);
              slowDetections = performance.now() - detectionStarted > 180 ? slowDetections + 1 : 0;
              if (slowDetections >= 3 && !performanceWarningSent) {
                performanceWarningSent = true;
                onPerformanceDegraded?.({ faceEffectActive: true });
              }
            } catch (error) {
              landmarks = null;
              if (!effectErrorSent) {
                effectErrorSent = true;
                onFaceEffectError?.(error);
              }
            } finally {
              nextDetectionAt = performance.now() + 125; // track at ~8 fps and render the latest landmarks at 24 fps
            }
          }
          if (activeEffect !== 'none' && landmarks && drawEffect) {
            drawEffect(context, activeEffect, landmarks, canvas.width, canvas.height);
          }
        } catch (error) {
          console.warn('[call] processed video frame failed', error);
        }
      }
      if (!performanceWindowStart) performanceWindowStart = time;
      if (time - performanceWindowStart >= 3000) {
        const measuredFps = renderedFrames * 1000 / (time - performanceWindowStart);
        slowWindows = document.visibilityState === 'visible' && measuredFps < 12 ? slowWindows + 1 : 0;
        if (slowWindows >= 2 && !performanceWarningSent) {
          performanceWarningSent = true;
          onPerformanceDegraded?.({ faceEffectActive: activeEffect !== 'none' });
        }
        renderedFrames = 0;
        performanceWindowStart = time;
      }
      frameHandle = requestAnimationFrame(drawFrame);
    };
    frameHandle = requestAnimationFrame(drawFrame);

    return {
      track,
      setColorFilter(nextId) {
        if (nextId !== 'none' && !FILTER_STYLES[nextId]) throw new Error('Choose a supported video filter.');
        if (nextId !== 'none' && !supportsLiveVideoFilters()) throw new Error('Live color filters are not supported by this browser.');
        activeFilter = nextId;
      },
      async setFaceEffect(nextId) {
        if (nextId === activeEffect) return;
        if (nextId !== 'none') {
          if (!supportsFaceEffects()) throw new Error('Face effects are not supported by this browser. The call can continue without an effect.');
          onFaceEffectLoading?.(true);
          try {
            const { createFaceTracker, drawFaceEffect } = await import('./faceEffects');
            const nextTracker = await createFaceTracker();
            if (!running) {
              try { nextTracker.close(); } catch { /* call cleanup raced with model startup */ }
              return;
            }
            closeTracker();
            tracker = nextTracker;
            drawEffect = drawFaceEffect;
            effectErrorSent = false;
          } finally {
            onFaceEffectLoading?.(false);
          }
        } else {
          closeTracker();
        }
        activeEffect = nextId;
      },
      destroy: dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
