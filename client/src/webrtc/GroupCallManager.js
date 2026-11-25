import toast from 'react-hot-toast';
import { callApi } from '../services/api';
import { getSocket, emitAck } from '../socket/socket';
import { useAuthStore } from '../context/authStore';
import { useCallStore } from '../context/callStore';
import { useGroupCallStore, resetGroupCallStore } from '../context/groupCallStore';
import { getCallMedia, stopStream } from './media';

const FALLBACK_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const set = (patch) => useGroupCallStore.setState(patch);
const get = () => useGroupCallStore.getState();
const idOf = (value) => String(value?._id ?? value ?? '');

class GroupCallManager {
  constructor() {
    this.socket = null;
    this.peers = new Map();
    this.iceServers = FALLBACK_ICE;
    this.rawStream = null;
    this.disposed = false;
  }

  get busy() { return get().phase !== 'idle'; }

  async loadIceServers() {
    try { this.iceServers = (await callApi.iceServers()).iceServers || FALLBACK_ICE; }
    catch { this.iceServers = FALLBACK_ICE; }
  }

  async capture(type) {
    const { stream, cameraMissing } = await getCallMedia(type);
    this.rawStream = stream;
    if (cameraMissing) toast('Camera unavailable; joining with audio only.', { icon: '📷' });
    return stream;
  }

  async start(group, type) {
    if (this.busy || useCallStore.getState().status !== 'idle') return toast.error('End the current call before starting another one');
    try {
      const stream = await this.capture(type);
      const response = await emitAck('group_call_start', { groupId: group._id, type });
      if (!response.ok) { stopStream(stream); this.rawStream = null; return toast.error(response.error || 'Could not start group call'); }
      await this.loadIceServers();
      set({
        phase: 'outgoing', callId: response.callId, groupId: response.groupId, groupName: response.groupName || group.name,
        type, participants: response.participants || [], localStream: stream, remoteStreams: {}, muted: false, cameraOff: false,
        maxParticipants: response.maxParticipants || 8,
      });
    } catch (error) {
      stopStream(this.rawStream); this.rawStream = null;
      toast.error(error.message || 'Could not access your microphone or camera');
    }
  }

  async accept() {
    const invite = get();
    if (invite.phase !== 'incoming' || useCallStore.getState().status !== 'idle') return;
    try {
      const stream = await this.capture(invite.type);
      const response = await emitAck('group_call_join', { callId: invite.callId });
      if (!response.ok) { stopStream(stream); this.rawStream = null; this.endLocal(); return toast.error(response.error || 'Could not join group call'); }
      await this.loadIceServers();
      set({ ...response, phase: 'connecting', caller: null, localStream: stream, remoteStreams: {}, muted: false, cameraOff: false });
      for (const participant of response.participants || []) this.createPeer(participant, false);
    } catch (error) {
      stopStream(this.rawStream); this.rawStream = null; this.endLocal();
      toast.error(error.message || 'Could not access your microphone or camera');
    }
  }

  reject() {
    if (get().phase === 'incoming') getSocket()?.emit('group_call_decline', { callId: get().callId });
    this.endLocal();
  }

