// Orchestrates a one-to-one WebRTC call. Socket.IO carries signaling only; media flows peer-to-peer
// (or through TURN when NAT blocks it). Implements the "perfect negotiation" pattern so that
// renegotiation (ICE restart, adding tracks) from either side never deadlocks on glare.
import toast from 'react-hot-toast';
import { getSocket, emitAck } from '../socket/socket';
import { callApi } from '../services/api';
import { useCallStore, resetCallStore } from '../context/callStore';
import { useGroupCallStore } from '../context/groupCallStore';
import { useAppConfigStore } from '../context/appConfigStore';
import { useSettingsStore } from '../context/settingsStore';
import { startRingtone, stopRingtone, playEnd } from '../utils/sounds';
import { systemNotify } from '../utils/notify';
import { formatDuration } from '../utils/format';
import {
  getCallMedia, mediaErrorMessage, screenErrorMessage, stopStream, listDevices,
  canShareScreen, audioConstraints, videoConstraints,
} from './media';
import { createRnnoisePipeline } from './audioProcessing';
import { classify, sampleFromStats, QualityController, VIDEO_PROFILES, AUDIO_PROFILE, effectiveVideoProfile } from './networkQuality';

const FALLBACK_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
// Slow-network tolerance: keep trying to recover for a long time instead of hanging up.
const RECONNECT_TIMEOUT_MS = 90_000; // give up only after this long without media
const CONNECT_TIMEOUT_MS = 75_000; // first connection on a very slow link can take a while
const DISCONNECT_GRACE_MS = 4_000; // ICE 'disconnected' is often transient: let it heal before restarting
const RESTART_EVERY_MS = 10_000; // repeated ICE restarts while the link is down
const STATS_EVERY_MS = 2_000; // network quality sampling
const set = (patch) => useCallStore.setState(patch);
const get = () => useCallStore.getState();

