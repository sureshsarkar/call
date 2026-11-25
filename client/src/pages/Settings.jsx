import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSettingsStore } from '../context/settingsStore';
import { enablePush, disablePush } from '../utils/push';
import { rnnoiseSupported } from '../webrtc/audioProcessing';
import { listDevices, canPickSpeaker, mediaErrorMessage, audioConstraints } from '../webrtc/media';
import { testConnection, interpret } from '../webrtc/connectionTest';
import { callApi } from '../services/api';

function Toggle({ label, desc, checked, onChange, disabled }) {
  return (
    <label className={`flex items-start justify-between gap-4 rounded-xl bg-panel2 p-4 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span><span className="block font-medium">{label}</span><span className="text-sm text-mute">{desc}</span></span>
      <input type="checkbox" className="mt-1 h-5 w-5 accent-emerald-500" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Select({ label, value, list, onChange }) {
  return (
    <label className="block text-sm text-mute">{label}
      <select className="input mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">System default</option>
        {list.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
    </label>
  );
}

/** Checks that calls can connect from here, and whether the TURN relay works (important on mobile networks). */
function ConnectionTest() {
  const [state, setState] = useState('idle'); // idle | running | done | error
  const [lines, setLines] = useState([]);
  const [raw, setRaw] = useState(null);

  const run = async () => {
    setState('running');
    try {
      const servers = await callApi.iceServers();
      const result = await testConnection(servers);
      setRaw(result);
      setLines(interpret(result));
      setState('done');
    } catch (err) {
      setLines([{ ok: false, text: err.message || 'The test could not run in this browser.' }]);
      setState('error');
    }
  };

  return (
    <div className="rounded-xl bg-panel2 p-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="font-medium">Call connection test</span>
        <button className="btn-primary !py-1.5 text-sm" onClick={run} disabled={state === 'running'}>{state === 'running' ? 'Testing…' : 'Run test'}</button>
      </div>
      <p className="text-sm text-mute">Checks whether calls can connect from this network, including the TURN relay used on strict networks.</p>
      {lines.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {lines.map((l) => <li key={l.text} className={l.ok ? 'text-emerald-400' : 'text-amber-300'}>{l.ok ? '✔' : '⚠'} {l.text}</li>)}
        </ul>
      )}
      {raw && <p className="mt-2 text-xs text-mute">Candidates found — direct: {raw.host}, STUN: {raw.srflx}, relay: {raw.relay}</p>}
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const s = useSettingsStore();
  const [devices, setDevices] = useState({ mics: [], speakers: [], cams: [] });
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);

  useEffect(() => { listDevices().then(setDevices); }, []);

  // microphone level meter to verify the mic + noise suppression
  const testMic = async () => {
    if (testing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(s.micId) });
      listDevices().then(setDevices);
      setTesting(true);
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const start = Date.now();
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        const peak = data.reduce((m, v) => Math.max(m, Math.abs(v - 128)), 0);
        setLevel(Math.min(100, peak * 1.6));
        if (Date.now() - start < 8000) requestAnimationFrame(tick);
        else { stream.getTracks().forEach((t) => t.stop()); ctx.close(); setTesting(false); setLevel(0); }
      };
      tick();
    } catch (err) { toast.error(mediaErrorMessage(err, 'microphone')); }
  };

  const notifSupported = 'Notification' in window;

  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-bg pb-safe">
      <header className="pt-safe flex items-center gap-1 bg-panel2 px-1 pb-3 md:gap-3 md:px-3">
        <button className="btn-icon h-11 w-11 text-ink md:hidden" onClick={() => navigate('/')}><ArrowLeft size={24} /></button>
        <h1 className="ml-2 text-lg font-semibold md:ml-0">Settings</h1>
      </header>
      <div className="mx-auto max-w-lg space-y-5 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-brand">Calls &amp; audio</h2>
        <Toggle label="AI noise cancellation (RNNoise)" desc="Removes keyboard clicks, fans and background chatter using a neural network running locally in your browser. Applied on top of echo cancellation, noise suppression and auto gain, which are always on."
          checked={s.advancedNoise} disabled={!rnnoiseSupported()} onChange={(v) => s.update({ advancedNoise: v })} />
        {!rnnoiseSupported() && <p className="text-xs text-danger">This browser does not support AudioWorklet + WebAssembly.</p>}
        <Select label="Microphone" value={s.micId} list={devices.mics} onChange={(v) => s.update({ micId: v })} />
        {canPickSpeaker() && <Select label="Speaker" value={s.speakerId} list={devices.speakers} onChange={(v) => s.update({ speakerId: v })} />}
        <Select label="Camera" value={s.camId} list={devices.cams} onChange={(v) => s.update({ camId: v })} />
        <div className="rounded-xl bg-panel2 p-4">
          <div className="mb-3 flex items-center justify-between"><span className="font-medium">Microphone test</span><button className="btn-primary !py-1.5 text-sm" onClick={testMic} disabled={testing}>{testing ? 'Listening…' : 'Test (8s)'}</button></div>
          <div className="h-2.5 overflow-hidden rounded-full bg-panel3"><div className="h-full rounded-full bg-brand transition-all duration-75" style={{ width: `${level}%` }} /></div>
        </div>

        <ConnectionTest />

        <h2 className="pt-4 text-sm font-semibold uppercase tracking-wide text-brand">Notifications</h2>
        <Toggle label="Sounds" desc="Ringtones and message tones." checked={s.sounds} onChange={(v) => s.update({ sounds: v })} />
        <Toggle label="Push notifications" desc="Receive chat and incoming-call notifications while Pulse is in the background."
          checked={s.desktopNotifications && notifSupported && Notification.permission === 'granted'}
          disabled={!notifSupported || !('serviceWorker' in navigator) || !('PushManager' in window)}
          onChange={async (v) => {
            s.update({ desktopNotifications: v });
            try { if (v) await enablePush(); else await disablePush(); }
            catch (err) { s.update({ desktopNotifications: false }); toast.error(err.message || 'Could not enable push notifications'); }
          }} />
      </div>
    </div>
  );
}
