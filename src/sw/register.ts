/** Registers /sw.js when it is safe and wanted. The decision is a pure function so it is unit-tested. */

export interface RegistrationEnv {
  prod: boolean;
  protocol: string;
  hostname: string;
  webdriver: boolean;
  search: string;
  hasServiceWorker: boolean;
}

export type RegistrationAction = 'register' | 'unregister' | 'skip';

export function decideRegistration(env: RegistrationEnv): RegistrationAction {
  if (!env.hasServiceWorker) return 'skip';
  const params = new URLSearchParams(env.search);
  const secure =
    env.protocol === 'https:' || env.hostname === 'localhost' || env.hostname === '127.0.0.1';
  if (!secure) return 'skip';
  if (params.get('sw') === '0') return 'unregister';
  if (!env.prod) return 'skip';
  if (env.webdriver && params.get('sw') !== '1') return 'skip';
  return 'register';
}

export interface SwHandle {
  waiting: boolean;
  update(): void;
}

declare global {
  interface Window {
    __sw?: SwHandle;
  }
}

async function deleteCaches(): Promise<void> {
  for (const name of await caches.keys()) if (name.startsWith('hs-')) await caches.delete(name);
}

async function unregisterAll(): Promise<void> {
  for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
  await deleteCaches();
  // The old worker keeps controlling this page until it closes and may write a late cache entry.
  setTimeout(() => {
    void deleteCaches().catch(() => undefined);
  }, 1500);
}

function watch(reg: ServiceWorkerRegistration): void {
  const handle: SwHandle = {
    waiting: false,
    update() {
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
    },
  };
  window.__sw = handle;
  const check = (): void => {
    if (reg.waiting && navigator.serviceWorker.controller && !handle.waiting) {
      handle.waiting = true;
      console.info('A new version is ready. It loads the next time the game is opened.');
    }
  };
  check();
  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    next?.addEventListener('statechange', check);
  });
}

export function registerServiceWorker(): void {
  const action = decideRegistration({
    prod: import.meta.env.PROD,
    protocol: location.protocol,
    hostname: location.hostname,
    webdriver: navigator.webdriver,
    search: location.search,
    hasServiceWorker: 'serviceWorker' in navigator,
  });
  if (action === 'skip') return;
  if (action === 'unregister') {
    void unregisterAll().catch(() => undefined);
    return;
  }
  const start = (): void => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(watch, (err: unknown) => {
      console.warn('Service worker not registered', err);
    });
  };
  // After load, so the worker's precache never competes with the game's own startup.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
