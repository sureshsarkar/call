import { useEffect, useRef } from 'react';
import { Mic, MicOff, PhoneOff, Video, VideoOff, Wifi } from 'lucide-react';
import Avatar from './Avatar';
import { useAuthStore } from '../context/authStore';
import { useGroupCallStore } from '../context/groupCallStore';
import { groupCallManager } from '../webrtc/GroupCallManager';

function MediaView({ stream, muted = false, className = '' }) {
  const video = useRef(null);
  useEffect(() => {
    const node = video.current;
    if (!node || node.srcObject === stream) return;
    node.srcObject = stream || null;
    if (stream) void node.play().catch(() => {});
    return () => { if (node.srcObject === stream) node.srcObject = null; };
  }, [stream]);
  return <video ref={video} autoPlay playsInline muted={muted} className={className} />;
}

function Control({ label, active, danger, onClick, children }) {
  return <button aria-label={label} title={label} onClick={onClick} className={`grid h-14 w-14 place-items-center rounded-full text-white shadow-lg transition ${danger ? 'bg-red-600 hover:bg-red-500' : active ? 'bg-white/20 hover:bg-white/30' : 'bg-white/10 hover:bg-white/20'}`}>{children}</button>;
}

export default function GroupCallOverlay() {
  const call = useGroupCallStore();
  const me = useAuthStore((state) => state.user);
  if (call.phase === 'idle') return null;

  if (call.phase === 'incoming') return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
    <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-panel2 p-6 text-center text-ink shadow-2xl">
      <Avatar user={{ name: call.groupName, avatar: null }} size={76} />
      <p className="mt-4 text-lg font-semibold">{call.caller?.name || 'A member'} is starting a group {call.type} call</p>
      <p className="mt-1 text-sm text-mute">{call.groupName}</p>
      <div className="mt-7 flex justify-center gap-8">
        <button onClick={() => groupCallManager.reject()} className="grid h-14 w-14 place-items-center rounded-full bg-red-600 text-white" aria-label="Decline call"><PhoneOff /></button>
        <button onClick={() => void groupCallManager.accept()} className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-white" aria-label="Join call">{call.type === 'video' ? <Video /> : <Mic />}</button>
      </div>
    </div>
  </div>;

  const remoteParticipants = call.participants.filter((participant) => String(participant._id || participant) !== String(me?._id));
  const connectedCount = Object.keys(call.remoteStreams).length;
  const stateLabel = call.phase === 'outgoing' ? 'Calling group…' : call.phase === 'connecting' ? 'Connecting…' : `${connectedCount + 1} in call`;
  const video = call.type === 'video';

  return <div className="fixed inset-0 z-[100] flex flex-col bg-[#101820] text-white" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
    <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
      <div className="min-w-0"><p className="truncate text-base font-semibold">{call.groupName || 'Group call'}</p><p className="flex items-center gap-1.5 text-xs text-white/65"><Wifi size={13} />{stateLabel} · {remoteParticipants.length + 1}/{call.maxParticipants}</p></div>
      <button onClick={() => groupCallManager.end()} className="rounded-full bg-white/10 px-3 py-2 text-sm text-white/80">Leave</button>
    </div>

    <div className={`relative min-h-0 flex-1 overflow-auto p-2 md:p-4 ${video ? 'grid auto-rows-fr grid-cols-2 gap-2 md:grid-cols-3 md:gap-3' : 'flex flex-col items-center justify-center gap-3'}`}>
      {remoteParticipants.map((participant) => {
        const id = String(participant._id || participant);
        const stream = call.remoteStreams[id];
        const hasVideo = stream?.getVideoTracks().some((track) => track.readyState === 'live');
        return <div key={id} className={`${video ? 'relative min-h-44 overflow-hidden rounded-2xl bg-[#202c33]' : 'flex w-full max-w-lg items-center gap-3 rounded-2xl bg-white/5 p-3'}`}>
          {stream && <MediaView stream={stream} className={video && hasVideo ? 'absolute inset-0 h-full w-full object-cover' : 'absolute h-px w-px opacity-0'} />}
          {(!video || !hasVideo) && <div className={`${video ? 'absolute inset-0' : ''} grid place-items-center`}><Avatar user={participant} size={video ? 72 : 42} /></div>}
          {!video && <span className="relative z-10 truncate text-sm font-medium">{participant.name || 'Member'}</span>}
          {video && <div className="absolute inset-x-0 bottom-0 z-10 truncate bg-gradient-to-t from-black/75 to-transparent px-3 pb-2 pt-5 text-sm font-medium">{participant.name || 'Member'}</div>}
        </div>;
      })}
      {call.phase === 'outgoing' && <div className="col-span-full flex flex-col items-center justify-center gap-3 text-center text-white/70"><Avatar user={{ name: call.groupName }} size={76} /><p>Ringing group members…</p></div>}
      {call.phase !== 'outgoing' && !remoteParticipants.length && <div className="col-span-full flex flex-col items-center justify-center gap-3 text-center text-white/70"><Avatar user={{ name: call.groupName }} size={76} /><p>Waiting for group members to join…</p></div>}
      {video && call.localStream && <div className="absolute bottom-4 right-4 z-20 h-28 w-20 overflow-hidden rounded-xl bg-[#202c33] shadow-xl md:bottom-6 md:right-6 md:h-40 md:w-28">
        {call.localStream.getVideoTracks().length && !call.cameraOff ? <MediaView stream={call.localStream} muted className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><Avatar user={me} size={42} /></div>}
        <span className="absolute inset-x-0 bottom-0 truncate bg-black/40 px-1 py-1 text-center text-[10px]">You</span>
      </div>}
    </div>

    <div className="flex justify-center gap-3 px-4 py-5 md:gap-5">
      <Control label={call.muted ? 'Unmute microphone' : 'Mute microphone'} active={call.muted} onClick={() => groupCallManager.toggleMute()}>{call.muted ? <MicOff /> : <Mic />}</Control>
      {video && <Control label={call.cameraOff ? 'Turn camera on' : 'Turn camera off'} active={call.cameraOff} onClick={() => groupCallManager.toggleCamera()}>{call.cameraOff ? <VideoOff /> : <Video />}</Control>}
      <Control label="Leave group call" danger onClick={() => groupCallManager.end()}><PhoneOff /></Control>
    </div>
  </div>;
}
