import { describe, expect, it } from 'vitest';
import { mulberry32 } from './random';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });

  it('differs between seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const r = mulberry32(7);
    let sum = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / n).toBeGreaterThan(0.45);
    expect(sum / n).toBeLessThan(0.55);
  });
});
