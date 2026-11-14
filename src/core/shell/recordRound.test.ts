import { describe, expect, it } from 'vitest';
import { MemoryScoreStore } from '../scores';
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
