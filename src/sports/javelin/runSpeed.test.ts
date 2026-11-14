import { describe, expect, it } from 'vitest';
import { javelinConfig as cfg } from './config';
import { amplitudeFactor, approachSpeed, softCap, targetRunSpeed } from './runSpeed';

describe('soft cap', () => {
  it('is the identity up to the knee', () => {
    for (const x of [0, 0.2, 0.5, 0.8]) expect(softCap(x, 0.8, 1.15)).toBe(x);
  });
  it('is continuous, increasing, diminishing and bounded', () => {
    expect(softCap(0.8001, 0.8, 1.15)).toBeCloseTo(0.8001, 3);
    let prev = 0.8;
    let prevGain = 1;
    for (let x = 0.9; x <= 3; x += 0.1) {
      const y = softCap(x, 0.8, 1.15);
      expect(y).toBeGreaterThan(prev);
      expect(y).toBeLessThan(1.15);
      expect(y - prev).toBeLessThanOrEqual(prevGain + 1e-9);
      prevGain = y - prev;
      prev = y;
    }
    expect(softCap(100, 0.8, 1.15)).toBeCloseTo(1.15, 3);
    expect(softCap(-1, 0.8, 1.15)).toBe(0);
  });
});

describe('amplitude factor', () => {
  it('goes from 0.75 to 1', () => {
    expect(amplitudeFactor(0, cfg)).toBe(0.75);
    expect(amplitudeFactor(0.45, cfg)).toBe(1);
    expect(amplitudeFactor(2, cfg)).toBe(1);
    expect(amplitudeFactor(0.225, cfg)).toBeCloseTo(0.875, 5);
  });
});

describe('target speed', () => {
  it('is 0 when standing and about the max at full cadence and amplitude', () => {
    expect(targetRunSpeed(0, 0.5, cfg)).toBe(0);
    expect(targetRunSpeed(4, 0.45, cfg)).toBeCloseTo(9 * softCap(1, 0.8, 1.15), 5);
    expect(targetRunSpeed(4, 0.45, cfg)).toBeGreaterThan(8);
    expect(targetRunSpeed(4, 0.45, cfg)).toBeLessThan(9 * 1.15);
  });
  it('is linear in cadence below the knee', () => {
    expect(targetRunSpeed(2, 0.45, cfg)).toBeCloseTo(4.5, 5);
    expect(targetRunSpeed(3, 0.45, cfg)).toBeCloseTo(6.75, 5);
  });
  it('small steps are slower', () => {
    expect(targetRunSpeed(3, 0.1, cfg)).toBeLessThan(targetRunSpeed(3, 0.45, cfg));
  });
});

describe('approach', () => {
  it('accelerates at 6 and decelerates at 3 m/s^2', () => {
    expect(approachSpeed(0, 9, 0.5, cfg)).toBeCloseTo(3, 5);
    expect(approachSpeed(8, 0, 0.5, cfg)).toBeCloseTo(6.5, 5);
  });
  it('does not overshoot', () => {
    expect(approachSpeed(5, 5.1, 1, cfg)).toBe(5.1);
    expect(approachSpeed(5, 4.9, 1, cfg)).toBe(4.9);
  });
});
