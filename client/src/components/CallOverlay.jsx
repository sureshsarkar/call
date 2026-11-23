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

/** Self-view that can be dragged anywhere and snaps to the nearest screen corner (phones). */
function Pip({ children }) {
  const [corner, setCorner] = useState('tr');
  const [drag, setDrag] = useState(null);
  const ref = useRef(null);
  const start = useRef(null);
  const onDown = (e) => {
    const r = ref.current.getBoundingClientRect();
    start.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
    ref.current.setPointerCapture(e.pointerId);
    setDrag({ x: r.left, y: r.top });
  };
  const onMove = (e) => { if (start.current) setDrag({ x: e.clientX - start.current.dx, y: e.clientY - start.current.dy }); };
  const onUp = (e) => {
    const s = start.current;
    if (!s) return;
    start.current = null;
    const cx = e.clientX - s.dx + s.w / 2;
    const cy = e.clientY - s.dy + s.h / 2;
    setCorner((cy < window.innerHeight / 2 ? 't' : 'b') + (cx < window.innerWidth / 2 ? 'l' : 'r'));
    setDrag(null);
  };
  const pos = `${corner[0] === 't' ? 'top-[calc(env(safe-area-inset-top)+4.5rem)]' : 'bottom-40'} ${corner[1] === 'l' ? 'left-3' : 'right-3'}`;
  return (
    <div ref={ref} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      style={drag ? { left: drag.x, top: drag.y, right: 'auto', bottom: 'auto' } : undefined}
      className={`absolute z-20 h-36 w-24 touch-none overflow-hidden rounded-2xl border border-white/25 bg-black shadow-2xl sm:h-44 sm:w-32 md:h-52 md:w-40 ${drag ? '' : pos}`}>
      {children}
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
  const shareReady = shareSupported && s.status === 'connected';
  const shareLabel = s.sharing
    ? 'Stop share'
    : !window.isSecureContext
      ? 'Screen sharing requires HTTPS'
      : !shareSupported
        ? 'Screen sharing is unavailable in this browser'
        : s.status !== 'connected'
          ? 'Share screen when call is connected'
          : 'Share screen';
  const canFlip = isVideo && !s.noCamera && (s.devices.cams.length > 1 || /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent));
  const hasRemoteVideo = isVideo && (s.remoteStream?.getVideoTracks().length || 0) > 0 && !s.remoteCameraOff;

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
      {/* remote media is always mounted so audio keeps playing even if the camera is off */}
      {isVideo ? (
        <Media stream={s.remoteStream} className={`absolute inset-0 h-full w-full ${hasRemoteVideo ? '' : 'opacity-0'}`} contain={s.remoteSharing} />
      ) : (
        <Media stream={s.remoteStream} audioOnly />
      )}

      {!hasRemoteVideo && (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-[#16242b] to-[#0a0f12]">
          <div className="flex flex-col items-center gap-4">
            <div className={`rounded-full ${s.status === 'outgoing' ? 'ring-pulse' : ''}`}><Avatar user={s.peer} size={isVideo ? 120 : 150} /></div>
            <h2 className="text-2xl font-semibold">{s.peer?.name}</h2>
            <p className="text-white/70">{statusText}</p>
            {s.remoteMuted && s.status === 'connected' && <p className="flex items-center gap-1 text-sm text-white/60"><MicOff size={14} /> Muted</p>}
          </div>
        </div>
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
          {hasRemoteVideo && s.status === 'connected' && <span className="rounded-full bg-black/40 px-3 py-1 text-sm tabular-nums">{formatDuration(seconds)}</span>}
          {isVideo && document.fullscreenEnabled && <button onClick={toggleFull} className="btn-icon h-9 w-9" aria-label="Toggle fullscreen">{full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>}
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-2 px-4">
        {(s.status === 'reconnecting' || s.peerStatus === 'disconnected') && (
          <div className="flex items-center gap-2 rounded-full bg-amber-500/90 px-4 py-1.5 text-sm font-medium text-black"><WifiOff size={15} />{s.peerStatus === 'disconnected' ? `${s.peer?.name} lost connection — waiting…` : 'Connection unstable — reconnecting…'}</div>
        )}
        {s.remoteSharing && <div className="rounded-full bg-brand/90 px-4 py-1.5 text-sm font-medium text-bg">{s.peer?.name} is sharing their screen</div>}
        {s.sharing && <div className="rounded-full bg-brand/90 px-4 py-1.5 text-sm font-medium text-bg">You are sharing your screen</div>}
      </div>

      <div className="flex-1" />

      {isVideo && s.localStream && (
        <Pip>
          <Media stream={s.localStream} muted mirror={!s.sharing && s.facing === 'user'} contain={s.sharing} className={`pointer-events-none h-full w-full ${s.cameraOff && !s.sharing ? 'opacity-0' : ''}`} />
          {s.cameraOff && !s.sharing && <div className="absolute inset-0 grid place-items-center bg-panel2 text-white/70"><VideoOff size={22} /></div>}
        </Pip>
      )}

      <div className="relative z-30 mx-3 flex flex-wrap items-center justify-center gap-2.5 rounded-[2rem] bg-black/45 px-3 py-4 backdrop-blur-md sm:gap-5 md:mx-auto md:mb-6 md:max-w-xl" style={{ marginBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <CtrlBtn onClick={() => { vibrate(8); callManager.toggleMute(); }} active={s.muted} label={s.muted ? 'Unmute' : 'Mute'}>{s.muted ? <MicOff size={22} /> : <Mic size={22} />}</CtrlBtn>
        {isVideo && <CtrlBtn onClick={() => callManager.toggleCamera()} active={s.cameraOff} disabled={s.noCamera} label={s.cameraOff ? 'Camera on' : 'Camera off'}>{s.cameraOff || s.noCamera ? <VideoOff size={22} /> : <Video size={22} />}</CtrlBtn>}
        {canFlip && <CtrlBtn onClick={() => callManager.switchCamera()} label="Flip"><SwitchCamera size={22} /></CtrlBtn>}
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
