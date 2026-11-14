import { describe, expect, it } from 'vitest';
import { SlopeEstimator } from './slope';

describe('SlopeEstimator', () => {
  it('is 0 until two samples', () => {
    const s = new SlopeEstimator(4);
    expect(s.slope()).toBe(0);
    s.push(1, 0);
    expect(s.slope()).toBe(0);
  });

  it('is exact on a line, in units per second', () => {
    const s = new SlopeEstimator(5);
    for (let i = 0; i < 12; i++) s.push(3 + 2 * (i * 0.0333), i * 33.3);
    expect(s.slope()).toBeCloseTo(2, 4);
  });

  it('is safe with equal timestamps', () => {
    const s = new SlopeEstimator(4);
    s.push(1, 100);
    s.push(5, 100);
    expect(s.slope()).toBe(0);
    s.push(NaN, 133);
    expect(Number.isFinite(s.slope())).toBe(true);
  });

  it('only looks at the last N samples', () => {
    const s = new SlopeEstimator(3);
    for (let i = 0; i < 5; i++) s.push(100, i * 100);
    for (let i = 5; i < 8; i++) s.push((i - 5) * 0.1, i * 100);
    expect(s.slope()).toBeCloseTo(1, 6);
  });

  it('reset clears history', () => {
    const s = new SlopeEstimator(4);
    s.push(0, 0);
    s.push(1, 100);
    s.reset();
    expect(s.slope()).toBe(0);
  });
});