  async createPeer(participant, makeOffer) {
    const peerId = idOf(participant);
    const current = get();
    if (!peerId || peerId === String(useAuthStore.getState().user?._id) || this.peers.has(peerId) || !current.callId) return;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
    this.peers.set(peerId, pc);
    for (const track of current.localStream?.getTracks() || []) pc.addTrack(track, current.localStream);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) getSocket()?.emit('group_call_signal', { callId: get().callId, to: peerId, signal: { type: 'candidate', candidate: candidate.toJSON() } });
    };
    pc.ontrack = (event) => {
      let stream = event.streams?.[0];
      if (!stream) {
        stream = get().remoteStreams[peerId] || new MediaStream();
        if (!stream.getTracks().some((track) => track.id === event.track.id)) stream.addTrack(event.track);
      }
      set((state) => ({ remoteStreams: { ...state.remoteStreams, [peerId]: stream }, phase: state.phase === 'connecting' ? 'connected' : state.phase }));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') toast.error(`${participant.name || 'A participant'} could not connect`);
    };
    if (makeOffer) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        getSocket()?.emit('group_call_signal', { callId: get().callId, to: peerId, signal: { type: 'offer', description: pc.localDescription } });
      } catch (error) { console.error('[group call] offer', error); }
    }
  }

  async onSignal({ callId, from, signal }) {
    if (callId !== get().callId || !signal) return;
    let pc = this.peers.get(String(from));
    if (!pc) {
      const participant = get().participants.find((item) => idOf(item) === String(from)) || { _id: from, name: 'Participant' };
      await this.createPeer(participant, false);
      pc = this.peers.get(String(from));
    }
    if (!pc) return;
    try {
      if (signal.type === 'candidate') {
        if (signal.candidate) await pc.addIceCandidate(signal.candidate);
      } else if (signal.type === 'offer') {
        await pc.setRemoteDescription(signal.description);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        getSocket()?.emit('group_call_signal', { callId, to: String(from), signal: { type: 'answer', description: pc.localDescription } });
      } else if (signal.type === 'answer') await pc.setRemoteDescription(signal.description);
    } catch (error) { console.warn('[group call] signaling', error.message); }
  }

  toggleMute() {
    const muted = !get().muted;
    for (const track of this.rawStream?.getAudioTracks() || []) track.enabled = !muted;
    set({ muted });
  }

  toggleCamera() {
    const cameraOff = !get().cameraOff;
    for (const track of this.rawStream?.getVideoTracks() || []) track.enabled = !cameraOff;
    set({ cameraOff });
  }

  end() {
    if (get().callId && get().phase !== 'incoming') getSocket()?.emit('group_call_leave', { callId: get().callId });
    this.endLocal();
  }

  endLocal() {
    for (const pc of this.peers.values()) { pc.ontrack = null; pc.onicecandidate = null; pc.close(); }
    this.peers.clear();
    stopStream(this.rawStream);
    this.rawStream = null;
    resetGroupCallStore();
  }

  bind(socket) {
    this.socket = socket;
    socket.on('group_call_invite', (invite) => {
      if (this.busy || useCallStore.getState().status !== 'idle') {
        socket.emit('group_call_decline', { callId: invite.callId });
        return;
      }
      set({ ...invite, phase: 'incoming', participants: [], remoteStreams: {}, localStream: null });
      const url = new URL(window.location.href);
      const pushAction = url.searchParams.get('pushAction');
      if (url.searchParams.get('incomingGroupCall') === invite.callId && ['accept', 'reject'].includes(pushAction)) {
        url.searchParams.delete('incomingGroupCall');
        url.searchParams.delete('pushAction');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        if (pushAction === 'accept') setTimeout(() => void this.accept(), 0);
        else setTimeout(() => this.reject(), 0);
      }
    });
    socket.on('group_call_peer_joined', ({ callId, participant }) => {
      if (callId !== get().callId || get().phase === 'incoming') return;
      set((state) => ({ participants: [...state.participants.filter((item) => idOf(item) !== idOf(participant)), participant], phase: 'connected' }));
      void this.createPeer(participant, true);
    });
    socket.on('group_call_signal', (payload) => { void this.onSignal(payload); });
    socket.on('group_call_peer_left', ({ callId, userId }) => {
      if (callId !== get().callId) return;
      this.peers.get(String(userId))?.close();
      this.peers.delete(String(userId));
      set((state) => {
        const remoteStreams = { ...state.remoteStreams }; delete remoteStreams[String(userId)];
        const participants = state.participants.filter((item) => idOf(item) !== String(userId));
        return { remoteStreams, participants, phase: participants.length > 1 ? 'connected' : 'connecting' };
      });
    });
    socket.on('group_call_declined', ({ callId, userId }) => {
      if (callId === get().callId) {
        const participant = get().participants.find((item) => idOf(item) === String(userId));
        if (participant) toast(`${participant.name} declined the group call`);
      }
    });
    socket.on('group_call_ended', ({ callId, reason }) => {
      if (callId !== get().callId) return;
      if (reason === 'no_answer') toast('No one answered the group call');
      else if (reason === 'membership_changed') toast('Your group membership changed');
      this.endLocal();
    });
    socket.on('group_removed', ({ groupId }) => { if (String(groupId) === get().groupId) this.end(); });
    socket.on('connect', () => { if (get().callId && !['incoming', 'outgoing'].includes(get().phase)) void this.rejoin(); });
  }

  async rejoin() {
    const current = get();
    if (!current.callId || !current.localStream) return;
    const response = await emitAck('group_call_join', { callId: current.callId });
    if (!response.ok) return this.endLocal();
    set({ ...response, phase: 'connecting', localStream: current.localStream, remoteStreams: {} });
    for (const participant of response.participants || []) this.createPeer(participant, false);
  }
}

export const groupCallManager = new GroupCallManager();
