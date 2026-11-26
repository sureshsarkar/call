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

export function supportsLiveVideoFilters() {
  try {
    if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false;
    if (typeof MediaStream === 'undefined' || typeof requestAnimationFrame !== 'function') return false;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    return typeof canvas.captureStream === 'function' && Boolean(context && 'filter' in context);
  } catch {
    return false;
  }
}

/** Creates a processed outgoing video track while leaving the camera source untouched. */
export async function createVideoFilterPipeline(sourceTrack, filterId, { onPerformanceDegraded } = {}) {
  const filter = FILTER_STYLES[filterId];
  if (!filter) throw new Error('Choose a supported video filter.');
  if (!sourceTrack || sourceTrack.readyState !== 'live') throw new Error('Your camera is not available.');
  if (!supportsLiveVideoFilters()) throw new Error('Live video filters are not supported by this browser. The call can continue without a filter.');

  const video = document.createElement('video');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!context || !('filter' in context)) throw new Error('This browser cannot apply live video filters. The call can continue without a filter.');
  const source = new MediaStream([sourceTrack]);
  let output = null;
  let frameHandle = 0;
  let running = true;
  let lastFrameAt = 0;
  let performanceWindowStart = 0;
  let renderedFrames = 0;
  let slowWindows = 0;
  let performanceWarningSent = false;
  let metadataTimeout;
  let onMetadata;
  let onError;

  const dispose = () => {
    running = false;
    cancelAnimationFrame(frameHandle);
    clearTimeout(metadataTimeout);
    if (onMetadata) video.removeEventListener('loadedmetadata', onMetadata);
    if (onError) video.removeEventListener('error', onError);
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
      onError = () => reject(new Error('Could not read camera frames for the video filter.'));
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

    const scale = Math.min(1, MAX_DIMENSION / video.videoWidth, MAX_DIMENSION / video.videoHeight);
    canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
    output = canvas.captureStream(FRAME_RATE);
    const track = output.getVideoTracks()[0];
    if (!track) throw new Error('This browser could not create a filtered video track.');
    track.contentHint = 'motion';

    const drawFrame = (time) => {
      if (!running) return;
      if (time - lastFrameAt >= 1000 / FRAME_RATE && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          context.filter = filter;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          lastFrameAt = time;
          renderedFrames += 1;
        } catch (error) {
          console.warn('[call] video filter frame failed', error);
        }
      }
      if (!performanceWindowStart) performanceWindowStart = time;
      if (time - performanceWindowStart >= 3000) {
        const measuredFps = renderedFrames * 1000 / (time - performanceWindowStart);
        slowWindows = document.visibilityState === 'visible' && measuredFps < 12 ? slowWindows + 1 : 0;
        if (slowWindows >= 2 && !performanceWarningSent) {
          performanceWarningSent = true;
          onPerformanceDegraded?.();
        }
        renderedFrames = 0;
        performanceWindowStart = time;
      }
      frameHandle = requestAnimationFrame(drawFrame);
    };
    frameHandle = requestAnimationFrame(drawFrame);

    return { track, destroy: dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
