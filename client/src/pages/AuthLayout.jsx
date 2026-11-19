// Full-bleed, app-like screen on phones (logo on top, form below); a centered card on larger screens.
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-[#0b2a2a] via-[#0b141a] to-[#0b141a] sm:items-center sm:justify-center sm:px-4 sm:py-8">
      <div className="flex flex-1 flex-col justify-end px-6 pb-8 pt-[calc(env(safe-area-inset-top)+2.5rem)] sm:hidden">
        <img src="/icons/icon-192.png" alt="" className="mb-5 h-20 w-20 rounded-[1.4rem] shadow-xl shadow-black/40" />
        <h1 className="text-4xl font-bold tracking-tight">Pulse</h1>
        <p className="mt-1 text-mute">Chat · Audio · Video calls</p>
      </div>

      <div className="pop-in w-full rounded-t-[2rem] bg-panel px-6 pb-[calc(env(safe-area-inset-bottom)+1.75rem)] pt-7 shadow-2xl ring-1 ring-white/5 sm:max-w-md sm:rounded-2xl sm:p-9">
        <div className="mb-6 hidden items-center gap-3 sm:flex">
          <img src="/favicon.svg" alt="" className="h-11 w-11" />
          <div><h1 className="text-xl font-bold leading-tight">Pulse</h1><p className="text-xs text-mute">Chat · Audio · Video</p></div>
        </div>
        <h2 className="text-2xl font-semibold">{title}</h2>
        {subtitle && <p className="mb-5 mt-1 text-sm text-mute">{subtitle}</p>}
        {children}
        {footer && <div className="mt-6 text-center text-sm text-mute">{footer}</div>}
      </div>
    </div>
  );
}
