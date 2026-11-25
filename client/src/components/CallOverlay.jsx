import { useEffect, useRef, useState } from 'react';
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Phone, MonitorUp, MonitorOff, SwitchCamera, Settings2, Maximize2, Minimize2, WifiOff,
} from 'lucide-react';
import Avatar from './Avatar';
import { useCallStore } from '../context/callStore';
import { useSettingsStore } from '../context/settingsStore';
import { callManager } from '../webrtc/CallManager';
import { canShareScreen, canPickSpeaker } from '../webrtc/media';
import { rnnoiseSupported } from '../webrtc/audioProcessing';
import useCallTimer from '../hooks/useCallTimer';
import useWakeLock from '../hooks/useWakeLock';
import { vibrate } from '../utils/haptics';
import { formatDuration } from '../utils/format';

/** <video>/<audio> bound to a MediaStream, honoring the chosen speaker where supported. */
function Media({ stream, muted = false, audioOnly = false, className = '', contain = false, mirror = false }) {
  const ref = useRef(null);
  const speakerId = useSettingsStore((s) => s.speakerId);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream || null;
    if (stream) el.play?.().catch(() => {});
  }, [stream]);
  useEffect(() => {
    const el = ref.current;
    if (el && !muted && speakerId && canPickSpeaker()) el.setSinkId(speakerId).catch(() => {});
  }, [speakerId, muted, stream]);
  const Tag = audioOnly ? 'audio' : 'video';
  return <Tag ref={ref} autoPlay playsInline muted={muted} className={`${className} ${contain ? 'object-contain' : 'object-cover'} ${mirror ? '-scale-x-100' : ''}`} />;
}

/** 4-bar connection indicator: green = good, amber = fair/poor, red = critical. */
function SignalBars({ level }) {
  const bars = { good: 4, fair: 3, poor: 2, critical: 1 }[level] ?? 4;
  const color = level === 'good' ? 'bg-emerald-400' : level === 'critical' ? 'bg-red-500' : 'bg-amber-400';
  const label = { good: 'Good connection', fair: 'Fair connection', poor: 'Weak connection', critical: 'Very weak connection' }[level];
  return (
    <span className="flex h-5 items-end gap-[3px] rounded-full bg-black/40 px-2.5 py-1" title={label} aria-label={label}>
      {[1, 2, 3, 4].map((i) => <i key={i} className={`block w-[3px] rounded-sm ${i <= bars ? color : 'bg-white/25'}`} style={{ height: 4 + i * 3 }} />)}
    </span>
  );
}

function CtrlBtn({ onClick, active = false, danger = false, label, children, disabled }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
        className={`grid h-[3.25rem] w-[3.25rem] place-items-center rounded-full transition active:scale-90 disabled:opacity-40 sm:h-14 sm:w-14 ${danger ? 'bg-danger text-white hover:brightness-110' : active ? 'bg-white text-bg' : 'bg-white/15 text-white hover:bg-white/25'}`}>
        {children}
      </button>
      <span className="hidden text-[11px] text-white/70 sm:block">{label}</span>
    </div>
  );
}

