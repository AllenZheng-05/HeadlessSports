/** Pure routing decision for the service worker's fetch handler. No DOM or worker globals here. */

export type Strategy =
  /** Leave the request alone (the browser handles it as if there were no worker). */
  | 'passthrough'
  /** Navigation to the game shell: network first (3 s), fall back to the cached shell. */
  | 'shell'
  /** Content-hashed or version-pathed file: cache first. */
  | 'cache-first'
  /** Models: serve the cached copy, refresh it in the background. */
  | 'stale-while-revalidate';

export interface RouteInput {
  url: string;
  method: string;
  /** `request.mode`. */
  mode: string;
  /** True when the request carries a `Range` header. */
  hasRange: boolean;
  /** The worker's own origin. */
  origin: string;
}

/** Timeout before a navigation falls back to the cached shell, in ms. */
export const NAVIGATION_TIMEOUT_MS = 3000;

export function decideStrategy(input: RouteInput): Strategy {
  if (input.method !== 'GET' || input.hasRange) return 'passthrough';
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return 'passthrough';
  }
  if (url.origin !== input.origin) return 'passthrough';
  const path = url.pathname;
  if (input.mode === 'navigate') {
    return path === '/' || path === '/index.html' ? 'shell' : 'passthrough';
  }
  if (path.startsWith('/assets/') || path.startsWith('/wasm/')) return 'cache-first';
  if (path.startsWith('/models/')) return 'stale-while-revalidate';
  return 'passthrough';
}

/** Only complete, same-origin, non-opaque responses are worth storing. */
export function isCacheable(status: number, type: string): boolean {
  return status === 200 && type === 'basic';
}
