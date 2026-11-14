import { describe, expect, it } from 'vitest';
import { climbingConfig } from './config';
import { KIND_CRIMP, Layout, mulberry32 } from './layout';

const cfg = climbingConfig;
const make = (seed: number, top = 200): Layout => {
  const l = new Layout(mulberry32(seed), cfg);
  l.ensure(top);
  return l;
};

describe('Layout', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = make(7);
    const b = make(7);
    const c = make(8);
    expect(a.checksum).toBe(b.checksum);
    expect(a.count).toBe(b.count);
    expect(Array.from(a.xs)).toEqual(Array.from(b.xs));
    expect(a.checksum).not.toBe(c.checksum);
  });

  it('does not depend on how lazily it was generated', () => {
    const lazy = new Layout(mulberry32(3), cfg);
    for (let y = 10; y <= 120; y += 3) lazy.ensure(y);
    const eager = make(3, 120);
    const n = Math.min(lazy.count, eager.count);
    expect(Array.from(lazy.ys).slice(0, n)).toEqual(Array.from(eager.ys).slice(0, n));
  });

  it('keeps a route in each lateral half for 200 m', () => {
    const l = make(11, 205);
    for (const sign of [-1, 1]) {
      const ys: number[] = [];
      for (let i = 0; i < l.count; i++) {
        if (Math.sign(l.xs[i]!) === sign && l.ys[i]! <= 200) ys.push(l.ys[i]!);
      }
      ys.sort((a, b) => a - b);
      expect(ys[0]!).toBeLessThan(1.2);
      for (let i = 1; i < ys.length; i++) {
        const gap = ys[i]! - ys[i - 1]!;
        // Near a ledge the shelf replaces a few holds.
        const lo = ys[i - 1]!;
        const nearLedge = Math.floor((ys[i]! + 0.2) / 20) !== Math.floor((lo - 0.2) / 20);
        expect(gap).toBeLessThanOrEqual(nearLedge ? 0.7 : cfg.rowStepM + cfg.rowJitterM + 1e-9);
      }
    }
  });

  it('keeps every pair of holds at least the minimum spacing apart', () => {
    const l = make(5, 150);
    let min = Infinity;
    for (let i = 0; i < l.count; i++) {
      for (let j = i + 1; j < l.count && j < i + 40; j++) {
        min = Math.min(min, Math.hypot(l.xs[i]! - l.xs[j]!, l.ys[i]! - l.ys[j]!));
      }
    }
    expect(min).toBeGreaterThanOrEqual(cfg.minSpacingM - 1e-9);
  });

  it('has no crimps below the start height and more of them higher up, capped', () => {
    const l = make(2, 400);
    const ratio = (lo: number, hi: number): number => {
      let n = 0;
      let c = 0;
      for (let i = 0; i < l.count; i++) {
        if (l.ys[i]! < lo || l.ys[i]! >= hi) continue;
        n++;
        if (l.kinds[i] === KIND_CRIMP) c++;
      }
      return c / n;
    };
    expect(ratio(0, cfg.crimpStartM)).toBe(0);
    expect(ratio(8, 16)).toBeLessThan(ratio(40, 200));
    expect(ratio(60, 400)).toBeLessThan(cfg.crimpMax + 0.05);
  });

  it('puts a rest ledge every 20 m and counts the ground as one', () => {
    const l = make(1, 10);
    expect(l.ledgeY(0)).toBe(0);
    expect(l.ledgeY(3)).toBe(60);
    expect(l.standLevel(0.1)).toBe(0);
    expect(l.standLevel(20.05)).toBe(20);
    expect(l.standLevel(19.9)).toBe(20);
    expect(l.standLevel(10)).toBe(-1);
    expect(l.standLevel(40.6)).toBe(-1);
  });

  it('finds the nearest hold within its own radius only', () => {
    const l = make(4, 20);
    const i = 10;
    const x = l.xs[i]!;
    const y = l.ys[i]!;
    expect(l.findNearest(x, y, -1, -1)).toBe(i);
    expect(l.findNearest(x, y, i, -1)).not.toBe(i);
    expect(l.findNearest(x + 0.5, y + 0.0, -1, -1)).not.toBe(i);
  });
});
