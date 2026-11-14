import { describe, expect, it } from 'vitest';
import { createWarmupState, isWon, onFist, tick } from './rules';

const limits = { fistsToWin: 3, timeLimitS: 2 };

describe('warm-up rules', () => {
  it('counts fists and finishes on the last one', () => {
    const s = createWarmupState();
    onFist(s, limits);
    onFist(s, limits);
    expect(s.done).toBe(false);
    onFist(s, limits);
    expect(s).toMatchObject({ count: 3, done: true });
    expect(isWon(s, limits)).toBe(true);
  });

  it('stops counting and timing once done', () => {
    const s = createWarmupState();
    for (let i = 0; i < 5; i++) onFist(s, limits);
    expect(s.count).toBe(3);
    tick(s, 1, limits);
    expect(s.elapsed).toBe(0);
  });

  it('times out at the limit without winning', () => {
    const s = createWarmupState();
    onFist(s, limits);
    tick(s, 1.5, limits);
    expect(s.done).toBe(false);
    tick(s, 1.5, limits);
    expect(s).toMatchObject({ elapsed: 2, done: true });
    expect(isWon(s, limits)).toBe(false);
  });
});
