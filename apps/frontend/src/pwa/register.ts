/**
 * Registers /sw.js (generated at build time, see vite.config.ts) so the app
 * shell opens without internet. Production builds only: the dev server's
 * files change constantly and the mock mode is dev-only anyway.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Without a service worker the app still works online.
    });
  });
}