class CallManager {
  constructor() {
    this.resetInternals();
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', () => this.refreshDevices());
    }
    // browser-level connectivity: never hang up because the device went offline for a moment
    window.addEventListener('offline', () => { if (this.inCall) set({ networkOffline: true }); });
    window.addEventListener('online', () => {
      set({ networkOffline: false });
      if (!this.inCall) return;
      getSocket()?.connect(); // no-op when already connected
      try { this.pc?.restartIce(); } catch { /* closed */ } // re-gather candidates on the new network right away
    });
  }

  get inCall() { return ['connecting', 'connected', 'reconnecting'].includes(get().status); }

  resetInternals() {
    this.pc = null;
    this.iceServers = FALLBACK_ICE;
    this.polite = false;
    this.ready = false; // may we create offers yet?
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.pendingCandidates = [];
    this.rawStream = null; // microphone (+camera) as captured
    this.audioPipeline = null;
    this.sendAudioTrack = null;
    this.cameraTrack = null;
    this.screenStream = null;
    this.screenTrack = null;
    this.audioSender = null;
    this.videoSender = null;
    this.remoteStream = null;
    this.reconnectTimer = null;
    this.ending = false;
    this.switchingCamera = false;
    this.recoveryInterval = null;
    this.disconnectTimer = null;
    this.connectTimer = null;
    this.statsTimer = null;
    this.statTotals = null;
    this.qualityCtl = new QualityController();
    this.videoPausedByNetwork = false;
    this.onRelay = false; // media currently travels through a TURN relay (metered) -> data-saver video
    this.tuned = false;
  }

  get busy() { return get().status !== 'idle'; }

  // ------------------------------------------------------------------ media
  async refreshDevices() {
    set({ devices: await listDevices() });
  }

  /** Captures media; optionally routes the mic through the RNNoise pipeline. */
  async setupMedia(type) {
    const prefs = useSettingsStore.getState();
    const { stream, cameraMissing, cameraError } = await getCallMedia(type, { micId: prefs.micId, camId: prefs.camId, facing: get().facing });
    this.rawStream = stream;
    this.cameraTrack = stream.getVideoTracks()[0] || null;
    if (this.cameraTrack) this.cameraTrack.contentHint = 'motion';

    const micTrack = stream.getAudioTracks()[0];
    this.sendAudioTrack = micTrack;
    let advancedNoiseActive = false;
    if (prefs.advancedNoise) {
      try {
        this.audioPipeline = await createRnnoisePipeline(micTrack);
        this.sendAudioTrack = this.audioPipeline.track;
        advancedNoiseActive = true;
      } catch (err) {
        console.warn('[call] RNNoise unavailable, using browser noise suppression', err);
        toast('Advanced noise cancellation is unavailable here — using standard noise suppression.', { icon: 'ℹ️' });
      }
    }
    this.sendAudioTrack.contentHint = 'speech';

    if (cameraMissing) toast(mediaErrorMessage(cameraError, 'camera') + ' Continuing with audio only.', { icon: '📷' });
    set({
      localStream: this.cameraTrack ? new MediaStream([this.cameraTrack]) : null,
      noCamera: !this.cameraTrack && type === 'video',
      cameraOff: false,
      muted: false,
      advancedNoiseActive,
    });
    this.refreshDevices(); // labels become available after permission is granted
  }

  async loadIceServers() {
    try {
      const servers = await callApi.iceServers();
      this.iceServers = servers?.length ? servers : FALLBACK_ICE;
    } catch {
      this.iceServers = FALLBACK_ICE;
    }
  }

  // ------------------------------------------------------------------ peer connection
  createPeerConnection() {
    const socket = getSocket();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle', iceCandidatePoolSize: 2 });
    this.pc = pc;
    this.remoteStream = new MediaStream();

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket?.emit('ice_candidate', { callId: get().callId, candidate: candidate.toJSON() });
    };

    pc.ontrack = ({ track, streams }) => {
      // keep a single MediaStream and add tracks to it so <video> never needs re-binding
      (streams[0] ? streams[0].getTracks() : [track]).forEach((t) => {
        if (!this.remoteStream.getTracks().includes(t)) this.remoteStream.addTrack(t);
      });
      set({ remoteStream: this.remoteStream });
    };

    pc.onnegotiationneeded = async () => {
      if (!this.ready) return; // callee waits for the caller's first offer
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        socket?.emit('webrtc_offer', { callId: get().callId, description: pc.localDescription });
      } catch (err) {
        console.error('[call] negotiation failed', err);
      } finally {
        this.makingOffer = false;
      }
    };

    pc.oniceconnectionstatechange = () => this.onIceState(pc.iceConnectionState);

    // add outgoing tracks
    const stream = this.rawStream;
    this.audioSender = pc.addTrack(this.sendAudioTrack, stream);
    if (this.cameraTrack) this.videoSender = pc.addTrack(this.cameraTrack, stream);

    // never sit on "Connecting…" forever
    this.connectTimer = setTimeout(() => {
      const s = this.pc?.iceConnectionState;
      if (s !== 'connected' && s !== 'completed') this.end('connection_lost');
    }, CONNECT_TIMEOUT_MS);
  }

  onIceState(state) {
    const { status } = get();
    if (status === 'idle') return;
    if (state === 'connected' || state === 'completed') {
      this.stopRecovery();
      clearTimeout(this.connectTimer);
      set({ status: 'connected', connectedAt: get().connectedAt || Date.now(), networkOffline: false });
      if (!this.tuned) { this.tuned = true; this.tuneSenders(); }
      this.startQualityMonitor();
      return;
    }
    if (state === 'disconnected') {
      // frequently transient on mobile networks: show it, but give it a few seconds to heal by itself
      if (status === 'connected') set({ status: 'reconnecting' });
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = setTimeout(() => {
        if (this.pc?.iceConnectionState === 'disconnected') this.startRecovery();
      }, DISCONNECT_GRACE_MS);
    } else if (state === 'failed') {
      if (status === 'connected') set({ status: 'reconnecting' });
      this.startRecovery();
    }
  }

  /** Keep re-trying ICE every few seconds; hang up only if media never comes back within RECONNECT_TIMEOUT_MS. */
  startRecovery() {
    if (this.recoveryInterval) return;
    try { this.pc?.restartIce(); } catch { /* closed */ }
    this.recoveryInterval = setInterval(() => {
      const s = this.pc?.iceConnectionState;
      if (s === 'connected' || s === 'completed') { this.stopRecovery(); return; }
      try { this.pc?.restartIce(); } catch { /* closed */ }
    }, RESTART_EVERY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const s = this.pc?.iceConnectionState;
      if (s !== 'connected' && s !== 'completed') this.end('connection_lost');
    }, RECONNECT_TIMEOUT_MS);
  }

  stopRecovery() {
    clearInterval(this.recoveryInterval);
    this.recoveryInterval = null;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    clearTimeout(this.disconnectTimer);
  }

  // ------------------------------------------------------------------ adaptive quality
  async setSenderParams(sender, mutate) {
    if (!sender) return;
    try {
      const p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings.forEach(mutate);
      await sender.setParameters(p);
    } catch (err) {
      console.warn('[call] setParameters failed', err.message);
    }
  }

  /** Once, after the first negotiation: protect audio and put sane limits on video. */
  async tuneSenders() {
    await this.setSenderParams(this.audioSender, (e) => { e.maxBitrate = AUDIO_PROFILE.maxBitrate; e.networkPriority = 'high'; e.priority = 'high'; });
    if (this.videoSender) await this.applyVideoProfile('good');
  }

  async applyVideoProfile(level) {
    const prof = effectiveVideoProfile(level, this.onRelay); // adaptive level, further capped on a relay
    await this.setSenderParams(this.videoSender, (e) => {
      e.active = prof.active;
      e.maxBitrate = prof.maxBitrate;
      e.maxFramerate = prof.maxFramerate;
      e.scaleResolutionDownBy = prof.scaleResolutionDownBy;
    });
  }

  startQualityMonitor() {
    if (this.statsTimer || !this.pc) return;
    this.statTotals = null;
    this.qualityCtl.reset();
    this.statsTimer = setInterval(() => this.sampleQuality(), STATS_EVERY_MS);
  }

  stopQualityMonitor() {
    clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  async sampleQuality() {
    const pc = this.pc;
    if (!pc || pc.connectionState === 'closed' || get().status !== 'connected') return;
    try {
      const { sample, totals } = sampleFromStats(await pc.getStats(), this.statTotals);
      this.statTotals = totals;
      if (sample.relay !== this.onRelay) await this.onRelayChanged(sample.relay);
      // while video is paused the bandwidth estimate stops growing, so only rtt/loss decide when to resume
      const videoCall = get().type === 'video' && sample.hasVideo && !this.videoPausedByNetwork;
      const changed = this.qualityCtl.step(classify({ ...sample, hasVideo: videoCall }));
      if (get().quality !== this.qualityCtl.level) set({ quality: this.qualityCtl.level });
      if (changed) await this.applyQuality(changed);
    } catch (err) {
      console.warn('[call] stats failed', err.message);
    }
  }

  /** Call moved onto / off a TURN relay: relays are metered, so keep video lean while on one. */
  async onRelayChanged(onRelay) {
    this.onRelay = onRelay;
    set({ relay: onRelay });
    if (get().type !== 'video' || !this.videoSender || this.videoPausedByNetwork) return;
    await this.applyVideoProfile(this.qualityCtl.level);
    if (onRelay) toast('Using a relay connection — video quality is limited to save data', { icon: '📉', id: 'relay-saver' });
  }

  async applyQuality(level) {
    if (get().type !== 'video' || !this.videoSender) return;
    await this.applyVideoProfile(level);
    const paused = !VIDEO_PROFILES[level].active;
    if (paused !== this.videoPausedByNetwork) {
      this.videoPausedByNetwork = paused;
      set({ videoPaused: paused });
      this.broadcastMediaState(); // peer shows the avatar instead of a frozen frame
      toast(paused ? 'Weak connection — video paused so the call stays clear' : 'Connection improved — video resumed', { icon: paused ? '📶' : '✅', id: 'net-quality' });
    }
  }

  async flushCandidates() {
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of queued) {
      try { await this.pc.addIceCandidate(c); } catch (err) { if (!this.ignoreOffer) console.warn('[call] candidate', err); }
    }
  }

  // ------------------------------------------------------------------ public API: start / accept / reject / end
  async start(peer, type) {
    if (this.busy || useGroupCallStore.getState().phase !== 'idle') return toast.error('You are already in a call');
    if (!getSocket()?.connected) return toast.error('Not connected to the server. Please wait…');
    set({ status: 'outgoing', peer, type, isCaller: true, callId: null, connectedAt: null });
    this.resetInternals();
    try {
      await this.setupMedia(type);
    } catch (err) {
      toast.error(mediaErrorMessage(err));
      return this.cleanup();
    }
    if (get().status !== 'outgoing') { this.cleanup(); return undefined; } // cancelled while the camera started
    await this.loadIceServers();
    if (get().status !== 'outgoing') { this.cleanup(); return undefined; }

    const res = await emitAck('incoming_call', { to: peer._id, type });
    if (!res.ok) {
      toast.error(res.error || 'Could not place the call');
      return this.cleanup();
    }
    set({ callId: res.callId });
    this.polite = false; // caller is the impolite peer
    if (useSettingsStore.getState().sounds) startRingtone(false);
    return undefined;
  }

  async accept() {
    const { status, type, callId } = get();
    if (status !== 'incoming') return;
    stopRingtone();
    set({ status: 'connecting', isCaller: false });
    this.resetInternals();
    try {
      await this.setupMedia(type);
    } catch (err) {
      toast.error(mediaErrorMessage(err));
      getSocket()?.emit('reject_call', { callId });
      return this.cleanup();
    }
    await this.loadIceServers();
    this.polite = true; // callee is the polite peer
    this.ready = false;
    this.createPeerConnection();
    const res = await emitAck('accept_call', { callId });
    if (!res.ok) {
      toast.error(res.error || 'The call is no longer available');
      return this.cleanup();
    }
    return undefined;
  }

  reject() {
    const { callId, status } = get();
    if (status !== 'incoming') return;
    getSocket()?.emit('reject_call', { callId });
    this.cleanup();
  }

  /** Hang up (or cancel while ringing). */
  end(reason = 'ended') {
    const { callId, status, connectedAt } = get();
    if (status === 'idle' || this.ending) return;
    this.ending = true;
    if (callId) getSocket()?.emit('end_call', { callId });
    const dur = connectedAt ? ` · ${formatDuration((Date.now() - connectedAt) / 1000)}` : '';
    if (reason === 'connection_lost') toast.error('Call ended: connection lost');
    else if (status === 'connected' || status === 'reconnecting') toast(`Call ended${dur}`, { icon: '📞' });
    this.cleanup();
  }

  /** Release every resource: peer connection, tracks, audio graph, timers, ringtone. */
  cleanup() {
    stopRingtone();
    this.stopRecovery();
    this.stopQualityMonitor();
    clearTimeout(this.connectTimer);
    if (this.pc) {
      this.pc.onicecandidate = this.pc.ontrack = this.pc.onnegotiationneeded = this.pc.oniceconnectionstatechange = null;
      this.pc.getSenders().forEach((s) => { try { s.track && s.replaceTrack(null); } catch { /* ignore */ } });
      this.pc.close();
    }
    stopStream(this.rawStream);
    stopStream(this.screenStream);
    this.audioPipeline?.destroy();
    this.sendAudioTrack?.stop();
    this.cameraTrack?.stop();
    this.screenTrack?.stop();
    this.resetInternals();
    resetCallStore();
    window.dispatchEvent(new Event('pulse:call-ended'));
  }

  // ------------------------------------------------------------------ in-call controls
  toggleMute() {
    if (!this.sendAudioTrack) return;
    const muted = !get().muted;
    this.sendAudioTrack.enabled = !muted;
    set({ muted });
    this.broadcastMediaState();
  }

  toggleCamera() {
    if (!this.cameraTrack) return toast.error('No camera available');
    const cameraOff = !get().cameraOff;
    this.cameraTrack.enabled = !cameraOff;
    set({ cameraOff });
    this.broadcastMediaState();
  }

  broadcastMediaState() {
    const { callId, muted, cameraOff } = get();
    getSocket()?.emit('call_media_state', { callId, audio: !muted, video: !cameraOff && !this.videoPausedByNetwork });
  }

  /**
   * Front <-> back camera switch without touching the call: the video sender's track is replaced in place
   * (RTCRtpSender.replaceTrack), so there is no renegotiation and the audio track is never touched.
   */
  async switchCamera() {
    if (this.switchingCamera || !this.cameraTrack || get().type !== 'video') return;
    this.switchingCamera = true;
    set({ cameraSwitching: true });
    const current = get().facing;
    const target = current === 'user' ? 'environment' : 'user';
    const old = this.cameraTrack;
    let released = false;
    const open = async (facing, exact) => {
      const base = videoConstraints({ facingMode: facing });
      const video = exact ? { ...base, facingMode: { exact: facing } } : base;
      return (await navigator.mediaDevices.getUserMedia({ video })).getVideoTracks()[0];
    };
    try {
      let track;
      try {
        track = await open(target, true); // exact: a missing camera fails instead of silently returning the same one
      } catch (err) {
        if (!['NotReadableError', 'AbortError', 'TrackStartError'].includes(err.name)) throw err;
        // many phones cannot open two cameras at once -> release the current one, then retry
        old.stop();
        released = true;
        track = await open(target, true);
      }
      await this.swapCameraTrack(track);
      set({ facing: target });
    } catch (err) {
      if (released) {
        // we had to release the working camera: bring it back so the call keeps showing video
        try { await this.swapCameraTrack(await open(current, false)); } catch { toast.error('Camera could not be restored'); }
      }
      if (['OverconstrainedError', 'NotFoundError', 'DevicesNotFoundError'].includes(err.name)) {
        toast(target === 'environment' ? 'No back camera on this device' : 'No front camera on this device', { icon: '📷', id: 'no-cam' });
      } else {
        toast.error(mediaErrorMessage(err, 'camera'));
      }
    } finally {
      this.switchingCamera = false;
      set({ cameraSwitching: false });
    }
  }

  async changeCamera(deviceId) {
    useSettingsStore.getState().update({ camId: deviceId });
    if (!this.cameraTrack) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { ...videoConstraints({ deviceId }), deviceId: { exact: deviceId } } });
      await this.swapCameraTrack(s.getVideoTracks()[0]);
    } catch (err) {
      toast.error(mediaErrorMessage(err, 'camera'));
    }
  }

  async swapCameraTrack(newTrack) {
    newTrack.enabled = !get().cameraOff;
    newTrack.contentHint = 'motion';
    const old = this.cameraTrack;
    this.cameraTrack = newTrack;
    if (!get().sharing) {
      await this.videoSender?.replaceTrack(newTrack);
      set({ localStream: new MediaStream([newTrack]) });
    }
    old?.stop();
  }

  async changeMic(deviceId) {
    useSettingsStore.getState().update({ micId: deviceId });
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { ...audioConstraints(), deviceId: { exact: deviceId } } });
      const mic = s.getAudioTracks()[0];
      let outTrack = mic;
      const oldPipeline = this.audioPipeline;
      this.audioPipeline = null;
      if (get().advancedNoiseActive) {
        try { this.audioPipeline = await createRnnoisePipeline(mic); outTrack = this.audioPipeline.track; } catch { /* fall back to raw */ }
      }
      outTrack.enabled = !get().muted;
      outTrack.contentHint = 'speech';
      await this.audioSender?.replaceTrack(outTrack);
      this.rawStream?.getAudioTracks().forEach((t) => t.stop());
      oldPipeline?.destroy();
      this.sendAudioTrack = outTrack;
      this.rawStream = new MediaStream([mic, ...(this.rawStream?.getVideoTracks() || [])]);
    } catch (err) {
      toast.error(mediaErrorMessage(err, 'microphone'));
    }
  }

  changeSpeaker(deviceId) {
    useSettingsStore.getState().update({ speakerId: deviceId });
    window.dispatchEvent(new Event('pulse:speaker-changed'));
  }

  // ------------------------------------------------------------------ screen sharing
  async startScreenShare() {
    if (useAppConfigStore.getState().config.features.screenSharing === false) return toast.error('Screen sharing is disabled by the administrator');
    if (get().type !== 'video') return toast.error('Screen sharing is available in video calls');
    if (get().sharing) return undefined;
    if (!window.isSecureContext) return toast.error('Screen sharing requires a secure HTTPS connection.');
    if (!canShareScreen()) return toast.error('This browser does not provide screen capture. Try an updated supported browser; mobile screen sharing depends on OS/browser support.');
    if (!this.pc || !['connecting', 'connected', 'reconnecting'].includes(get().status)) return toast.error('Start or answer the video call before sharing your screen.');
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        // Keep constraints portable: cursor capture is desktop-only and can reject on mobile browsers.
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });
    } catch (err) {
      return toast.error(screenErrorMessage(err));
    }
    const track = stream.getVideoTracks()[0];
    if (!track) { stopStream(stream); return toast.error('The browser did not return a screen video track.'); }
    track.contentHint = 'detail'; // favor sharpness over frame rate for text
    try {
      if (this.videoSender) await this.videoSender.replaceTrack(track);
      else this.videoSender = this.pc.addTrack(track, stream); // camera-less video call: renegotiates
    } catch (err) {
      stopStream(stream);
      return toast.error(`Could not send your screen to the other participant: ${err.message || 'WebRTC track update failed'}`);
    }
    track.onended = () => this.stopScreenShare(); // user stopped capture from the browser / OS UI
    this.screenStream = stream;
    this.screenTrack = track;
    set({ sharing: true, localStream: new MediaStream([track]) });
    getSocket()?.emit('start_screen_share', { callId: get().callId });
    return undefined;
  }

  async stopScreenShare() {
    if (!get().sharing) return;
    const track = this.screenTrack;
    this.screenTrack = null;
    if (track) track.onended = null;
    try {
      if (this.cameraTrack && this.videoSender) await this.videoSender.replaceTrack(this.cameraTrack);
      else if (this.videoSender && this.pc) { this.pc.removeTrack(this.videoSender); this.videoSender = null; }
    } catch (err) { console.warn('[call] restoring camera failed', err); }
    stopStream(this.screenStream);
    this.screenStream = null;
    set({ sharing: false, localStream: this.cameraTrack ? new MediaStream([this.cameraTrack]) : null });
    getSocket()?.emit('stop_screen_share', { callId: get().callId });
  }

  async toggleScreenShare() {
    return get().sharing ? this.stopScreenShare() : this.startScreenShare();
  }

  // ------------------------------------------------------------------ socket event handlers
  bind(socket) {
    socket.on('incoming_call', ({ callId, type, from }) => {
      if (this.busy || useGroupCallStore.getState().phase !== 'idle') { socket.emit('reject_call', { callId }); return; }
      set({ status: 'incoming', callId, type, peer: from, isCaller: false, connectedAt: null, remoteSharing: false, remoteMuted: false, remoteCameraOff: false, peerStatus: 'ok' });
      if (useSettingsStore.getState().sounds) startRingtone(true);
      systemNotify(`Incoming ${type} call`, `${from.name} is calling you`, { tag: `call-${callId}` });
    });

    socket.on('accept_call', ({ callId }) => {
      if (callId !== get().callId || get().status !== 'outgoing') return;
      stopRingtone();
      set({ status: 'connecting' });
      this.ready = true;
      this.createPeerConnection(); // adding tracks fires negotiationneeded -> first offer
    });

    socket.on('reject_call', ({ callId }) => {
      if (callId !== get().callId) return;
      toast(`${get().peer?.name || 'User'} declined the call`, { icon: '🚫' });
      this.cleanup();
    });

    socket.on('end_call', ({ callId, reason }) => {
      if (callId !== get().callId) return;
      const { status, connectedAt, peer } = get();
      const dur = connectedAt ? ` · ${formatDuration((Date.now() - connectedAt) / 1000)}` : '';
      if (status === 'connected' || status === 'reconnecting') toast(`Call ended${dur}`, { icon: '📞' });
      else if (reason === 'no_answer') toast(`${peer?.name || 'User'} did not answer`, { icon: '⏰' });
      else if (reason === 'cancelled') toast(`Missed call from ${peer?.name || 'user'}`, { icon: '📵' });
      else if (reason === 'connection_lost') toast.error('Call ended: connection lost');
      else if (reason === 'rejected') toast(`${peer?.name || 'User'} declined the call`, { icon: '🚫' });
      if (useSettingsStore.getState().sounds) playEnd();
      this.ending = true;
      this.cleanup();
    });

    socket.on('call_handled', ({ callId }) => {
      if (callId === get().callId && get().status === 'incoming') this.cleanup(); // answered on another tab/device
    });

    socket.on('webrtc_offer', async ({ callId, description }) => {
      if (callId !== get().callId || !this.pc) return;
      const pc = this.pc;
      try {
        const collision = this.makingOffer || pc.signalingState !== 'stable';
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription(description); // polite peer implicitly rolls back its own offer
        this.ready = true;
        await this.flushCandidates();
        await pc.setLocalDescription();
        socket.emit('webrtc_answer', { callId, description: pc.localDescription });
      } catch (err) {
        console.error('[call] failed to handle offer', err);
      }
    });

    socket.on('webrtc_answer', async ({ callId, description }) => {
      if (callId !== get().callId || !this.pc) return;
      try {
        if (this.pc.signalingState === 'have-local-offer') {
          await this.pc.setRemoteDescription(description);
          await this.flushCandidates();
        }
      } catch (err) {
        console.error('[call] failed to handle answer', err);
      }
    });

    socket.on('ice_candidate', async ({ callId, candidate }) => {
      if (callId !== get().callId || !this.pc || !candidate) return;
      if (!this.pc.remoteDescription) { this.pendingCandidates.push(candidate); return; }
      try { await this.pc.addIceCandidate(candidate); } catch (err) { if (!this.ignoreOffer) console.warn('[call] candidate', err); }
    });

    socket.on('start_screen_share', ({ callId }) => callId === get().callId && set({ remoteSharing: true }));
    socket.on('stop_screen_share', ({ callId }) => callId === get().callId && set({ remoteSharing: false }));
    socket.on('call_media_state', ({ callId, audio, video }) => {
      if (callId === get().callId) set({ remoteMuted: !audio, remoteCameraOff: !video });
    });
    socket.on('call_peer_status', ({ callId, status }) => {
      if (callId === get().callId) set({ peerStatus: status === 'disconnected' ? 'disconnected' : 'ok' });
    });

    // Our own socket dropped and came back: verify the call still exists and kick ICE.
    // (uses the socket's own 'connect' event: the manager-level 'reconnect' fires before the socket is usable)
    socket.on('connect', async () => {
      const { callId, status } = get();
      const inCall = callId && status !== 'idle' && status !== 'incoming';
      // always report our call state so the server can drop ghost calls left over from a page reload
      const res = await emitAck('rejoin_call', { callId: inCall ? callId : null });
      if (!inCall) return;
      if (!res.ok) { toast('Call ended while you were offline', { icon: '📞' }); this.cleanup(); return; }
      const s = this.pc?.iceConnectionState;
      if (this.pc && s !== 'connected' && s !== 'completed') { try { this.pc.restartIce(); } catch { /* ignore */ } }
    });
  }
}

export const callManager = new CallManager();
if (import.meta.env.DEV) window.__callManager = callManager; // debugging aid in dev tools
export default callManager;
