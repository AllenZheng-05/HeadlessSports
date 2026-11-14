/**
 * Cache naming. Two kinds of cache:
 *  - the versioned cache `hs-<buildId>` holds the app shell and the hashed `/assets/*` files, so it
 *    is thrown away whenever a new build activates;
 *  - the persistent cache `hs-big-v1` holds `/wasm/*` (versioned by path) and `/models/*` (large,
 *    refreshed in place), so a new deploy does not make players re-download tens of megabytes.
 */

export const CACHE_PREFIX = 'hs-';
export const BIG_CACHE = `${CACHE_PREFIX}big-v1`;

export function versionedCacheName(buildId: string): string {
  return `${CACHE_PREFIX}${buildId}`;
}

/** Which cache a path belongs to. */
export function cacheForPath(pathname: string, buildId: string): string {
  return pathname.startsWith('/wasm/') || pathname.startsWith('/models/')
    ? BIG_CACHE
    : versionedCacheName(buildId);
}

/** The caches to delete on activate: ours (by prefix) but not the two current ones. */
export function staleCaches(allNames: readonly string[], buildId: string): string[] {
  const keep = new Set([versionedCacheName(buildId), BIG_CACHE]);
  return allNames.filter((n) => n.startsWith(CACHE_PREFIX) && !keep.has(n));
}

/** Short stable id from a list of file names (FNV-1a, base 36). */
export function buildIdFromFiles(files: readonly string[]): string {
  let h = 0x811c9dc5;
  const text = [...files].sort().join('\n');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
