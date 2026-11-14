import { describe, expect, it } from 'vitest';
import { bowlingConfig } from './config';
import { ballSpeedFor, mapRelease, smoothBowlerX, targetBowlerX } from './release';

const cfg = bowlingConfig;
const base = { hand: 'right' as const, speed: 5, lateral: 0.62, curvature: 0 };

describe('release mapping', () => {
  it('maps speed monotonically and clamps at both ends', () => {
    let last = -1;
    for (let s = 0; s <= 12; s += 0.5) {
      const v = ballSpeedFor(s, cfg);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(ballSpeedFor(0, cfg)).toBe(cfg.minBallSpeed);
    expect(ballSpeedFor(cfg.speedFloor, cfg)).toBe(cfg.minBallSpeed);
    expect(ballSpeedFor(cfg.speedCeil, cfg)).toBeCloseTo(cfg.maxBallSpeed);
    expect(ballSpeedFor(40, cfg)).toBeCloseTo(cfg.maxBallSpeed);
    expect(mapRelease({ ...base, speed: 5.25 }, cfg).ballSpeed).toBeCloseTo(7);
    expect(mapRelease({ ...base, speed: 5.25 }, cfg).power).toBeCloseTo(0.5);
  });

  it('goes straight when the wrist is at its neutral offset', () => {
    expect(mapRelease(base, cfg).angle).toBeCloseTo(0);
    expect(mapRelease({ ...base, hand: 'left', lateral: -0.62 }, cfg).angle).toBeCloseTo(0);
  });

  it('aims toward screen right when the wrist is further right', () => {
    expect(mapRelease({ ...base, lateral: 0.62 + 0.5 }, cfg).angle).toBeCloseTo(0.045);
    expect(mapRelease({ ...base, lateral: 0.62 - 0.5 }, cfg).angle).toBeCloseTo(-0.045);
  });

  it('uses the mirrored neutral for the left hand', () => {
    const left = mapRelease({ ...base, hand: 'left', lateral: -0.62 + 0.5 }, cfg);
    expect(left.angle).toBeCloseTo(0.045);
    // The same raw lateral is a different aim for each hand.
    const r = mapRelease({ ...base, lateral: 0 }, cfg).angle;
    const l = mapRelease({ ...base, hand: 'left', lateral: 0 }, cfg).angle;
    expect(r).toBeLessThan(0);
    expect(l).toBeGreaterThan(0);
  });

  it('clamps the angle', () => {
    expect(mapRelease({ ...base, lateral: 9 }, cfg).angle).toBe(cfg.maxAngle);
    expect(mapRelease({ ...base, lateral: -9 }, cfg).angle).toBe(-cfg.maxAngle);
  });

  it('hooks toward the curvature sign and clamps', () => {
    expect(mapRelease({ ...base, curvature: 0.3 }, cfg).hook).toBeGreaterThan(0);
    expect(mapRelease({ ...base, curvature: -0.3 }, cfg).hook).toBeLessThan(0);
    expect(mapRelease({ ...base, curvature: 0 }, cfg).hook).toBe(0);
    expect(mapRelease({ ...base, curvature: 50 }, cfg).hook).toBe(cfg.maxHook);
    expect(mapRelease({ ...base, curvature: -50 }, cfg).hook).toBe(-cfg.maxHook);
  });

  it('maps body offset to bowler position, clamped and smoothed', () => {
    expect(targetBowlerX(0, cfg)).toBe(0);
    expect(targetBowlerX(1, cfg)).toBeCloseTo(cfg.lateralScale);
    expect(targetBowlerX(99, cfg)).toBe(cfg.maxBowlerX);
    expect(targetBowlerX(-99, cfg)).toBe(-cfg.maxBowlerX);
    const a = smoothBowlerX(0, 1, 1 / 60, cfg);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(cfg.lateralScale);
    let x = 0;
    for (let i = 0; i < 600; i++) x = smoothBowlerX(x, 1, 1 / 60, cfg);
    expect(x).toBeCloseTo(cfg.lateralScale, 4);
  });
});
