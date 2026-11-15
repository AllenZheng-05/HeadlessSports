import { describe, expect, it } from 'vitest';
import { MemoryScoreStore } from '../scores';
import { scoreKeyOf } from '../sport';
import type { SportMeta } from '../sport';
import { recordRound } from './recordRound';

const meta = {
  id: 'warmup',
  score: { label: 'Time', unit: 's', decimals: 1, higherIsBetter: false },
} as unknown as SportMeta;

describe('recordRound', () => {
  it('stores a normal round and claims the first best', async () => {
    const scores = new MemoryScoreStore();
    const r = await recordRound(scores, meta, { score: 6.2, headline: '6.2 s' });
    expect(r).toEqual({ isBest: true, best: 6.2 });
    expect((await scores.history('warmup')).length).toBe(1);
  });

  it('does not store or claim a best when saveScore is false, even on a first play', async () => {
    const scores = new MemoryScoreStore();
    const r = await recordRound(scores, meta, {
      score: 20,
      headline: "Time's up",
      saveScore: false,
    });
    expect(r).toEqual({ isBest: false, best: null });
    expect(await scores.history('warmup')).toEqual([]);
    expect(await scores.best('warmup', false)).toBeNull();
  });

  it('reports the existing best for an unsaved round', async () => {
    const scores = new MemoryScoreStore();
    await recordRound(scores, meta, { score: 7, headline: '7 s' });
    const r = await recordRound(scores, meta, { score: 20, headline: 'x', saveScore: false });
    expect(r).toEqual({ isBest: false, best: 7 });
    expect((await scores.history('warmup')).length).toBe(1);
  });
});

describe('recordRound with a scoreKey', () => {
  const versioned = { ...meta, id: 'batting', scoreKey: 'batting-ft' } as unknown as SportMeta;

  it('does not see bests saved under the sport id, and saves under the key', async () => {
    const scores = new MemoryScoreStore();
    await scores.add({ sportId: 'batting', score: 120, at: 'x' }, true);
    const r = await recordRound(scores, versioned, { score: 300, headline: '300 ft' });
    expect(r).toEqual({ isBest: true, best: 300 });
    expect((await scores.best('batting', true))?.score).toBe(120);
    expect((await scores.best('batting-ft', true))?.score).toBe(300);
    const unsaved = await recordRound(scores, versioned, {
      score: 1,
      headline: 'x',
      saveScore: false,
    });
    expect(unsaved.best).toBe(300);
  });

  it('scoreKeyOf defaults to the id', () => {
    expect(scoreKeyOf({ id: 'a' })).toBe('a');
    expect(scoreKeyOf({ id: 'a', scoreKey: 'b' })).toBe('b');
  });
});
