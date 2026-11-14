import { describe, expect, it } from 'vitest';
import {
  BIG_CACHE,
  buildIdFromFiles,
  cacheForPath,
  staleCaches,
  staleWasmEntries,
  versionedCacheName,
} from './cacheNames';
import { buildPrecacheList } from './precache';
import type { BundleEntry } from './precache';
import { decideRegistration } from './register';
import type { RegistrationEnv } from './register';
import { decideStrategy, isCacheable } from './routing';

const ORIGIN = 'https://sports.example';
const req = (path: string, over: Partial<Parameters<typeof decideStrategy>[0]> = {}) =>
  decideStrategy({
    url: ORIGIN + path,
    method: 'GET',
    mode: 'no-cors',
    hasRange: false,
    origin: ORIGIN,
    ...over,
  });

describe('decideStrategy', () => {
  it('serves the shell for navigations to / and /index.html, with or without a query', () => {
    expect(req('/', { mode: 'navigate' })).toBe('shell');
    expect(req('/?sport=bowling', { mode: 'navigate' })).toBe('shell');
    expect(req('/index.html', { mode: 'navigate' })).toBe('shell');
  });
  it('leaves other pages alone', () => {
    expect(req('/debug.html', { mode: 'navigate' })).toBe('passthrough');
    expect(req('/tracking-harness.html', { mode: 'navigate' })).toBe('passthrough');
  });
  it('caches hashed assets and wasm cache-first', () => {
    expect(req('/assets/main-abc.js')).toBe('cache-first');
    expect(req('/wasm/tasks-vision-1.2.3/vision_wasm_internal.wasm')).toBe('cache-first');
  });
  it('revalidates models in the background', () => {
    expect(req('/models/pose_landmarker_lite.task')).toBe('stale-while-revalidate');
  });
  it('ignores other origins, non-GET and range requests', () => {
    expect(req('/assets/a.js', { url: 'https://example.com/assets/a.js' })).toBe('passthrough');
    expect(req('/assets/a.js', { method: 'POST' })).toBe('passthrough');
    expect(req('/models/x.task', { hasRange: true })).toBe('passthrough');
    expect(req('/sw.js')).toBe('passthrough');
    expect(req('/manifest.webmanifest')).toBe('passthrough');
  });
  it('passes malformed URLs through', () => {
    expect(req('', { url: 'not a url' })).toBe('passthrough');
  });
});

describe('isCacheable', () => {
  it('accepts only 200 basic responses', () => {
    expect(isCacheable(200, 'basic')).toBe(true);
    expect(isCacheable(206, 'basic')).toBe(false);
    expect(isCacheable(404, 'basic')).toBe(false);
    expect(isCacheable(200, 'opaque')).toBe(false);
    expect(isCacheable(200, 'cors')).toBe(false);
  });
});

