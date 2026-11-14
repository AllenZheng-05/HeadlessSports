import { describe, expect, it } from 'vitest';
import { archeryConfig } from './config';
import { Arrow, ArrowState, arrowSpeed, basePitch, hitOnPlane } from './flight';
import type { Hit } from './flight';
import { RING_COLORS, ringScore, ringWidth } from './target';

const cfg = { ...archeryConfig };
const base = basePitch(cfg);
const hit: Hit = { x: 0, y: 0, t: 0 };

describe('arrow speed', () => {
  it('runs from the minimum to the maximum with draw', () => {
    expect(arrowSpeed(0, cfg)).toBe(cfg.minArrowSpeed);
    expect(arrowSpeed(1, cfg)).toBe(cfg.maxArrowSpeed);
    expect(arrowSpeed(0.5, cfg)).toBeCloseTo((cfg.minArrowSpeed + cfg.maxArrowSpeed) / 2);
    expect(arrowSpeed(7, cfg)).toBe(cfg.maxArrowSpeed);
  });
});

describe('flight', () => {
  it('full draw, neutral aim, no wind hits the centre within 1 mm', () => {
    hitOnPlane(cfg, base, 1, 0, 0, 0, hit);
    expect(Math.abs(hit.x)).toBeLessThan(0.001);
    expect(Math.abs(hit.y - cfg.targetHeight)).toBeLessThan(0.001);
  });

  it('still hits the centre for a different range and release height', () => {
    const other = { ...cfg, targetDistance: 45, originY: 1.2, targetHeight: 1.6 };
    hitOnPlane(other, basePitch(other), 1, 0, 0, 0, hit);
    expect(Math.abs(hit.y - other.targetHeight)).toBeLessThan(0.001);
  });

  it('lower draw lands lower', () => {
    hitOnPlane(cfg, base, 0.8, 0, 0, 0, hit);
    const y80 = hit.y;
    hitOnPlane(cfg, base, 0.4, 0, 0, 0, hit);
    const y40 = hit.y;
    expect(y80).toBeLessThan(cfg.targetHeight);
    expect(y40).toBeLessThan(y80);
  });

  it('aiming up raises the hit and aiming right moves it right', () => {
    hitOnPlane(cfg, base, 1, 0, 0.02, 0, hit);
    expect(hit.y).toBeGreaterThan(cfg.targetHeight + 0.3);
    hitOnPlane(cfg, base, 1, 0.01, 0, 0, hit);
    expect(hit.x).toBeGreaterThan(0.2);
    hitOnPlane(cfg, base, 1, -0.01, 0, 0, hit);
    expect(hit.x).toBeLessThan(-0.2);
  });

  it('wind pushes the hit the right way, more at lower draw', () => {
    hitOnPlane(cfg, base, 1, 0, 0, 1, hit);
    const right = hit.x;
    hitOnPlane(cfg, base, 1, 0, 0, -1, hit);
    const left = hit.x;
    expect(right).toBeGreaterThan(0.05);
    expect(left).toBeCloseTo(-right, 6);
    hitOnPlane(cfg, base, 0.3, 0, 0, 1, hit);
    expect(hit.x).toBeGreaterThan(right);
  });

  it('the stepped arrow agrees with the analytic hit within 1 cm', () => {
    const arrow = new Arrow();
    const cases = [
      [1, 0, 0, 0],
      [0.6, 0.03, 0.05, 1.1],
      [0.9, -0.12, 0.01, -0.8],
      [0.3, 0.2, 0.2, 0.4],
    ];
    for (const [draw, yaw, pitch, wind] of cases) {
      hitOnPlane(cfg, base, draw!, yaw!, pitch!, wind!, hit);
      arrow.launch(cfg, base, draw!, yaw!, pitch!, wind!);
      let steps = 0;
      while (arrow.state === ArrowState.Flying && steps < 2000) {
        arrow.step(1 / 120, cfg, 99, -cfg.targetDistance - 2);
        steps++;
        if (arrow.crossed) break;
      }
      expect(arrow.crossed).toBe(true);
      expect(Math.abs(arrow.planeX - hit.x)).toBeLessThan(0.01);
      expect(Math.abs(arrow.planeY - hit.y)).toBeLessThan(0.01);
      expect(Math.abs(arrow.age - hit.t)).toBeLessThan(0.002);
    }
  });

  it('sticks inside the face and flies on past it otherwise', () => {
    const arrow = new Arrow();
    arrow.launch(cfg, base, 1, 0, 0, 0);
    let s: number = ArrowState.Flying;
    for (let i = 0; i < 400 && s === ArrowState.Flying; i++) {
      s = arrow.step(1 / 120, cfg, cfg.targetRadius, -cfg.targetDistance - 1.45);
    }
    expect(s).toBe(ArrowState.Stuck);
    expect(arrow.z).toBeCloseTo(-cfg.targetDistance, 6);

    arrow.launch(cfg, base, 1, 0.1, 0, 0);
    s = ArrowState.Flying;
    for (let i = 0; i < 400 && s === ArrowState.Flying; i++) {
      s = arrow.step(1 / 120, cfg, cfg.targetRadius, -cfg.targetDistance - 1.45);
    }
    expect(s).toBe(ArrowState.Landed);
    expect(arrow.crossed).toBe(true);
  });

  it('lands in the grass short of the target when shot too low', () => {
    const arrow = new Arrow();
    arrow.launch(cfg, base, 0.25, 0, -0.08, 0);
    let s: number = ArrowState.Flying;
    for (let i = 0; i < 400 && s === ArrowState.Flying; i++) {
      s = arrow.step(1 / 120, cfg, cfg.targetRadius, -cfg.targetDistance - 1.45);
    }
    expect(s).toBe(ArrowState.Landed);
    expect(arrow.crossed).toBe(false);
    expect(arrow.y).toBeCloseTo(0, 6);
  });
});

describe('ring scoring', () => {
  const R = cfg.targetRadius;
  const w = ringWidth(R);
  const tol = cfg.lineTolerance;

  it('has ten equal rings', () => {
    expect(w).toBeCloseTo(0.061);
    expect(RING_COLORS).toHaveLength(10);
  });

  it('scores 10 at the centre and 1 at the edge', () => {
    expect(ringScore(0, R, tol)).toBe(10);
    expect(ringScore(w * 0.5, R, tol)).toBe(10);
    expect(ringScore(R - 0.01, R, tol)).toBe(1);
  });

  it('scores each ring between its boundaries', () => {
    for (let ring = 10; ring >= 1; ring--) {
      const n = 11 - ring;
      expect(ringScore((n - 0.5) * w, R, tol)).toBe(ring);
    }
  });

  it('gives the higher ring to a line-cutter, only within the tolerance', () => {
    for (let n = 1; n <= 9; n++) {
      const boundary = n * w;
      expect(ringScore(boundary - 0.0005, R, tol)).toBe(11 - n);
      expect(ringScore(boundary + tol * 0.5, R, tol)).toBe(11 - n);
      expect(ringScore(boundary + tol * 1.5, R, tol)).toBe(10 - n);
    }
  });

  it('misses score 0', () => {
    expect(ringScore(R + tol * 1.5, R, tol)).toBe(0);
    expect(ringScore(3, R, tol)).toBe(0);
  });
});
