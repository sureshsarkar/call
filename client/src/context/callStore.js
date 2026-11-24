import { create } from 'zustand';

const initial = {
  status: 'idle', // idle | outgoing | incoming | connecting | connected | reconnecting
  callId: null,
  type: 'video',
  peer: null,
  isCaller: false,
  localStream: null,
  remoteStream: null,
  muted: false,
  cameraOff: false,
  noCamera: false,
  sharing: false,
  cameraSwitching: false,
  remoteSharing: false,
  remoteMuted: false,
  remoteCameraOff: false,
  peerStatus: 'ok', // ok | disconnected
  connectedAt: null,
  facing: 'user',
  advancedNoiseActive: false,
  devices: { mics: [], speakers: [], cams: [] },
};

export const useCallStore = create(() => ({ ...initial }));
export const resetCallStore = () => useCallStore.setState({ ...initial, devices: useCallStore.getState().devices });
