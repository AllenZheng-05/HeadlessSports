import { describe, expect, it } from 'vitest';
import { ArcheryRound } from './round';

describe('round', () => {
  it('counts arrows and totals the rings', () => {
    const r = new ArcheryRound(6);
    expect(r.total).toBe(6);
    expect(r.left).toBe(6);
    [10, 8, 9, 7, 10, 3].forEach((ring, i) => r.record(ring, 0.01 * (i + 1)));
    expect(r.taken).toBe(6);
    expect(r.left).toBe(0);
    expect(r.over).toBe(true);
    expect(r.score).toBe(47);
    expect(r.tens).toBe(2);
    expect(r.misses).toBe(0);
    expect(r.bestRing).toBe(10);
    expect(r.ringsText()).toBe('10, 8, 9, 7, 10, 3');
    expect(r.meanErrorCm).toBeCloseTo(3.5);
  });

  it('plays a short round of two arrows', () => {
    const r = new ArcheryRound(2);
    r.record(9, 0.1);
    expect(r.over).toBe(false);
    r.record(0, 2);
    expect(r.over).toBe(true);
    expect(r.score).toBe(9);
    expect(r.misses).toBe(1);
    expect(r.ringsText()).toBe('9, M');
  });

  it('ignores arrows past the end', () => {
    const r = new ArcheryRound(1);
    r.record(5, 0.1);
    r.record(10, 0);
    expect(r.score).toBe(5);
    expect(r.taken).toBe(1);
  });

  it('lets the caller finish exactly once, and only when over', () => {
    const r = new ArcheryRound(2);
    expect(r.takeFinish()).toBe(false);
    r.record(1, 0.5);
    expect(r.takeFinish()).toBe(false);
    r.record(2, 0.5);
    expect(r.takeFinish()).toBe(true);
    expect(r.takeFinish()).toBe(false);
  });

  it('has sane numbers with no arrows', () => {
    const r = new ArcheryRound(3);
    expect(r.score).toBe(0);
    expect(r.meanErrorCm).toBe(0);
    expect(r.bestRing).toBe(0);
  });
});
