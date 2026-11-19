import { useState } from 'react';
import { assetUrl, initials } from '../utils/format';

const COLORS = ['#6a5acd', '#d35400', '#16a085', '#c0392b', '#2980b9', '#8e44ad', '#27ae60', '#b9770e', '#cb4335', '#1f618d'];
const colorFor = (s = '') => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

export default function Avatar({ user, size = 44, online = false, className = '' }) {
  const [broken, setBroken] = useState(false);
  const src = user?.avatar && !broken ? assetUrl(user.avatar) : '';
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt={user?.name || 'avatar'} onError={() => setBroken(true)} className="h-full w-full rounded-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full select-none items-center justify-center rounded-full font-semibold text-white" style={{ background: colorFor(user?.name), fontSize: size * 0.38 }}>
          {initials(user?.name)}
        </div>
      )}
      {online && <span className="absolute bottom-0 right-0 block rounded-full border-2 border-panel bg-brand" style={{ width: Math.max(10, size * 0.26), height: Math.max(10, size * 0.26) }} />}
    </div>
  );
}
