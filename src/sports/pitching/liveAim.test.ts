import { describe, expect, it } from 'vitest';
import { aimPitch, createAim, createLiveInput, debugLive, trackedLive } from './aim';
import { pitchingConfig as cfg } from './config';
import { LiveAim } from './liveAim';

const p = { x: 0, y: 0 };

describe('the live aim', () => {
  it('at throw speed it is exactly the release aim for the same inputs', () => {
    for (const hand of ['right', 'left'] as const) {
      for (const kind of ['fastball', 'curve'] as const) {
        const arm = { wristX: 0.3, wristY: 0.5, vy: 3, speed: 6 };
        const live = trackedLive(cfg, arm, hand, createLiveInput());
        const la = new LiveAim();
        la.update(cfg, 100, live, hand, kind, 4, p);
        const rel = aimPitch(
          cfg,
          { speed: arm.speed, vy: arm.vy, lateral: live.lateral, curvature: 0 },
          hand,
          kind,
          4,
          false,
          createAim(),
          p,
        );
        expect(la.aim.x).toBeCloseTo(rel.x, 9);
        expect(la.aim.y).toBeCloseTo(rel.y, 9);
        expect(la.aim.rawX).toBeCloseTo(rel.rawX, 9);
        expect(la.aim.rawY).toBeCloseTo(rel.rawY, 9);
      }
    }
  });

  it('keyboard and mouse: the indicator equals the release aim for the same mouse', () => {
    const live = debugLive(cfg, 0.8, 0.3, 'right', createLiveInput());
    const la = new LiveAim();
    la.update(cfg, 5, live, 'right', 'fastball', 2, p);
    const loft = Math.min(1.4, Math.max(0, (0.5 - 0.3) * 1.6 + 0.6));
    const rel = aimPitch(
      cfg,
      { speed: 5, vy: 5 * Math.sin(loft), lateral: 0.62 + (0.8 - 0.5) * 4, curvature: 0 },
      'right',
      'fastball',
      2,
      true,
      createAim(),
      p,
    );
    expect(la.aim.x).toBeCloseTo(rel.x, 6);
    expect(la.aim.y).toBeCloseTo(rel.y, 6);
  });

  it('smooths a slow, jittery hand and does not smooth a throw', () => {
    const la = new LiveAim();
    const slow = { lateral: 0.62, yOffset: 0, speed: 0.2 };
    la.update(cfg, 0, slow, 'right', 'fastball', 4, p);
    const before = la.aim.rawX;
    la.update(cfg, 33, { lateral: 0.9, yOffset: 0, speed: 0.2 }, 'right', 'fastball', 4, p);
    const target = (0.9 - cfg.neutralLateral) * cfg.aimGainX;
    expect(la.aim.rawX).toBeGreaterThan(before);
    expect(la.aim.rawX).toBeLessThan(target * 0.5);
    la.update(cfg, 66, { lateral: 0.9, yOffset: 0, speed: 6 }, 'right', 'fastball', 4, p);
    expect(la.aim.rawX).toBeCloseTo(target, 6);
  });

  it('a release is scored from what the indicator showed at the release time', () => {
    const la = new LiveAim();
    const out = createAim();
    for (let i = 0; i < 10; i++) {
      const lateral = 0.62 + i * 0.1;
      la.update(cfg, i * 33, { lateral, yOffset: 0, speed: 6 }, 'right', 'fastball', 4, p);
    }
    expect(la.at(5 * 33, out)).toBe(true);
    expect(out.rawX).toBeCloseTo(5 * 0.1 * cfg.aimGainX, 5);
    expect(la.at(5 * 33 + 10, out)).toBe(true);
    expect(out.rawX).toBeCloseTo(5 * 0.1 * cfg.aimGainX, 5);
  });

  it('is empty until read, and after a reset', () => {
    const la = new LiveAim();
    expect(la.at(0, createAim())).toBe(false);
    la.update(cfg, 1, { lateral: 0.6, yOffset: 0, speed: 1 }, 'right', 'fastball', 4, p);
    expect(la.ready).toBe(true);
    la.reset();
    expect(la.ready).toBe(false);
    expect(la.at(0, createAim())).toBe(false);
  });

  it('the assist pulls the indicator toward the called cell', () => {
    const la = new LiveAim();
    la.update(cfg, 1, { lateral: 1.4, yOffset: 0.4, speed: 6 }, 'right', 'fastball', 4, p);
    expect(Math.abs(la.aim.x)).toBeLessThan(Math.abs(la.aim.rawX));
  });
});
