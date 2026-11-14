import { describe, expect, it } from 'vitest';
import { aimPitch, baseKmh, createAim, heightOffset, sideSign } from './aim';
import type { ThrowSample } from './aim';
import { pitchingConfig } from './config';

const base: ThrowSample = { speed: 6, vy: 0, lateral: 0, curvature: 0 };
const aim = (
  e: Partial<ThrowSample>,
  hand: 'left' | 'right',
  kind: 'fastball' | 'curve',
  target = 4,
  cfg = pitchingConfig,
) => {
  const e2 = { ...base, lateral: sideSign(hand) * cfg.neutralLateral, ...e };
  return aimPitch(cfg, e2, hand, kind, target, false, createAim(), { x: 0, y: 0 });
};
const noAssist = { ...pitchingConfig, assist: 0 };
const mid = (pitchingConfig.proxyLow + pitchingConfig.proxyHigh) / 2;

describe('aim: horizontal', () => {
  it('a natural release is straight for both hands', () => {
    expect(aim({}, 'right', 'fastball', 4, noAssist).x).toBeCloseTo(0, 9);
    expect(aim({}, 'left', 'fastball', 4, noAssist).x).toBeCloseTo(0, 9);
  });
  it('releasing further out moves the pitch that way, for both hands', () => {
    const r = aim({ lateral: 0.62 + 0.4 }, 'right', 'fastball', 4, noAssist);
    expect(r.x).toBeCloseTo(0.4 * pitchingConfig.aimGainX, 9);
    const l = aim({ lateral: -0.62 - 0.4 }, 'left', 'fastball', 4, noAssist);
    expect(l.x).toBeCloseTo(-0.4 * pitchingConfig.aimGainX, 9);
    expect(aim({ lateral: 0.62 - 0.4 }, 'right', 'fastball', 4, noAssist).x).toBeLessThan(0);
    expect(aim({ lateral: -0.62 + 0.4 }, 'left', 'fastball', 4, noAssist).x).toBeGreaterThan(0);
  });
  it('clamps the sideways miss', () => {
    expect(aim({ lateral: 9 }, 'right', 'fastball', 4, noAssist).x).toBe(pitchingConfig.maxMiss);
    expect(aim({ lateral: -9 }, 'right', 'fastball', 4, noAssist).x).toBe(-pitchingConfig.maxMiss);
  });
});

describe('aim: vertical', () => {
  it('maps the proxy linearly and clamps', () => {
    const c = pitchingConfig;
    expect(heightOffset(c, mid, false)).toBeCloseTo(0, 9);
    expect(heightOffset(c, c.proxyLow, false)).toBeCloseTo(-c.heightRange, 9);
    expect(heightOffset(c, c.proxyHigh, false)).toBeCloseTo(c.heightRange, 9);
    expect(heightOffset(c, 5, false)).toBeCloseTo(c.heightRange, 9);
    expect(heightOffset(c, -5, false)).toBeCloseTo(-c.heightRange, 9);
  });
  it('uses the keyboard range for debug input', () => {
    const c = pitchingConfig;
    expect(heightOffset(c, c.debugProxyLow, true)).toBeCloseTo(-c.heightRange, 9);
    expect(heightOffset(c, c.debugProxyHigh, true)).toBeCloseTo(c.heightRange, 9);
  });
  it('a higher vy / speed throws higher', () => {
    const lo = aim({ vy: -2.5 }, 'right', 'fastball', 4, noAssist).y;
    const hi = aim({ vy: 2.2 }, 'right', 'fastball', 4, noAssist).y;
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('aim: curveball', () => {
  it('breaks down and toward the glove side', () => {
    const f = aim({ vy: mid * 6 }, 'right', 'fastball', 4, noAssist);
    const c = aim({ vy: mid * 6 }, 'right', 'curve', 4, noAssist);
    expect(c.y).toBeCloseTo(f.y - pitchingConfig.curveDrop, 9);
    expect(c.x).toBeCloseTo(f.x - pitchingConfig.curveSide, 9);
    const fl = aim({}, 'left', 'fastball', 4, noAssist);
    const cl = aim({}, 'left', 'curve', 4, noAssist);
    expect(cl.x).toBeCloseTo(fl.x + pitchingConfig.curveSide, 9);
    expect(cl.y).toBeCloseTo(fl.y - pitchingConfig.curveDrop, 9);
  });
  it('is slower, and the curvature gain adds sideways break', () => {
    expect(aim({}, 'right', 'curve').kmh).toBeCloseTo(
      aim({}, 'right', 'fastball').kmh * pitchingConfig.curveSpeedFactor,
      9,
    );
    const cfg = { ...noAssist, curvatureGain: 0.1 };
    const a = aim({ curvature: 0 }, 'right', 'curve', 4, cfg).x;
    const b = aim({ curvature: 2 }, 'right', 'curve', 4, cfg).x;
    expect(b - a).toBeCloseTo(0.2, 9);
  });
});

describe('aim: assist', () => {
  it('pulls the location toward the lit cell by the assist fraction', () => {
    const cfg = { ...pitchingConfig, assist: 0.35 };
    const raw = aim({ lateral: 0.62 + 1 }, 'right', 'fastball', 4, { ...cfg, assist: 0 });
    const r = aim({ lateral: 0.62 + 1 }, 'right', 'fastball', 4, cfg);
    expect(r.rawX).toBeCloseTo(raw.x, 9);
    expect(r.x).toBeCloseTo(raw.x * 0.65, 9);
    // The centre cell is centred on the zone centre.
    expect(r.y).toBeCloseTo(raw.y + (cfg.zoneCentreY - raw.y) * 0.35, 9);
  });
});

describe('speed', () => {
  it('maps wrist speed to km/h and clamps', () => {
    const c = pitchingConfig;
    expect(baseKmh(c, 0)).toBe(c.minKmh);
    expect(baseKmh(c, c.speedFloor)).toBe(c.minKmh);
    expect(baseKmh(c, c.speedCeil)).toBe(c.maxKmh);
    expect(baseKmh(c, 99)).toBe(c.maxKmh);
    expect(baseKmh(c, (c.speedFloor + c.speedCeil) / 2)).toBeCloseTo((c.minKmh + c.maxKmh) / 2, 9);
  });
  it('caps the scored speed but not the shown one', () => {
    const a = aim({ speed: 9 }, 'right', 'fastball');
    expect(a.kmh).toBe(pitchingConfig.maxKmh);
    expect(a.scoredKmh).toBe(pitchingConfig.scoredSpeedCapKmh);
    const slow = aim({ speed: 3 }, 'right', 'fastball');
    expect(slow.scoredKmh).toBe(slow.kmh);
  });
});
