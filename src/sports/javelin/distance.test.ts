import { describe, expect, it } from 'vitest';
import { javelinConfig as cfg } from './config';
import {
  createFlight,
  efficiency,
  flightPitch,
  flightRange,
  releaseAngleDeg,
  releaseSpeed,
  startFlight,
  stepFlight,
} from './distance';

describe('release speed', () => {
  it('matches the calibration targets', () => {
    // Full sprint and a full-power throw: about 32.5 m/s.
    expect(releaseSpeed(cfg, 9, 11)).toBeCloseTo(9 + 8.5 + 15, 5);
    // Standing with a weak throw: about 10.
    expect(releaseSpeed(cfg, 0, 2.5)).toBeCloseTo(9, 5);
    expect(releaseSpeed(cfg, 0, 3)).toBeLessThan(10);
  });
  it('is monotonic in run speed and throw speed, and saturates', () => {
    let prev = -1;
    for (let r = 0; r <= 10; r += 0.5) {
      const v = releaseSpeed(cfg, r, 6);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    prev = -1;
    for (let s = 2.5; s <= 11; s += 0.5) {
      const v = releaseSpeed(cfg, 5, s);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(releaseSpeed(cfg, 5, 30)).toBe(releaseSpeed(cfg, 5, 11));
    expect(releaseSpeed(cfg, 5, 0)).toBe(releaseSpeed(cfg, 5, 2.5));
  });
});

describe('release angle proxy', () => {
  it('maps upward releases to higher angles and clamps', () => {
    expect(releaseAngleDeg(cfg, -10, 10)).toBe(cfg.minAngle);
    expect(releaseAngleDeg(cfg, 10, 10)).toBe(cfg.maxAngle);
    expect(releaseAngleDeg(cfg, 0, 10)).toBeGreaterThan(cfg.minAngle);
    expect(releaseAngleDeg(cfg, 0, 10)).toBeLessThan(cfg.maxAngle);
    let prev = -1;
    for (let vy = -8; vy <= 8; vy += 1) {
      const a = releaseAngleDeg(cfg, vy, 8);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });
  it('survives a zero speed', () => {
    expect(Number.isFinite(releaseAngleDeg(cfg, 0, 0))).toBe(true);
  });
  it('the angle curve bends the mapping', () => {
    const lin = releaseAngleDeg(cfg, 0.2 * 10, 10);
    const bent = releaseAngleDeg({ ...cfg, angleCurve: 2 }, 0.2 * 10, 10);
    expect(bent).toBeLessThan(lin);
  });
});

describe('flight', () => {
  it('30 m/s at 35 degrees lands 85 to 95 m away', () => {
    const r = flightRange(cfg, 30, 35);
    expect(r).toBeGreaterThan(85);
    expect(r).toBeLessThan(95);
  });
  it('peaks near 35 degrees and falls off smoothly either side', () => {
    let best = 0;
    let bestA = 0;
    for (let a = 5; a <= 70; a += 0.5) {
      const r = flightRange(cfg, 30, a);
      if (r > best) {
        best = r;
        bestA = a;
      }
    }
    expect(bestA).toBeGreaterThan(32);
    expect(bestA).toBeLessThan(38);
    expect(flightRange(cfg, 30, 12)).toBeLessThan(best * 0.8);
    expect(flightRange(cfg, 30, 52)).toBeLessThan(best * 0.9);
    for (let a = 10; a < 60; a += 1) {
      expect(Math.abs(flightRange(cfg, 30, a + 1) - flightRange(cfg, 30, a))).toBeLessThan(6);
    }
  });
  it('is monotonic in launch speed', () => {
    expect(flightRange(cfg, 25, 35)).toBeGreaterThan(flightRange(cfg, 20, 35));
  });
  it('efficiency is 1 at its centre and shrinks away from it', () => {
    expect(efficiency(cfg, cfg.effCenter)).toBe(1);
    expect(efficiency(cfg, 60)).toBeLessThan(efficiency(cfg, 40));
  });
  it('the stepped flight agrees with the analytic range within 2 cm', () => {
    for (const [v, a] of [
      [31.7, 35],
      [10, 12],
      [22, 52],
      [28, 30],
    ] as const) {
      for (const dt of [1 / 120, 1 / 60, 0.013]) {
        const f = createFlight();
        startFlight(f, cfg, 17, v, a);
        let n = 0;
        while (!f.landed && n++ < 100000) stepFlight(f, cfg, dt);
        expect(f.landed).toBe(true);
        expect(Math.abs(f.x - 17 - flightRange(cfg, v, a))).toBeLessThan(0.02);
        expect(f.y).toBe(0);
      }
    }
  });
  it('is measured from the line: releasing earlier costs exactly the gap', () => {
    const line = 32;
    const land = (x0: number): number => {
      const f = createFlight();
      startFlight(f, cfg, x0, 28, 35);
      while (!f.landed) stepFlight(f, cfg, 1 / 120);
      return f.x - line;
    };
    expect(land(32) - land(29)).toBeCloseTo(3, 1);
  });
  it('pitch follows the velocity', () => {
    const f = createFlight();
    startFlight(f, cfg, 0, 30, 35);
    expect(flightPitch(f)).toBeGreaterThan(0.3);
    for (let i = 0; i < 400; i++) stepFlight(f, cfg, 1 / 120);
    expect(flightPitch(f)).toBeLessThan(0.1);
  });
});
