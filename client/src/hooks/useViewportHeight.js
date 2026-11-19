import { useEffect } from 'react';

/**
 * Keeps --app-h equal to the *visible* viewport height (shrinks when the on-screen keyboard opens),
 * so fixed bottom bars / message inputs are never hidden behind the keyboard — notably on iOS Safari.
 */
export default function useViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty('--app-h', `${Math.round(vv ? vv.height : window.innerHeight)}px`);
      if (vv && window.scrollY !== 0) window.scrollTo(0, 0); // iOS scrolls the page when the keyboard opens
    };
    apply();
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      window.removeEventListener('orientationchange', apply);
      root.style.removeProperty('--app-h');
    };
  }, []);
}
