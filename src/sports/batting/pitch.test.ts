import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/random';
import { battingConfig } from './config';
import { ballPosition, difficultyFor, flightMsFor, planPitch } from './pitch';
import type { Vec3 } from './pitch';

const cfg = { ...battingConfig };

describe('pitch plan', () => {
  it('difficulty rises through the round and sets the flight time', () => {
    expect([1, 4, 5, 8, 9, 10].map((i) => difficultyFor(i, cfg))).toEqual([
      'easy',
      'easy',
      'medium',
      'medium',
      'hard',
      'hard',
    ]);
    expect(flightMsFor('easy', cfg)).toBe(900);
    expect(flightMsFor('medium', cfg)).toBe(720);
    expect(flightMsFor('hard', cfg)).toBe(600);
  });

  it('arrival time is exact: wind-up plus flight', () => {
    for (let i = 1; i <= 10; i++) {
      const p = planPitch(i, 5000, mulberry32(i), cfg);
      expect(p.releaseMs).toBe(5000 + cfg.windupMs);
      expect(p.arrivalMs).toBe(p.releaseMs + p.flightMs);
    }
  });

  it('the ball is at the plate target at arrival and at the release point at release', () => {
    const out: Vec3 = { x: 0, y: 0, z: 0 };
    for (let i = 1; i <= 10; i++) {
      const p = planPitch(i, 1000, mulberry32(10 + i), cfg);
      ballPosition(p, p.arrivalMs, out);
      expect(out.x).toBeCloseTo(p.tx, 9);
      expect(out.y).toBeCloseTo(p.ty, 9);
      expect(out.z).toBeCloseTo(cfg.plateZ, 9);
      ballPosition(p, p.releaseMs, out);
      expect(out.x).toBeCloseTo(p.rx, 9);
      expect(out.y).toBeCloseTo(p.ry, 9);
      expect(out.z).toBeCloseTo(p.rz, 9);
    }
  });

  it('moves toward the plate monotonically with a slight arc', () => {
    const p = planPitch(1, 0, mulberry32(3), cfg);
    const out: Vec3 = { x: 0, y: 0, z: 0 };
    let last = -Infinity;
    let maxArc = 0;
    for (let t = p.releaseMs; t <= p.arrivalMs; t += 10) {
      ballPosition(p, t, out);
      expect(out.z).toBeGreaterThan(last);
      last = out.z;
      const f = (t - p.releaseMs) / p.flightMs;
      maxArc = Math.max(maxArc, out.y - (p.ry + (p.ty - p.ry) * f));
    }
    expect(maxArc).toBeGreaterThan(0.1);
    expect(maxArc).toBeLessThan(0.4);
  });

  it('uses all three height bands and keeps the lateral wobble small', () => {
    const rnd = mulberry32(42);
    const heights = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const p = planPitch(1, 0, rnd, cfg);
      heights.add(p.ty);
      expect(Math.abs(p.tx)).toBeLessThanOrEqual(cfg.lateralWobble);
    }
    expect([...heights].sort()).toEqual([cfg.heightLow, cfg.heightMiddle, cfg.heightHigh].sort());
  });
});