function DeviceSelect({ label, value, list, onChange }) {
  return (
    <label className="block text-xs text-white/70">{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg bg-white/10 px-2 py-2 text-sm text-white outline-none">
        <option value="" className="text-black">System default</option>
        {list.map((d) => <option key={d.id} value={d.id} className="text-black">{d.label}</option>)}
      </select>
    </label>
  );
}

function DevicePanel({ onClose }) {
  const devices = useCallStore((s) => s.devices);
  const noiseActive = useCallStore((s) => s.advancedNoiseActive);
  const type = useCallStore((s) => s.type);
  const { micId, speakerId, camId, advancedNoise, update } = useSettingsStore();
  return (
    <>
    <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={onClose} />
    <div className="sheet-up-m pb-safe fixed inset-x-0 bottom-0 z-50 space-y-3 rounded-t-3xl bg-[#101a20] p-5 shadow-2xl md:pop-in md:absolute md:inset-x-auto md:bottom-32 md:left-1/2 md:w-[22rem] md:-translate-x-1/2 md:rounded-2xl md:bg-black/85 md:pb-4 md:backdrop-blur">
      <div className="mx-auto -mt-2 mb-1 h-1.5 w-10 rounded-full bg-white/20 md:hidden" />
      <div className="flex items-center justify-between"><p className="font-semibold">Audio &amp; video settings</p><button onClick={onClose} className="text-xs text-white/60 hover:text-white">Close</button></div>
      <DeviceSelect label="Microphone" value={micId} list={devices.mics} onChange={(v) => v && callManager.changeMic(v)} />
      {canPickSpeaker() && <DeviceSelect label="Speaker" value={speakerId} list={devices.speakers} onChange={(v) => callManager.changeSpeaker(v)} />}
      {type === 'video' && <DeviceSelect label="Camera" value={camId} list={devices.cams} onChange={(v) => v && callManager.changeCamera(v)} />}
      <div className="rounded-lg bg-white/10 p-3 text-xs text-white/80">
        <p>✔ Echo cancellation, noise suppression &amp; auto gain are on.</p>
        <p className="mt-1">{noiseActive ? '✔ Advanced AI noise cancellation (RNNoise) active.' : rnnoiseSupported() ? `AI noise cancellation is ${advancedNoise ? 'enabled for your next call' : 'off'}.` : 'AI noise cancellation not supported in this browser.'}</p>
        {rnnoiseSupported() && (
          <label className="mt-2 flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={advancedNoise} onChange={(e) => update({ advancedNoise: e.target.checked })} className="accent-emerald-500" />
            Use AI noise cancellation (next call)
          </label>
        )}
      </div>
    </div>
    </>
  );
}

function IncomingCall() {
  const { peer, type } = useCallStore();
  // ring the phone (Android) while the call is incoming
  useEffect(() => {
    vibrate([500, 250, 500]);
    const id = setInterval(() => vibrate([500, 250, 500]), 2200);
    return () => { clearInterval(id); try { navigator.vibrate?.(0); } catch { /* unsupported */ } };
  }, []);
  return (
    <div className="fixed inset-0 z-50 md:grid md:place-items-center md:bg-black/70 md:p-4 md:backdrop-blur-sm">
      <div className="fade-in flex h-full w-full flex-col items-center justify-between bg-gradient-to-b from-[#12323a] via-[#0e1d22] to-[#0a0f12] px-8 pb-[calc(env(safe-area-inset-bottom)+2.5rem)] pt-[calc(env(safe-area-inset-top)+3.5rem)] text-center md:pop-in md:h-auto md:max-w-sm md:rounded-3xl md:bg-panel2 md:bg-none md:p-8">
        <p className="text-sm uppercase tracking-[0.25em] text-brand">Incoming {type} call</p>
        <div className="flex flex-col items-center">
          <div className="mb-6 w-fit rounded-full ring-pulse"><Avatar user={peer} size={144} /></div>
          <h2 className="text-3xl font-semibold">{peer?.name}</h2>
          <p className="mt-2 text-mute">is calling you…</p>
        </div>
        <div className="flex w-full max-w-xs justify-between md:mt-8 md:max-w-none md:justify-center md:gap-10">
          <div className="flex flex-col items-center gap-2">
            <button onClick={() => callManager.reject()} aria-label="Decline" className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full bg-danger text-white shadow-lg transition active:scale-90 md:h-16 md:w-16"><PhoneOff size={30} /></button>
            <span className="text-sm text-mute">Decline</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button onClick={() => callManager.accept()} aria-label="Accept" className="ring-pulse grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full bg-brand text-white shadow-lg transition active:scale-90 md:h-16 md:w-16">{type === 'video' ? <Video size={30} /> : <Phone size={30} />}</button>
            <span className="text-sm text-mute">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActiveCall() {
  const s = useCallStore();
  const [panel, setPanel] = useState(false);
  const [full, setFull] = useState(false);
  const rootRef = useRef(null);
  const seconds = useCallTimer(s.connectedAt);
  useWakeLock(true); // keep the screen on during a call
  const isVideo = s.type === 'video';
  const shareSupported = canShareScreen();
  const shareReady = shareSupported && ['connecting', 'connected', 'reconnecting'].includes(s.status);
  const shareLabel = s.sharing
    ? 'Stop share'
    : !window.isSecureContext
      ? 'Screen sharing requires HTTPS'
      : !shareSupported
        ? 'Screen sharing is unavailable in this browser'
        : !['connecting', 'connected', 'reconnecting'].includes(s.status)
          ? 'Share screen when the call is active'
          : 'Share screen';
  const canFlip = isVideo && !s.noCamera && (s.devices.cams.length > 1 || /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent));
  const hasRemoteVideo = isVideo && (s.remoteStream?.getVideoTracks().length || 0) > 0 && !s.remoteCameraOff;

  // ---- WhatsApp-style layout: tap self-view to swap main/floating video, double-tap to flip the camera
  const localAvailable = isVideo && Boolean(s.localStream);
  const [swappedState, setSwapped] = useState(false);
  const swapped = swappedState && localAvailable; // my camera is the full-screen video
  const [corner, setCorner] = useState('tr'); // floating window corner: t/b + l/r
  const [drag, setDrag] = useState(null); // {x, y} while the floating window is being dragged
  const pipGesture = useRef(null);
  const tapRef = useRef({ time: 0, timer: null });
  const bgTapRef = useRef(0);
  const DOUBLE_MS = 280;

  const flipCamera = () => {
    if (!isVideo || s.noCamera) return;
    vibrate(10);
    callManager.switchCamera();
  };

  // single tap on the floating window = swap (delayed a moment so a double tap never also swaps); double tap = flip camera
  const registerPipTap = () => {
    const t = tapRef.current;
    const now = Date.now();
    if (t.timer && now - t.time < DOUBLE_MS) {
      clearTimeout(t.timer);
      t.timer = null;
      flipCamera();
      return;
    }
    t.time = now;
    t.timer = setTimeout(() => { t.timer = null; vibrate(6); setSwapped((v) => !v); }, DOUBLE_MS);
  };
  useEffect(() => () => clearTimeout(tapRef.current.timer), []);

  const onPipDown = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    pipGesture.current = { sx: e.clientX, sy: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPipMove = (e) => {
    const g = pipGesture.current;
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 8) g.moved = true; // below 8px it is a tap, not a drag
    if (g.moved) setDrag({ x: e.clientX - g.dx, y: e.clientY - g.dy });
  };
  const onPipUp = (e) => {
    const g = pipGesture.current;
    pipGesture.current = null;
    if (!g) return;
    if (!g.moved) { registerPipTap(); return; }
    const cx = e.clientX - g.dx + g.w / 2;
    const cy = e.clientY - g.dy + g.h / 2;
    setCorner((cy < window.innerHeight / 2 ? 't' : 'b') + (cx < window.innerWidth / 2 ? 'l' : 'r'));
    setDrag(null);
  };
  const onBackgroundUp = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const now = Date.now();
    if (now - bgTapRef.current < DOUBLE_MS) { bgTapRef.current = 0; flipCamera(); } else bgTapRef.current = now;
  };

  // geometry of the two video "slots"; both are animated with CSS transitions when they trade places
  const vw = window.innerWidth;
  const pipW = vw >= 768 ? 160 : vw >= 640 ? 128 : 96;
  const pipH = vw >= 768 ? 208 : vw >= 640 ? 176 : 144;
  const MAIN_STYLE = { left: 0, top: 0, width: '100%', height: '100%', borderRadius: 0 };
  const pipStyle = drag
    ? { left: drag.x, top: drag.y, width: pipW, height: pipH, borderRadius: 16 }
    : {
        width: pipW, height: pipH, borderRadius: 16,
        left: corner[1] === 'l' ? 12 : `calc(100% - ${pipW + 12}px)`,
        top: corner[0] === 't' ? 'calc(env(safe-area-inset-top) + 8rem)' : `calc(100% - ${pipH + 160}px)`,
      };
  const slotClass = (role) =>
    `absolute overflow-hidden bg-black ${role === 'pip' ? 'z-20 cursor-pointer touch-none select-none border border-white/25 shadow-2xl' : 'z-0'} ${role === 'pip' && drag ? '' : 'transition-[left,top,width,height,border-radius] duration-300 ease-out'}`;
  const remoteRole = swapped ? 'pip' : 'main';
  const localRole = swapped ? 'main' : 'pip';
  const pipHandlers = (role) => (role === 'pip' ? { onPointerDown: onPipDown, onPointerMove: onPipMove, onPointerUp: onPipUp, onPointerCancel: onPipUp } : {});

  const statusText = {
    outgoing: 'Calling…',
    connecting: 'Connecting…',
    connected: formatDuration(seconds),
    reconnecting: 'Reconnecting…',
  }[s.status];

  const toggleFull = () => {
    if (!document.fullscreenElement) rootRef.current?.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen();
  };
  useEffect(() => {
    const h = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  return (
    <div ref={rootRef} className="fixed inset-0 z-50 flex flex-col bg-[#0a0f12] text-white">
      {isVideo ? (
        <>
          {/* both video slots are always mounted: remote audio keeps playing even if a camera is off */}
          <div className={slotClass(remoteRole)} style={remoteRole === 'main' ? MAIN_STYLE : pipStyle} {...pipHandlers(remoteRole)}>
            <Media stream={s.remoteStream} className={`pointer-events-none h-full w-full ${hasRemoteVideo ? '' : 'opacity-0'}`} contain={s.remoteSharing && remoteRole === 'main'} />
            {!hasRemoteVideo && (remoteRole === 'main' ? (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-gradient-to-b from-[#16242b] to-[#0a0f12]">
                <div className="flex flex-col items-center gap-4">
                  <div className={`rounded-full ${s.status === 'outgoing' ? 'ring-pulse' : ''}`}><Avatar user={s.peer} size={120} /></div>
                  <h2 className="text-2xl font-semibold">{s.peer?.name}</h2>
                  <p className="text-white/70">{statusText}</p>
                  {s.remoteMuted && s.status === 'connected' && <p className="flex items-center gap-1 text-sm text-white/60"><MicOff size={14} /> Muted</p>}
                </div>
              </div>
            ) : (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-panel2"><Avatar user={s.peer} size={52} /></div>
            ))}
          </div>

          {localAvailable && (
            <div className={slotClass(localRole)} style={localRole === 'main' ? MAIN_STYLE : pipStyle} {...pipHandlers(localRole)}>
              <Media stream={s.localStream} muted mirror={!s.sharing && s.facing === 'user'} contain={s.sharing && localRole === 'main'} className={`pointer-events-none h-full w-full ${s.cameraOff && !s.sharing ? 'opacity-0' : ''}`} />
              {s.cameraOff && !s.sharing && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center bg-panel2 text-white/70">
                  <span className="flex flex-col items-center gap-2"><VideoOff size={localRole === 'main' ? 34 : 22} />{localRole === 'main' && <span className="text-sm">Your camera is off</span>}</span>
                </div>
              )}
              {s.cameraSwitching && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40"><span className="h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white" /></div>}
            </div>
          )}

          {/* transparent layer under the controls: double-tap / double-click anywhere = flip camera */}
          <div className="absolute inset-0 z-[1] select-none" onPointerUp={onBackgroundUp} />
        </>
      ) : (
        <>
          <Media stream={s.remoteStream} audioOnly />
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-[#16242b] to-[#0a0f12]">
            <div className="flex flex-col items-center gap-4">
              <div className={`rounded-full ${s.status === 'outgoing' ? 'ring-pulse' : ''}`}><Avatar user={s.peer} size={150} /></div>
              <h2 className="text-2xl font-semibold">{s.peer?.name}</h2>
              <p className="text-white/70">{statusText}</p>
              {s.remoteMuted && s.status === 'connected' && <p className="flex items-center gap-1 text-sm text-white/60"><MicOff size={14} /> Muted</p>}
            </div>
          </div>
        </>
      )}

      <div className="relative z-10 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-3 sm:p-4" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-3">
          <Avatar user={s.peer} size={36} />
          <div>
            <p className="text-sm font-semibold leading-tight">{s.peer?.name}</p>
            <p className="text-xs text-white/70">{isVideo ? 'Video call' : 'Audio call'}{s.advancedNoiseActive ? ' · AI noise cancel' : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {s.status === 'connected' && s.relay && isVideo && <span className="rounded-full bg-black/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-300" title="Using a relay server — video quality is limited to save data">Relay</span>}
          {s.status === 'connected' && <SignalBars level={s.quality} />}
          {hasRemoteVideo && s.status === 'connected' && <span className="rounded-full bg-black/40 px-3 py-1 text-sm tabular-nums">{formatDuration(seconds)}</span>}
          {isVideo && document.fullscreenEnabled && <button onClick={toggleFull} className="btn-icon h-9 w-9" aria-label="Toggle fullscreen">{full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>}
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-2 px-4">
        {(s.networkOffline || s.status === 'reconnecting' || s.peerStatus === 'disconnected') && (
          <div className="flex items-center gap-2 rounded-full bg-amber-500/90 px-4 py-1.5 text-sm font-medium text-black"><WifiOff size={15} />{s.networkOffline ? 'You are offline — the call will resume when internet returns' : s.peerStatus === 'disconnected' ? `${s.peer?.name} lost connection — waiting…` : 'Connection unstable — reconnecting…'}</div>
        )}
        {s.videoPaused && !s.networkOffline && s.status === 'connected' && (
          <div className="rounded-full bg-black/60 px-4 py-1.5 text-center text-xs font-medium text-amber-300">Weak connection — video paused</div>
        )}
        {!s.videoPaused && ['poor', 'critical'].includes(s.quality) && s.status === 'connected' && !s.networkOffline && (
          <div className="rounded-full bg-black/50 px-4 py-1.5 text-xs text-amber-200">Weak connection — lowering video quality</div>
        )}
        {s.remoteSharing && <div className="rounded-full bg-brand/90 px-4 py-1.5 text-sm font-medium text-bg">{s.peer?.name} is sharing their screen</div>}
        {s.sharing && <div className="rounded-full bg-brand/90 px-4 py-1.5 text-sm font-medium text-bg">You are sharing your screen</div>}
      </div>

      <div className="flex-1" />

      <div className="relative z-30 mx-3 flex flex-wrap items-center justify-center gap-2.5 rounded-[2rem] bg-black/45 px-3 py-4 backdrop-blur-md sm:gap-5 md:mx-auto md:mb-6 md:max-w-xl" style={{ marginBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <CtrlBtn onClick={() => { vibrate(8); callManager.toggleMute(); }} active={s.muted} label={s.muted ? 'Unmute' : 'Mute'}>{s.muted ? <MicOff size={22} /> : <Mic size={22} />}</CtrlBtn>
        {isVideo && <CtrlBtn onClick={() => callManager.toggleCamera()} active={s.cameraOff} disabled={s.noCamera} label={s.cameraOff ? 'Camera on' : 'Camera off'}>{s.cameraOff || s.noCamera ? <VideoOff size={22} /> : <Video size={22} />}</CtrlBtn>}
        {canFlip && <CtrlBtn onClick={flipCamera} label="Flip"><SwitchCamera size={22} /></CtrlBtn>}
        {isVideo && <CtrlBtn onClick={() => callManager.toggleScreenShare()} active={s.sharing} disabled={!s.sharing && !shareReady} label={shareLabel}>{s.sharing ? <MonitorOff size={22} /> : <MonitorUp size={22} />}</CtrlBtn>}
        <CtrlBtn onClick={() => setPanel((v) => !v)} active={panel} label="Devices"><Settings2 size={22} /></CtrlBtn>
        <CtrlBtn onClick={() => { vibrate(20); callManager.end(); }} danger label={s.status === 'outgoing' ? 'Cancel' : 'End'}><PhoneOff size={24} /></CtrlBtn>
      </div>
      {panel && <DevicePanel onClose={() => setPanel(false)} />}
    </div>
  );
}

export default function CallOverlay() {
  const status = useCallStore((s) => s.status);
  if (status === 'idle') return null;
  return status === 'incoming' ? <IncomingCall /> : <ActiveCall />;
}
