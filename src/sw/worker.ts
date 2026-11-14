// Service worker source, built to /sw.js by the plugin in plugin.ts.
// It must not import app code or three.js.
import { BIG_CACHE, cacheForPath, staleCaches, versionedCacheName } from './cacheNames';
import { NAVIGATION_TIMEOUT_MS, decideStrategy, isCacheable } from './routing';

declare const __BUILD_ID__: string;
declare const __PRECACHE__: string[];

interface ExtendableEventLike extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(r: Promise<Response>): void;
}
interface WorkerScope {
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: string, listener: (e: never) => void): void;
}

const sw = self as unknown as WorkerScope;
const buildId = __BUILD_ID__;
const shellCache = versionedCacheName(buildId);

sw.addEventListener('install', (e: ExtendableEventLike) => {
  e.waitUntil(
    caches.open(shellCache).then((cache) =>
      // `reload` bypasses the HTTP cache so the shell is exactly this deploy's files.
      cache.addAll(__PRECACHE__.map((u) => new Request(u, { cache: 'reload' }))),
    ),
  );
  // No skipWaiting here: a running game is never swapped mid-round. The page asks (see register.ts).
});

sw.addEventListener('message', (e: MessageEvent) => {
  const data = e.data as { type?: string } | null;
  if (data?.type === 'SKIP_WAITING') void sw.skipWaiting();
});

sw.addEventListener('activate', (e: ExtendableEventLike) => {
  e.waitUntil(
    (async () => {
      for (const name of staleCaches(await caches.keys(), buildId)) await caches.delete(name);
      await sw.clients.claim();
    })(),
  );
});

async function store(request: Request, response: Response): Promise<void> {
  if (!isCacheable(response.status, response.type)) return;
  const cache = await caches.open(cacheForPath(new URL(request.url).pathname, buildId));
  await cache.put(request, response);
}

async function cachedShell(): Promise<Response | undefined> {
  const cache = await caches.open(shellCache);
  return (await cache.match('/index.html')) ?? (await cache.match('/'));
}

async function networkFirstShell(request: Request, event: ExtendableEventLike): Promise<Response> {
  const network = fetch(request).then((response) => {
    if (isCacheable(response.status, response.type)) {
      const copy = response.clone();
      event.waitUntil(
        caches.open(shellCache).then((cache) => cache.put(new Request('/index.html'), copy)),
      );
    }
    return response;
  });
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => {
      resolve(null);
    }, NAVIGATION_TIMEOUT_MS),
  );
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
  } catch {
    // Offline or network error: fall through to the cached shell.
  }
  const fallback = await cachedShell();
  if (fallback) return fallback;
  // Nothing cached yet: wait for the network after all.
  return network;
}

async function cacheFirst(request: Request, event: ExtendableEventLike): Promise<Response> {
  const hit = await caches.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (isCacheable(response.status, response.type)) {
    event.waitUntil(store(request, response.clone()));
  }
  return response;
}

async function staleWhileRevalidate(
  request: Request,
  event: ExtendableEventLike,
): Promise<Response> {
  const cache = await caches.open(BIG_CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request).then(async (response) => {
    if (isCacheable(response.status, response.type)) await cache.put(request, response.clone());
    return response;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => undefined));
    return hit;
  }
  return refresh;
}

sw.addEventListener('fetch', (e: FetchEventLike) => {
  const request = e.request;
  const strategy = decideStrategy({
    url: request.url,
    method: request.method,
    mode: request.mode,
    hasRange: request.headers.has('range'),
    origin: sw.location.origin,
  });
  switch (strategy) {
    case 'shell':
      e.respondWith(networkFirstShell(request, e));
      break;
    case 'cache-first':
      e.respondWith(cacheFirst(request, e));
      break;
    case 'stale-while-revalidate':
      e.respondWith(staleWhileRevalidate(request, e));
      break;
    default:
      break;
  }
});
