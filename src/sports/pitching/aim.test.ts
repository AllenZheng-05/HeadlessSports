import { describe, expect, it } from 'vitest';
import {
  aimPitch,
  baseKmh,
  createAim,
  gloveAim,
  gloveSide,
  heightOffset,
  mouseThrowSpeed,
  pointedAim,
  sideSign,
  steerOffset,
} from './aim';
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

describe('steering: sideways', () => {
  it('a natural release steers nothing, for both hands', () => {
    expect(aim({}, 'right', 'fastball', 4, noAssist).x).toBeCloseTo(0, 9);
    expect(aim({}, 'left', 'fastball', 4, noAssist).x).toBeCloseTo(0, 9);
  });
  it('releasing further out steers that way, for both hands', () => {
    const c = pitchingConfig;
    const r = aim({ lateral: 0.62 + 0.4 }, 'right', 'fastball', 4, noAssist);
    expect(r.x).toBeCloseTo(0.4 * c.steerGainX, 9);
    const l = aim({ lateral: -0.62 - 0.4 }, 'left', 'fastball', 4, noAssist);
    expect(l.x).toBeCloseTo(-0.4 * c.steerGainX, 9);
    expect(aim({ lateral: 0.62 - 0.4 }, 'right', 'fastball', 4, noAssist).x).toBeLessThan(0);
    expect(aim({ lateral: -0.62 + 0.4 }, 'left', 'fastball', 4, noAssist).x).toBeGreaterThan(0);
  });
  it('clamps the steering to a small range', () => {
    const c = pitchingConfig;
    expect(aim({ lateral: 9 }, 'right', 'fastball', 4, noAssist).x).toBe(c.steerMaxX);
    expect(aim({ lateral: -9 }, 'right', 'fastball', 4, noAssist).x).toBe(-c.steerMaxX);
    expect(c.steerMaxX).toBeLessThanOrEqual(0.2);
  });
  it('a gain of 0 turns steering off', () => {
    const off = { ...noAssist, steerGainX: 0, steerGainY: 0 };
    const p = { x: 0, y: 0 };
    steerOffset(off, { speed: 6, vy: 5, lateral: 3, curvature: 0 }, 'right', false, p);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    const a = aim({ lateral: 3, vy: 5 }, 'right', 'fastball', 4, off);
    expect(a.x).toBeCloseTo(0, 9);
    expect(a.y).toBeCloseTo(pitchingConfig.zoneCentreY, 9);
  });
});

describe('the glove hand places the ring', () => {
  const c = pitchingConfig;
  const o = { x: 0, y: 0 };
  /** The glove wrist relative to its own shoulder that sits at the neutral point. */
  const neutral = (hand: 'left' | 'right'): { x: number; y: number } => {
    const g = sideSign(gloveSide(hand));
    return { x: g * c.gloveNeutralX - g * 0.5, y: c.gloveNeutralY };
  };
  it('the glove is the opposite hand', () => {
    expect(gloveSide('right')).toBe('left');
    expect(gloveSide('left')).toBe('right');
  });
  it('the neutral point is the centre of the zone, for both handedness values', () => {
    for (const hand of ['right', 'left'] as const) {
      const n = neutral(hand);
      gloveAim(c, hand, n.x, n.y, o);
      expect(o.x).toBeCloseTo(0, 9);
      expect(o.y).toBeCloseTo(c.zoneCentreY, 9);
    }
  });
  it('moving the glove to screen right moves the ring to screen right, for both handedness values', () => {
    for (const hand of ['right', 'left'] as const) {
      const n = neutral(hand);
      gloveAim(c, hand, n.x + 0.3, n.y, o);
      expect(o.x).toBeCloseTo(0.3 * c.gloveGainX, 9);
      gloveAim(c, hand, n.x - 0.3, n.y, o);
      expect(o.x).toBeCloseTo(-0.3 * c.gloveGainX, 9);
    }
  });
  it('moving the glove up moves the ring up, and down moves it down', () => {
    for (const hand of ['right', 'left'] as const) {
      const n = neutral(hand);
      gloveAim(c, hand, n.x, n.y + 0.3, o);
      expect(o.y).toBeCloseTo(c.zoneCentreY + 0.3 * c.gloveGainY, 9);
      gloveAim(c, hand, n.x, n.y - 0.3, o);
      expect(o.y).toBeCloseTo(c.zoneCentreY - 0.3 * c.gloveGainY, 9);
    }
  });
  it('a comfortable box of about half a shoulder width covers the zone and a margin of balls', () => {
    const n = neutral('right');
    gloveAim(c, 'right', n.x + 0.5, n.y + 0.5, o);
    expect(o.x).toBeGreaterThan(c.zoneWidth / 2 + c.nearMiss);
    expect(o.y - c.zoneCentreY).toBeGreaterThan(c.zoneHeight / 2 + c.nearMiss);
  });
  it('is limited to the reachable range', () => {
    gloveAim(c, 'right', 99, 99, o);
    expect(o.x).toBe(c.maxMiss);
    expect(o.y).toBeCloseTo(c.zoneCentreY + c.heightRange, 9);
    gloveAim(c, 'right', -99, -99, o);
    expect(o.x).toBe(-c.maxMiss);
    expect(o.y).toBeCloseTo(c.zoneCentreY - c.heightRange, 9);
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
  it('uses the mouse range for debug input', () => {
    const c = pitchingConfig;
    expect(heightOffset(c, c.debugProxyLow, true)).toBeCloseTo(-c.heightRange, 9);
    expect(heightOffset(c, c.debugProxyHigh, true)).toBeCloseTo(c.heightRange, 9);
  });
  it('a higher vy / speed steers higher, within the steering clamp', () => {
    const lo = aim({ vy: -2.5 }, 'right', 'fastball', 4, noAssist).y;
    const hi = aim({ vy: 2.2 }, 'right', 'fastball', 4, noAssist).y;
    expect(hi).toBeGreaterThan(lo);
    expect(hi - pitchingConfig.zoneCentreY).toBeLessThanOrEqual(pitchingConfig.steerMaxY + 1e-9);
    expect(lo - pitchingConfig.zoneCentreY).toBeGreaterThanOrEqual(
      -pitchingConfig.steerMaxY - 1e-9,
    );
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

describe('mouse aim', () => {
  const cfg = pitchingConfig;
  const o = { x: 0, y: 0 };
  it('a point on the drawn zone plane maps to the scored plane and back', () => {
    const wx = 0.4 * cfg.zoneVisualScale;
    const wy = cfg.zoneDrawCentreY + 0.2 * cfg.zoneVisualScale;
    pointedAim(cfg, wx, wy, o);
    expect(o.x).toBeCloseTo(0.4, 9);
    expect(o.y).toBeCloseTo(cfg.zoneCentreY + 0.2, 9);
  });
  it('is limited to the range a tracked arm reaches', () => {
    pointedAim(cfg, 99, 99, o);
    expect(o.x).toBe(cfg.maxMiss);
    expect(o.y).toBeCloseTo(cfg.zoneCentreY + cfg.heightRange, 9);
    pointedAim(cfg, -99, -99, o);
    expect(o.x).toBe(-cfg.maxMiss);
    expect(o.y).toBeCloseTo(cfg.zoneCentreY - cfg.heightRange, 9);
  });
  it('the speed is fixed per pitch type', () => {
    expect(mouseThrowSpeed(cfg, 'fastball')).toBe(cfg.mouseFastballSpeed);
    expect(mouseThrowSpeed(cfg, 'curve')).toBe(cfg.mouseCurveSpeed);
  });
});
