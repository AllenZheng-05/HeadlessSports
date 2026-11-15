import { describe, expect, it } from 'vitest';
import { battingConfig, DISTANCE_SCALE } from './config';
import { SAMPLE_DT, simulateHit, trajectoryAt } from './flight';

const cfg = { ...battingConfig };

describe('hit flight', () => {
  it('distance rises with exit speed at a fixed angle', () => {
    let last = 0;
    for (let v = cfg.minExit; v <= cfg.maxExit; v += 4) {
      const t = simulateHit(v, 28, cfg);
      expect(t.total).toBeGreaterThan(last);
      last = t.total;
    }
  });

  it('rises with launch angle up to an optimum, then falls', () => {
    const at = (a: number): number => simulateHit(cfg.maxExit * 0.87, a, cfg).carry;
    expect(at(10)).toBeLessThan(at(20));
    expect(at(20)).toBeLessThan(at(30));
    expect(at(55)).toBeLessThan(at(35));
    expect(at(70)).toBeLessThan(at(55));
  });

  it('calibration: a perfect full-power 28 degree hit carries 110 to 125 m of the old model, times the distance scale', () => {
    const t = simulateHit(cfg.maxExit, 28, cfg);
    expect(t.carry).toBeGreaterThan(110 * DISTANCE_SCALE);
    expect(t.carry).toBeLessThan(125 * DISTANCE_SCALE);
    expect(t.homer).toBe(true);
  });

  it('calibration: an average good hit goes 45 to 80 m of the old model, times the distance scale', () => {
    // Half power, good quality: lerp(18, 46, 0.5) * 0.82.
    const a = simulateHit(((cfg.minExit + cfg.maxExit) / 2) * cfg.qualityGood, 25, cfg);
    expect(a.total).toBeGreaterThan(45 * DISTANCE_SCALE);
    expect(a.total).toBeLessThan(80 * DISTANCE_SCALE);
    expect(a.homer).toBe(false);
  });

  it('a grounder rolls out and stops short', () => {
    const t = simulateHit(40 * Math.sqrt(DISTANCE_SCALE), 2, cfg);
    expect(t.grounder).toBe(true);
    expect(t.airS).toBe(0);
    expect(t.total).toBeGreaterThan(15 * DISTANCE_SCALE);
    expect(t.total).toBeLessThan(45 * DISTANCE_SCALE);
    // Stopped at the end.
    expect(t.d[t.count - 1]! - t.d[t.count - 3]!).toBeLessThan(0.05);
    const faster = simulateHit(cfg.maxExit, -8, cfg);
    expect(faster.total).toBeGreaterThan(t.total);
  });

  it('home run detection at the fence', () => {
    const over = simulateHit(cfg.maxExit, 28, cfg);
    expect(over.homer).toBe(true);
    expect(over.total).toBeGreaterThan(cfg.fenceDistance);
    const short = simulateHit(30 * Math.sqrt(DISTANCE_SCALE), 28, cfg);
    expect(short.homer).toBe(false);
    expect(short.total).toBeLessThan(cfg.fenceDistance);
    // A low line drive that reaches the fence under the top of the wall is stopped by it.
    const low = simulateHit(cfg.maxExit, 5, { ...cfg, drag: 0.012 });
    expect(low.homer).toBe(false);
    expect(low.total).toBeLessThanOrEqual(cfg.fenceDistance + 1e-6);
  });

  it('trajectoryAt interpolates and clamps', () => {
    const t = simulateHit(40, 25, cfg);
    const out = { d: 0, y: 0 };
    trajectoryAt(t, -1, out);
    expect(out.d).toBe(0);
    expect(out.y).toBeCloseTo(cfg.hitStartHeight, 5);
    trajectoryAt(t, SAMPLE_DT * 10.5, out);
    expect(out.d).toBeCloseTo((t.d[10]! + t.d[11]!) / 2, 4);
    trajectoryAt(t, 100, out);
    expect(out.d).toBeCloseTo(t.total, 3);
  });
});