describe('cache names', () => {
  it('includes the build id and sends big files to the persistent cache', () => {
    expect(versionedCacheName('abc')).toBe('hs-abc');
    expect(cacheForPath('/assets/x.js', 'abc')).toBe('hs-abc');
    expect(cacheForPath('/models/m.task', 'abc')).toBe(BIG_CACHE);
    expect(cacheForPath('/wasm/v/a.wasm', 'abc')).toBe(BIG_CACHE);
  });
  it('deletes old versions and nothing foreign', () => {
    const all = ['hs-old', 'hs-abc', BIG_CACHE, 'other-app'];
    expect(staleCaches(all, 'abc')).toEqual(['hs-old']);
  });
  it('prunes WASM from other MediaPipe versions only', () => {
    const urls = [
      `${ORIGIN}/wasm/tasks-vision-1.2.2/vision_wasm_internal.wasm`,
      `${ORIGIN}/wasm/tasks-vision-1.2.3/vision_wasm_internal.wasm`,
      `${ORIGIN}/wasm/tasks-vision-1.2.3/vision_wasm_internal.js?x=1`,
      `${ORIGIN}/wasm/tasks-vision-0.10.0/a.js`,
      `${ORIGIN}/models/pose_landmarker_lite.task`,
      `${ORIGIN}/wasm/other/a.js`,
      '/wasm/tasks-vision-9/b.wasm',
      'not a url at all %%',
    ];
    expect(staleWasmEntries(urls, '1.2.3')).toEqual([
      `${ORIGIN}/wasm/tasks-vision-1.2.2/vision_wasm_internal.wasm`,
      `${ORIGIN}/wasm/tasks-vision-0.10.0/a.js`,
      '/wasm/tasks-vision-9/b.wasm',
    ]);
    expect(staleWasmEntries(urls, '9')).toContain(
      `${ORIGIN}/wasm/tasks-vision-1.2.3/vision_wasm_internal.wasm`,
    );
    expect(staleWasmEntries([], '1.2.3')).toEqual([]);
  });
  it('derives a stable, order-independent, content-sensitive build id', () => {
    expect(buildIdFromFiles(['/a', '/b'])).toBe(buildIdFromFiles(['/b', '/a']));
    expect(buildIdFromFiles(['/a', '/b'])).not.toBe(buildIdFromFiles(['/a', '/c']));
  });
});

describe('buildPrecacheList', () => {
  const bundle: Record<string, BundleEntry> = {
    'assets/main-1.js': {
      fileName: 'assets/main-1.js',
      type: 'chunk',
      isEntry: true,
      name: 'main',
      imports: ['assets/three-2.js'],
      importedCss: ['assets/main-3.css'],
      importedAssets: ['assets/font-4.woff2', 'assets/font-4.woff'],
    },
    'assets/three-2.js': {
      fileName: 'assets/three-2.js',
      type: 'chunk',
      imports: [],
      importedAssets: [],
    },
    'assets/debug-5.js': {
      fileName: 'assets/debug-5.js',
      type: 'chunk',
      isEntry: true,
      name: 'debug',
    },
    'assets/bowling-6.js': { fileName: 'assets/bowling-6.js', type: 'chunk' },
    'assets/font-4.woff2': { fileName: 'assets/font-4.woff2', type: 'asset' },
  };
  it('lists the shell, the entry, its static imports, css and fonts only', () => {
    expect(buildPrecacheList(bundle)).toEqual([
      '/',
      '/index.html',
      '/assets/main-1.js',
      '/assets/main-3.css',
      '/assets/font-4.woff2',
      '/assets/three-2.js',
    ]);
  });
});

describe('decideRegistration', () => {
  const base: RegistrationEnv = {
    prod: true,
    protocol: 'https:',
    hostname: 'sports.allenzheng.com',
    webdriver: false,
    search: '',
    hasServiceWorker: true,
  };
  it('registers in production on https', () => {
    expect(decideRegistration(base)).toBe('register');
  });
  it('works on localhost over http', () => {
    expect(decideRegistration({ ...base, protocol: 'http:', hostname: 'localhost' })).toBe(
      'register',
    );
  });
  it('skips insecure origins, dev builds and missing support', () => {
    expect(decideRegistration({ ...base, protocol: 'http:' })).toBe('skip');
    expect(decideRegistration({ ...base, prod: false })).toBe('skip');
    expect(decideRegistration({ ...base, hasServiceWorker: false })).toBe('skip');
  });
  it('skips automated browsers unless ?sw=1', () => {
    expect(decideRegistration({ ...base, webdriver: true })).toBe('skip');
    expect(decideRegistration({ ...base, webdriver: true, search: '?sw=1' })).toBe('register');
  });
  it('?sw=0 unregisters, even in dev', () => {
    expect(decideRegistration({ ...base, search: '?sw=0' })).toBe('unregister');
    expect(decideRegistration({ ...base, prod: false, search: '?sw=0' })).toBe('unregister');
  });
});
