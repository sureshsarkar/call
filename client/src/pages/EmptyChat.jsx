import { Lock, Video, MessageSquare } from 'lucide-react';

export default function EmptyChat() {
  return (
    <div className="chat-wallpaper hidden h-full flex-col items-center justify-center gap-4 px-8 text-center md:flex">
      <div className="grid h-24 w-24 place-items-center rounded-full bg-panel2 text-brand"><MessageSquare size={44} /></div>
      <h2 className="text-3xl font-light">Pulse</h2>
      <p className="max-w-md text-sm text-mute">Send messages, make crystal-clear audio and video calls, and share your screen. Pick a conversation or search for someone to begin.</p>
      <p className="flex items-center gap-2 text-xs text-mute"><Video size={14} /> Noise-suppressed HD calls <span>·</span> <Lock size={14} /> Private 1:1 conversations</p>
    </div>
  );
}
