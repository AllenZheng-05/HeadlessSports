import { IndexedDbScoreStore } from './IndexedDbScoreStore';
import { MemoryScoreStore } from './MemoryScoreStore';
import type { ScoreStore } from './types';

export * from './types';
export { MemoryScoreStore } from './MemoryScoreStore';
export { IndexedDbScoreStore } from './IndexedDbScoreStore';

/** IndexedDbScoreStore when indexedDB exists and opens; otherwise MemoryScoreStore. Never rejects. */
export async function createScoreStore(): Promise<ScoreStore> {
  if (globalThis.indexedDB) {
    const store = new IndexedDbScoreStore();
    try {
      await store.open();
      return store;
    } catch {
      // Fall through to the in-memory store.
    }
  }
  return new MemoryScoreStore();
}
