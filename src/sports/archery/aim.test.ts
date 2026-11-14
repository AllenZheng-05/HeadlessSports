import { describe, expect, it } from 'vitest';
import { POSE_COUNT, POSE_STRIDE, PoseIndex } from '../../tracking/types';
import {
  DampedValue,
  bowArmUp,
  bowOut,
  drawFraction,
  swayAmplitude,
  swayOffset,
  targetPitch,
  targetYaw,
  wristDistanceRawException,
} from './aim';
import type { Sway } from './aim';
import { archeryConfig } from './config';

const cfg = { ...archeryConfig };

describe('bow arm up', () => {
  it('needs reach and roughly shoulder height', () => {
    expect(bowArmUp(1.2, 0.1, cfg)).toBe(true);
    expect(bowArmUp(-1.2, 0.1, cfg)).toBe(true);
    expect(bowArmUp(0.2, -1.4, cfg)).toBe(false); // hanging
    expect(bowArmUp(0.3, 0.3, cfg)).toBe(false); // too close to the shoulder
    expect(bowArmUp(0.5, 0.95, cfg)).toBe(false); // too high
    expect(bowArmUp(1.2, -0.95, cfg)).toBe(false); // too low
  });

  it('uses the thresholds from the config', () => {
    const loose = { ...cfg, bowMinReach: 0.3, bowMaxDrop: 1.5 };
    expect(bowArmUp(0.3, 0.1, loose)).toBe(true);
    expect(bowArmUp(0.5, 1.4, loose)).toBe(true);
  });
});

describe('aim mapping', () => {
  it('is out-positive for both bow sides and yaw follows the screen direction', () => {
    expect(bowOut(-1.4, 'left')).toBeCloseTo(1.4);
    expect(bowOut(1.4, 'right')).toBeCloseTo(1.4);
    // Neutral aims straight.
    expect(targetYaw(-cfg.neutralX, 'left', cfg)).toBeCloseTo(0);
    expect(targetYaw(cfg.neutralX, 'right', cfg)).toBeCloseTo(0);
    // Further out aims further out: left bow arm -> negative (left) yaw, right -> positive.
    expect(targetYaw(-1.6, 'left', cfg)).toBeLessThan(0);
    expect(targetYaw(1.6, 'right', cfg)).toBeGreaterThan(0);
    expect(targetYaw(-1.6, 'left', cfg)).toBeCloseTo(-targetYaw(1.6, 'right', cfg));
    // Pulling the bow hand in aims back across the middle.
    expect(targetYaw(-0.8, 'left', cfg)).toBeGreaterThan(0);
  });

  it('applies the gain in radians per shoulder width', () => {
    expect(targetYaw(1.2 + 0.4, 'right', cfg)).toBeCloseTo(0.4 * cfg.aimGainX);
    expect(targetPitch(0.4, cfg)).toBeCloseTo(0.4 * cfg.aimGainY);
  });

  it('clamps yaw and pitch', () => {
    expect(targetYaw(9, 'right', cfg)).toBeCloseTo(cfg.maxYaw);
    expect(targetYaw(-9, 'right', cfg)).toBeCloseTo(-cfg.maxYaw);
    expect(targetPitch(9, cfg)).toBeCloseTo(cfg.maxPitch);
    expect(targetPitch(-9, cfg)).toBeCloseTo(cfg.minPitch);
  });
});

describe('smoothing', () => {
  it('settles on a step without overshoot', () => {
    const f = new DampedValue();
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      f.update(1, 1 / 120, 0.12);
      peak = Math.max(peak, f.value);
    }
    expect(peak).toBeLessThanOrEqual(1.0001);
    expect(f.value).toBeGreaterThan(0.999);
  });

  it('is about 120 ms: most of the way there after 250 ms', () => {
    const f = new DampedValue();
    for (let i = 0; i < 30; i++) f.update(1, 1 / 120, 0.12);
    expect(f.value).toBeGreaterThan(0.5);
    expect(f.value).toBeLessThan(0.95);
  });
});

describe('sway', () => {
  const phases = [0.3, 1.7, 2.9, 4.1];
  const out: Sway = { x: 0, y: 0 };

  it('grows from nothing to the maximum over the ramp and stays there', () => {
    expect(swayAmplitude(0, cfg)).toBe(0);
    expect(swayAmplitude(cfg.swayRampS / 2, cfg)).toBeCloseTo(cfg.maxSwayRad / 2);
    expect(swayAmplitude(cfg.swayRampS, cfg)).toBeCloseTo(cfg.maxSwayRad);
    expect(swayAmplitude(60, cfg)).toBeCloseTo(cfg.maxSwayRad);
  });

  it('is bounded and deterministic', () => {
    const amp = cfg.maxSwayRad;
    let max = 0;
    for (let t = 0; t < 60; t += 0.01) {
      swayOffset(t, amp, phases, out);
      max = Math.max(max, Math.abs(out.x), Math.abs(out.y));
      const x = out.x;
      const y = out.y;
      swayOffset(t, amp, phases, out);
      expect(out.x).toBe(x);
      expect(out.y).toBe(y);
    }
    expect(max).toBeLessThanOrEqual(amp);
    expect(max).toBeGreaterThan(amp * 0.5);
  });

  it('is zero with zero amplitude', () => {
    swayOffset(3.3, 0, phases, out);
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(0, 12);
  });
});

function poseWith(lx: number, ly: number, rx: number, ry: number, vis = 0.9): Float32Array {
  const pose = new Float32Array(POSE_COUNT * POSE_STRIDE);
  const l = PoseIndex.LEFT_WRIST * POSE_STRIDE;
  const r = PoseIndex.RIGHT_WRIST * POSE_STRIDE;
  pose[l] = lx;
  pose[l + 1] = ly;
  pose[l + 3] = vis;
  pose[r] = rx;
  pose[r + 1] = ry;
  pose[r + 3] = vis;
  return pose;
}

describe('draw', () => {
  it('measures the wrist distance in shoulder widths with aspect correction', () => {
    const aspect = 16 / 9;
    const sw = 0.13;
    const d = wristDistanceRawException(poseWith(0.3, 0.3, 0.4, 0.35), aspect, sw);
    expect(d).toBeCloseTo(Math.hypot(0.1 * aspect, 0.05) / sw, 4);
  });

  it('refuses when the wrists are not visible or the shoulders are unknown', () => {
    expect(wristDistanceRawException(poseWith(0.3, 0.3, 0.4, 0.3, 0.1), 1.7, 0.13)).toBe(-1);
    expect(wristDistanceRawException(poseWith(0.3, 0.3, 0.4, 0.3), 1.7, 0)).toBe(-1);
  });

  it('maps distance to 0..1 between drawStart and drawFull', () => {
    expect(drawFraction(0.2, cfg)).toBe(0);
    expect(drawFraction(cfg.drawStart, cfg)).toBe(0);
    expect(drawFraction((cfg.drawStart + cfg.drawFull) / 2, cfg)).toBeCloseTo(0.5);
    expect(drawFraction(cfg.drawFull, cfg)).toBe(1);
    expect(drawFraction(5, cfg)).toBe(1);
  });
});
