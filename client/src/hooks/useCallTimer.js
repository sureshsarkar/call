import { useEffect, useState } from 'react';

/** Seconds elapsed since `startedAt` (ms epoch), ticking every second. */
export default function useCallTimer(startedAt) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!startedAt) { setSeconds(0); return undefined; }
    const tick = () => setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return seconds;
}
