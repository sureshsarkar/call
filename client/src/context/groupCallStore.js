import { create } from 'zustand';

const initial = {
  phase: 'idle', // idle | incoming | outgoing | connecting | connected
  callId: null,
  groupId: null,
  groupName: '',
  type: 'video',
  caller: null,
  participants: [],
  localStream: null,
  remoteStreams: {},
  muted: false,
  cameraOff: false,
  maxParticipants: 8,
};

export const useGroupCallStore = create(() => ({ ...initial }));
export const resetGroupCallStore = () => useGroupCallStore.setState({ ...initial });
