// getUserMedia / getDisplayMedia helpers, device enumeration and friendly error messages.

/** Audio processing constraints: echo cancellation, noise suppression, auto gain control. */
export function audioConstraints(deviceId) {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    voiceIsolation: true, // Chrome/Edge experimental ML voice isolation; ignored where unsupported
    channelCount: 1,
    ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
  };
}

export function videoConstraints({ deviceId, facingMode = 'user' } = {}) {
  return {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
    ...(deviceId ? { deviceId: { ideal: deviceId } } : { facingMode: { ideal: facingMode } }),
  };
}

export function mediaErrorMessage(err, what = 'camera/microphone') {
  if (!window.isSecureContext) return 'Calls require a secure (HTTPS) connection. Open the app over https:// or localhost.';
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return `Permission to use your ${what} was denied. Allow access in the browser address bar and try again.`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `No ${what} was found. Connect a device and try again.`;
    case 'NotReadableError':
    case 'TrackStartError':
      return `Your ${what} is being used by another application.`;
    case 'OverconstrainedError':
      return `The selected ${what} is not available.`;
    case 'AbortError':
      return `Could not start your ${what}.`;
    default:
      return err?.message || `Could not access your ${what}.`;
  }
}

/**
 * Acquires the microphone (and camera for video calls).
 * If the camera is missing/busy in a video call, falls back to audio-only instead of failing.
 */
export async function getCallMedia(type, prefs = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('Your browser does not support calls'), { name: 'NotSupported' });
  const audio = audioConstraints(prefs.micId);
  if (type !== 'video') return { stream: await navigator.mediaDevices.getUserMedia({ audio, video: false }), cameraMissing: false };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: videoConstraints({ deviceId: prefs.camId, facingMode: prefs.facing }) });
    return { stream, cameraMissing: false };
  } catch (err) {
    if (['NotFoundError', 'NotReadableError', 'OverconstrainedError', 'DevicesNotFoundError'].includes(err.name)) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      return { stream, cameraMissing: true, cameraError: err };
    }
    throw err;
  }
}

export async function listDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const pick = (kind) => all.filter((d) => d.kind === kind).map((d, i) => ({ id: d.deviceId, label: d.label || `${kind === 'audioinput' ? 'Microphone' : kind === 'audiooutput' ? 'Speaker' : 'Camera'} ${i + 1}` }));
    return { mics: pick('audioinput'), speakers: pick('audiooutput'), cams: pick('videoinput') };
  } catch {
    return { mics: [], speakers: [], cams: [] };
  }
}

export const canShareScreen = () => Boolean(navigator.mediaDevices?.getDisplayMedia);
export const canPickSpeaker = () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

export function screenErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError': return 'Screen sharing was cancelled or permission was denied.';
    case 'NotFoundError': return 'No screen or window available to share.';
    case 'NotReadableError': return 'Your screen could not be captured (it may be protected or in use).';
    case 'AbortError': return 'Screen sharing was interrupted.';
    case 'NotSupportedError': return 'Screen sharing is not supported on this device.';
    default: return err?.message || 'Could not start screen sharing.';
  }
}

export const stopStream = (s) => s?.getTracks().forEach((t) => t.stop());
