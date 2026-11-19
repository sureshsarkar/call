import { useEffect } from 'react';

/** Native-style bottom sheet on phones; a centered dialog on desktop. Closes on backdrop tap / Escape. */
export default function BottomSheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" role="dialog" aria-modal="true">
      <div className="fade-in absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="sheet-up relative w-full max-w-md rounded-t-3xl bg-panel2 pb-safe shadow-2xl md:rounded-3xl md:pb-4">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-white/20 md:hidden" />
        {title && <p className="px-5 pb-1 pt-3 text-sm font-semibold text-mute">{title}</p>}
        <div className="px-2 py-2">{children}</div>
      </div>
    </div>
  );
}

export function SheetAction({ icon: Icon, label, onClick, danger = false }) {
  return (
    <button onClick={onClick} className={`press flex w-full items-center gap-4 rounded-xl px-4 py-3.5 text-left text-[15px] ${danger ? 'text-red-400' : 'text-ink'}`}>
      {Icon && <Icon size={21} className={danger ? '' : 'text-mute'} />}{label}
    </button>
  );
}
