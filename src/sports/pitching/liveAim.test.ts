import { describe, expect, it } from 'vitest';
import { createAim, createLiveInput, gloveAim, placeAim, trackedLive } from './aim';
import type { LiveInput } from './aim';
import { pitchingConfig as cfg } from './config';
import { LiveAim } from './liveAim';

const p = { x: 0, y: 0 };
const input = (baseX: number, baseY: number, speed = 0, gloveTracked = true): LiveInput => ({
  baseX,
  baseY,
  gloveTracked,
  speed,
});
const STEP = 33;

describe('the live aim (glove hand)', () => {
  it('at rest it is placeAim of the glove point', () => {
    for (const hand of ['right', 'left'] as const) {
      for (const kind of ['fastball', 'curve'] as const) {
        const li = trackedLive(
          cfg,
          { wristX: 0.1, wristY: 0.2 },
          0.1,
          hand,
          true,
          createLiveInput(),
          p,
        );
        const la = new LiveAim();
        la.update(cfg, 100, li, hand, kind, 4, p);
        const want = placeAim(cfg, hand, kind, 4, li.baseX, li.baseY, 0.1, 0, createAim(), p);
        expect(la.aim.x).toBeCloseTo(want.x, 9);
        expect(la.aim.y).toBeCloseTo(want.y, 9);
        expect(la.aim.rawX).toBeCloseTo(want.rawX, 9);
        expect(la.aim.rawY).toBeCloseTo(want.rawY, 9);
      }
    }
  });

  it('the glove moving to screen right moves the ring to screen right, for both handedness values', () => {
    for (const hand of ['right', 'left'] as const) {
      const a = { x: 0, y: 0 };
      const b = { x: 0, y: 0 };
      gloveAim(cfg, hand, -0.2, 0, a);
      gloveAim(cfg, hand, 0.2, 0, b);
      const la = new LiveAim();
      la.update(cfg, 0, input(a.x, a.y), hand, 'fastball', 4, p);
      const before = la.aim.rawX;
      for (let i = 1; i < 30; i++)
        la.update(cfg, i * STEP, input(b.x, b.y), hand, 'fastball', 4, p);
      expect(la.aim.rawX).toBeGreaterThan(before);
    }
  });

  it('smooths a jittery glove', () => {
    const la = new LiveAim();
    la.update(cfg, 0, input(0, cfg.zoneCentreY), 'right', 'fastball', 4, p);
    la.update(cfg, STEP, input(0.3, cfg.zoneCentreY), 'right', 'fastball', 4, p);
    expect(la.aim.rawX).toBeGreaterThan(0);
    expect(la.aim.rawX).toBeLessThan(0.15);
  });

  it('holds still once the throwing arm is moving, at what the ring showed just before', () => {
    const la = new LiveAim();
    let t = 0;
    // Aim at the left edge for a second, then move the glove right while still slow.
    for (; t < 1000; t += STEP) la.update(cfg, t, input(-0.3, 0.8), 'right', 'fastball', 4, p);
    for (; t < 1300; t += STEP) la.update(cfg, t, input(0.3, 0.8, 0.3), 'right', 'fastball', 4, p);
    const settled = la.aim.rawX;
    expect(settled).toBeGreaterThan(-0.3);
    expect(la.locked).toBe(false);
    // The throw starts: the throwing wrist passes the lock speed. The glove then swings away.
    for (let k = 0; k < 8; k++, t += STEP) {
      la.update(cfg, t, input(-0.8, 0.2, cfg.lockSpeed + 1 + k), 'right', 'fastball', 4, p);
    }
    expect(la.locked).toBe(true);
    // The ring did not follow the tucked glove.
    expect(la.aim.rawX).toBeGreaterThan(settled - 0.12);
    const held = la.aim.rawX;
    const out = createAim();
    expect(la.forRelease(cfg, t - STEP, true, out)).toBe(true);
    expect(out.rawX).toBeCloseTo(held, 5);
    // More glove movement during the throw changes nothing.
    for (let k = 0; k < 6; k++, t += STEP) {
      la.update(cfg, t, input(0.9, 0.3, 8), 'right', 'fastball', 4, p);
    }
    expect(la.aim.rawX).toBeCloseTo(held, 9);
  });

  it('the release reads the same value whatever the glove does during the throw', () => {
    const run = (gloveDuring: number): number => {
      const la = new LiveAim();
      let t = 0;
      for (; t < 1000; t += STEP) la.update(cfg, t, input(0.1, 0.9), 'right', 'fastball', 4, p);
      for (let k = 0; k < 10; k++, t += STEP) {
        la.update(cfg, t, input(gloveDuring, 0.2, 6), 'right', 'fastball', 4, p);
      }
      const out = createAim();
      la.forRelease(cfg, t - 3 * STEP, true, out);
      return out.rawX;
    };
    expect(run(-0.8)).toBeCloseTo(run(0.8), 3);
  });

  it('tracking resumes when the throwing arm slows without a throw', () => {
    const la = new LiveAim();
    let t = 0;
    for (; t < 500; t += STEP) la.update(cfg, t, input(0, 0.8), 'right', 'fastball', 4, p);
    la.update(cfg, t, input(0, 0.8, 5), 'right', 'fastball', 4, p);
    t += STEP;
    expect(la.locked).toBe(true);
    for (let k = 0; k < 40; k++, t += STEP) {
      la.update(cfg, t, input(0.4, 0.8, 0.2), 'right', 'fastball', 4, p);
    }
    expect(la.locked).toBe(false);
    expect(la.aim.rawX).toBeGreaterThan(0.3);
  });

  it('a release the ring was not held for uses the value a fallback lead earlier', () => {
    const la = new LiveAim();
    let t = 0;
    for (let i = 0; i < 40; i++, t += STEP) {
      la.update(cfg, t, input(i < 20 ? -0.4 : 0.4, 0.8, 0.2), 'right', 'fastball', 4, p);
    }
    const out = createAim();
    la.forRelease(cfg, t - STEP, true, out);
    const early = createAim();
    la.at(t - STEP - cfg.lockFallbackLeadMs, early);
    expect(out.rawX).toBeCloseTo(early.rawX, 9);
  });

  it('glove lost: holds for the grace period, then eases to the centre of the zone', () => {
    const la = new LiveAim();
    let t = 0;
    for (; t < 1500; t += STEP) la.update(cfg, t, input(0.4, 1.2), 'right', 'fastball', 4, p);
    const last = { x: la.aim.rawX, y: la.aim.rawY };
    expect(last.x).toBeCloseTo(0.4, 2);
    const lostAt = t;
    for (; t < lostAt + cfg.gloveGraceMs - 100; t += STEP) {
      la.update(cfg, t, input(-0.5, 0.3, 0, false), 'right', 'fastball', 4, p);
    }
    expect(la.aim.rawX).toBeCloseTo(last.x, 2);
    expect(la.aim.rawY).toBeCloseTo(last.y, 2);
    expect(la.ready).toBe(true);
    for (; t < lostAt + cfg.gloveGraceMs + 6000; t += STEP) {
      la.update(cfg, t, input(-0.5, 0.3, 0, false), 'right', 'fastball', 4, p);
    }
    expect(la.aim.rawX).toBeCloseTo(0, 1);
    expect(la.aim.rawY).toBeCloseTo(cfg.zoneCentreY, 1);
  });

  it('a glove that was never seen puts the ring at the centre straight away', () => {
    const la = new LiveAim();
    la.update(cfg, 0, input(0.5, 1.2, 0, false), 'left', 'fastball', 4, p);
    expect(la.ready).toBe(true);
    expect(la.aim.rawX).toBeCloseTo(0, 9);
    expect(la.aim.rawY).toBeCloseTo(cfg.zoneCentreY, 9);
    // And a throw is still read.
    const out = createAim();
    expect(la.forRelease(cfg, 10, true, out)).toBe(true);
  });

  it('is empty until read, and after a reset', () => {
    const la = new LiveAim();
    expect(la.at(0, createAim())).toBe(false);
    la.update(cfg, 1, input(0, 0.8), 'right', 'fastball', 4, p);
    expect(la.ready).toBe(true);
    la.reset();
    expect(la.ready).toBe(false);
    expect(la.at(0, createAim())).toBe(false);
  });

  it('the assist pulls the indicator toward the called cell', () => {
    const la = new LiveAim();
    la.update(cfg, 1, input(0.8, 1.2), 'right', 'fastball', 4, p);
    expect(Math.abs(la.aim.x)).toBeLessThan(Math.abs(la.aim.rawX));
  });
});

describe('mouse play is unchanged', () => {
  it('setDirect is the pointed spot exactly, with no assist, and a release reads it back', () => {
    const la = new LiveAim();
    la.setDirect(10, 0.3, 0.9);
    expect(la.ready).toBe(true);
    expect(la.aim.x).toBe(0.3);
    expect(la.aim.y).toBe(0.9);
    la.setDirect(20, -0.2, 0.7);
    const out = createAim();
    expect(la.forRelease(cfg, 25, false, out)).toBe(true);
    expect(out.x).toBeCloseTo(-0.2, 5);
    expect(out.y).toBeCloseTo(0.7, 5);
    expect(la.forRelease(cfg, 12, false, out)).toBe(true);
    expect(out.x).toBeCloseTo(0.3, 5);
    expect(la.locked).toBe(false);
  });
});
