import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createScoreStore, IndexedDbScoreStore, MemoryScoreStore } from './index';
import type { ScoreEntry, ScoreStore } from './types';

const T0 = Date.UTC(2026, 0, 1);

/** Deterministic ISO timestamp; `n` orders entries in time. */
function at(n: number): string {
  return new Date(T0 + n * 1000).toISOString();
}

function entry(sportId: string, score: number, n = 0, detail?: Record<string, number>): ScoreEntry {
  const e: ScoreEntry = { sportId, score, at: at(n) };
  if (detail !== undefined) e.detail = detail;
  return e;
}

function runSuite(name: string, makeStore: () => ScoreStore): void {
  describe(name, () => {
    let store: ScoreStore;

    beforeEach(() => {
      store = makeStore();
    });

    it('empty store returns null / []', async () => {
      expect(await store.best('bowling')).toBeNull();
      expect(await store.history('bowling')).toEqual([]);
      expect(await store.top('bowling')).toEqual([]);
    });

    it('add then best', async () => {
      const e = entry('bowling', 42, 1);
      const result = await store.add(e);
      expect(result.isBest).toBe(true);
      expect(result.best).toEqual(e);
      expect(await store.best('bowling')).toEqual(e);
    });

    it('detects new personal bests', async () => {
      await store.add(entry('bowling', 5, 0));
      expect((await store.add(entry('bowling', 3, 1))).isBest).toBe(false);
      expect((await store.best('bowling'))?.score).toBe(5);
      const nine = await store.add(entry('bowling', 9, 2));
      expect(nine.isBest).toBe(true);
      expect(nine.best.score).toBe(9);
      expect((await store.best('bowling'))?.score).toBe(9);
    });

    it('ties are not a new best and the earlier entry stays best', async () => {
      await store.add(entry('bowling', 5, 1));
      const tie = await store.add(entry('bowling', 5, 2));
      expect(tie.isBest).toBe(false);
      expect(tie.best.at).toBe(at(1));
      expect((await store.best('bowling'))?.at).toBe(at(1));
    });

    it('higherIsBetter = false ranks lower scores first', async () => {
      expect((await store.add(entry('sprint', 30, 0), false)).isBest).toBe(true);
      const faster = await store.add(entry('sprint', 20, 1), false);
      expect(faster.isBest).toBe(true);
      expect(faster.best.score).toBe(20);
      expect((await store.add(entry('sprint', 25, 2), false)).isBest).toBe(false);
      expect((await store.best('sprint', false))?.score).toBe(20);
      expect((await store.top('sprint', 3, false)).map((e) => e.score)).toEqual([20, 25, 30]);
    });

    it('history is newest first and respects limit', async () => {
      for (let i = 1; i <= 5; i++) await store.add(entry('bowling', i, i));
      expect((await store.history('bowling')).map((e) => e.score)).toEqual([5, 4, 3, 2, 1]);
      expect((await store.history('bowling', 2)).map((e) => e.score)).toEqual([5, 4]);
    });

    it('history defaults to 20 entries', async () => {
      for (let i = 0; i < 25; i++) await store.add(entry('bowling', i, i));
      const h = await store.history('bowling');
      expect(h).toHaveLength(20);
      expect(h[0].score).toBe(24);
    });

    it('top is best first, keeps earlier entry first on ties, and respects limit', async () => {
      const scores = [5, 9, 9, 2, 7];
      for (let i = 0; i < scores.length; i++) await store.add(entry('bowling', scores[i], i));
      const top = await store.top('bowling');
      expect(top.map((e) => e.score)).toEqual([9, 9, 7, 5, 2]);
      expect(top[0].at).toBe(at(1));
      expect(top[1].at).toBe(at(2));
      expect(await store.top('bowling', 2)).toHaveLength(2);
      expect((await store.top('bowling', 3, false)).map((e) => e.score)).toEqual([2, 5, 7]);
    });

    it('top defaults to 10 entries', async () => {
      for (let i = 0; i < 12; i++) await store.add(entry('bowling', i, i));
      expect(await store.top('bowling')).toHaveLength(10);
    });

    it('separate sports do not mix', async () => {
      await store.add(entry('bowling', 100, 0));
      await store.add(entry('archery', 7, 1));
      expect((await store.best('bowling'))?.score).toBe(100);
      expect((await store.best('archery'))?.score).toBe(7);
      expect((await store.history('archery')).map((e) => e.sportId)).toEqual(['archery']);
      expect((await store.top('bowling')).map((e) => e.score)).toEqual([100]);
    });

    it('clear removes one sport only', async () => {
      await store.add(entry('bowling', 100, 0));
      await store.add(entry('archery', 7, 1));
      await store.clear('bowling');
      expect(await store.best('bowling')).toBeNull();
      expect(await store.history('bowling')).toEqual([]);
      expect((await store.best('archery'))?.score).toBe(7);
    });

    it('clear() with no argument removes everything', async () => {
      await store.add(entry('bowling', 100, 0));
      await store.add(entry('archery', 7, 1));
      await store.clear();
      expect(await store.best('bowling')).toBeNull();
      expect(await store.best('archery')).toBeNull();
      expect(await store.history('archery')).toEqual([]);
    });

    it('invalid score or sportId rejects with RangeError', async () => {
      await expect(store.add(entry('bowling', NaN))).rejects.toThrow(RangeError);
      await expect(store.add(entry('bowling', Infinity))).rejects.toThrow(RangeError);
      await expect(store.add(entry('', 5))).rejects.toThrow(RangeError);
      expect(await store.best('bowling')).toBeNull();
    });

    it('caps each sport at 200 entries and keeps the personal best', async () => {
      await store.add(entry('bowling', 1000, 0));
      for (let i = 1; i <= 200; i++) await store.add(entry('bowling', i, i));
      const history = await store.history('bowling', 1000);
      expect(history).toHaveLength(200);
      expect((await store.best('bowling'))?.score).toBe(1000);
      expect(history.some((e) => e.score === 1)).toBe(false);
      expect(history.some((e) => e.score === 200)).toBe(true);
    }, 30000);

    it('detail round-trips', async () => {
      const detail = { releaseMs: 412.5, angle: 38 };
      await store.add(entry('bowling', 10, 0, detail));
      expect((await store.best('bowling'))?.detail).toEqual(detail);
      expect((await store.history('bowling'))[0].detail).toEqual(detail);
    });
  });
}

runSuite('MemoryScoreStore', () => new MemoryScoreStore());

let dbCounter = 0;
runSuite(
  'IndexedDbScoreStore',
  () => new IndexedDbScoreStore(`test-${++dbCounter}`, new IDBFactory()),
);

describe('createScoreStore', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

  afterEach(() => {
    if (descriptor) {
      Object.defineProperty(globalThis, 'indexedDB', descriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  });

  it('returns a working MemoryScoreStore when globalThis.indexedDB is undefined', async () => {
    Reflect.deleteProperty(globalThis, 'indexedDB');
    const store = await createScoreStore();
    expect(store).toBeInstanceOf(MemoryScoreStore);
    await store.add(entry('bowling', 3, 0));
    expect((await store.best('bowling'))?.score).toBe(3);
  });

  it('returns an IndexedDbScoreStore when indexedDB opens', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: new IDBFactory(),
      configurable: true,
      writable: true,
    });
    const store = await createScoreStore();
    expect(store).toBeInstanceOf(IndexedDbScoreStore);
    await store.add(entry('bowling', 3, 0));
    expect((await store.best('bowling'))?.score).toBe(3);
  });
});
