import { describe, expect, it } from 'vitest';
import { battingConfig } from './config';
import {
  batHeightM,
  judgeSwing,
  launchAngle,
  noSwingResolveMs,
  powerFromSpeed,
  swingInWindow,
  swingPower,
} from './judge';
import type { SwingInput } from './judge';
import { planPitch } from './pitch';
import type { Pitch } from './pitch';

const cfg = { ...battingConfig };

function pitch(): Pitch {
  const p = planPitch(1, 10_000, () => 0.5, cfg);
  p.ty = 0.85; // band 1
  return p;
}

/** A swing whose bat reaches the plate `errorMs` after the ball arrives. */
function swingWithError(p: Pitch, errorMs: number, over: Partial<SwingInput> = {}): SwingInput {
  return {
    t: p.arrivalMs + errorMs - cfg.batTravelMs,
    startSpeed: 6,
    // Bat height equals the ball height: 1.3 + h * 0.4 - 0.35 = 0.85.
    height: (0.85 - cfg.shoulderHeightM + cfg.batDrop) / cfg.swToMetres,
    peakSpeed: 9,
    ...over,
  };
}

describe('timing bands', () => {
  const p = pitch();
  const q = (e: number): string => judgeSwing(cfg, p, swingWithError(p, e), 'right').quality;

  it('puts each boundary in the right band', () => {
    expect(q(0)).toBe('perfect');
    expect(q(cfg.perfectMs)).toBe('perfect');
    expect(q(cfg.perfectMs + 1)).toBe('good');
    expect(q(cfg.goodMs)).toBe('good');
    expect(q(cfg.goodMs + 1)).toBe('weak');
    expect(q(cfg.okMs)).toBe('weak');
    expect(q(cfg.okMs + 1)).toBe('foul');
    expect(q(cfg.foulMs)).toBe('foul');
    expect(q(cfg.foulMs + 1)).toBe('miss');
  });

  it('is symmetric early and late', () => {
    expect(q(-cfg.perfectMs)).toBe('perfect');
    expect(q(-cfg.goodMs)).toBe('good');
    expect(q(-cfg.okMs)).toBe('weak');
    expect(q(-cfg.foulMs)).toBe('foul');
    expect(q(-cfg.foulMs - 1)).toBe('miss');
  });

  it('labels early and late misses and reports the signed error', () => {
    const early = judgeSwing(cfg, p, swingWithError(p, -300), 'right');
    expect(early.reason).toBe('early');
    expect(early.label).toBe('Too early');
    expect(early.timingError).toBe(-300);
    const late = judgeSwing(cfg, p, swingWithError(p, 300), 'right');
    expect(late.reason).toBe('late');
    expect(late.label).toBe('Too late');
    expect(late.timingError).toBe(300);
  });

  it('judges by the swing timestamp, so event arrival time cannot matter', () => {
    const s = swingWithError(p, 20);
    const a = judgeSwing(cfg, p, s, 'right');
    const b = judgeSwing(cfg, p, { ...s }, 'right');
    expect(a).toEqual(b);
    expect(a.contactMs).toBe(s.t + cfg.batTravelMs);
  });
});

describe('swing windows', () => {
  const p = pitch();
  it('counts swings from the wind-up start to the end of the late window', () => {
    expect(swingInWindow(p, p.windupStartMs - 1, cfg)).toBe(false);
    expect(swingInWindow(p, p.windupStartMs, cfg)).toBe(true);
    expect(swingInWindow(p, p.arrivalMs + cfg.lateWindowMs, cfg)).toBe(true);
    expect(swingInWindow(p, p.arrivalMs + cfg.lateWindowMs + 1, cfg)).toBe(false);
  });

  it('a swing during the wind-up is a too-early whiff', () => {
    const s = swingWithError(p, 0, { t: p.windupStartMs + 100 });
    const j = judgeSwing(cfg, p, s, 'right');
    expect(j.quality).toBe('miss');
    expect(j.reason).toBe('early');
  });

  it('a no-swing pitch resolves after the window plus the event-delay allowance', () => {
    expect(noSwingResolveMs(p, cfg)).toBe(p.arrivalMs + 250 + 250);
  });
});

describe('height', () => {
  it('maps hand height to bat height and clamps', () => {
    expect(batHeightM(0, cfg)).toBeCloseTo(0.95, 9);
    expect(batHeightM(1, cfg)).toBeCloseTo(1.35, 9);
    expect(batHeightM(5, cfg)).toBe(cfg.batHeightMax);
    expect(batHeightM(-5, cfg)).toBe(cfg.batHeightMin);
  });

  it('misses when the bat is more than missHeight from the ball', () => {
    const p = pitch();
    const base = swingWithError(p, 0);
    const under = judgeSwing(cfg, p, { ...base, height: base.height - 1.2 }, 'right');
    expect(under.reason).toBe('under');
    expect(under.label).toBe('Under it');
    const over = judgeSwing(cfg, p, { ...base, height: base.height + 1.2 }, 'right');
    expect(over.reason).toBe('over');
    expect(over.label).toBe('Over it');
    const edge = judgeSwing(cfg, p, { ...base, height: base.height + 0.9 }, 'right');
    expect(edge.quality).toBe('perfect');
  });

  it('lower hands than the ball give a higher launch angle', () => {
    expect(launchAngle(-0.2, cfg)).toBeGreaterThan(launchAngle(0, cfg));
    expect(launchAngle(0.2, cfg)).toBeLessThan(launchAngle(0, cfg));
    expect(launchAngle(0, cfg)).toBe(cfg.baseLaunch);
    expect(launchAngle(-9, cfg)).toBe(cfg.launchMax);
    expect(launchAngle(9, cfg)).toBe(cfg.launchMin);
    const p = pitch();
    const base = swingWithError(p, 0);
    const low = judgeSwing(cfg, p, { ...base, height: base.height - 0.5 }, 'right');
    const level = judgeSwing(cfg, p, base, 'right');
    const high = judgeSwing(cfg, p, { ...base, height: base.height + 0.5 }, 'right');
    expect(low.launchDeg).toBeGreaterThan(level.launchDeg);
    expect(level.launchDeg).toBeGreaterThan(high.launchDeg);
  });
});

describe('power and exit speed', () => {
  it('maps speed to power between floor and ceiling', () => {
    expect(powerFromSpeed(cfg.powerFloor, cfg)).toBe(0);
    expect(powerFromSpeed(cfg.powerCeil, cfg)).toBe(1);
    expect(powerFromSpeed(6, cfg)).toBeCloseTo(0.5, 9);
    expect(powerFromSpeed(100, cfg)).toBe(1);
  });

  it('uses SwingPeak when present, else the start speed times the gain', () => {
    const base: SwingInput = { t: 0, startSpeed: 4, height: 0, peakSpeed: 9 };
    expect(swingPower(base, cfg)).toBe(1);
    expect(swingPower({ ...base, peakSpeed: null }, cfg)).toBeCloseTo((4 * 1.5 - 3) / 6, 9);
  });

  it('scales exit speed by power and quality', () => {
    const p = pitch();
    const full = judgeSwing(cfg, p, swingWithError(p, 0, { peakSpeed: 9 }), 'right');
    const half = judgeSwing(cfg, p, swingWithError(p, 0, { peakSpeed: 6 }), 'right');
    expect(full.exitSpeed).toBeCloseTo(cfg.maxExit, 9);
    expect(half.exitSpeed).toBeCloseTo((cfg.minExit + cfg.maxExit) / 2, 9);
    const good = judgeSwing(cfg, p, swingWithError(p, 70, { peakSpeed: 9 }), 'right');
    expect(good.exitSpeed).toBeCloseTo(cfg.maxExit * cfg.qualityGood, 9);
    const weak = judgeSwing(cfg, p, swingWithError(p, 120, { peakSpeed: 9 }), 'right');
    expect(weak.exitSpeed).toBeCloseTo(cfg.maxExit * cfg.qualityWeak, 9);
  });
});

describe('spray', () => {
  const p = pitch();
  it('right-handed: early pulls toward screen left, late pushes toward screen right', () => {
    expect(judgeSwing(cfg, p, swingWithError(p, -80), 'right').sprayDeg).toBeCloseTo(-80 * 0.22, 9);
    expect(judgeSwing(cfg, p, swingWithError(p, 80), 'right').sprayDeg).toBeCloseTo(80 * 0.22, 9);
  });

  it('left-handed mirrors it', () => {
    expect(judgeSwing(cfg, p, swingWithError(p, -80), 'left').sprayDeg).toBeCloseTo(80 * 0.22, 9);
    expect(judgeSwing(cfg, p, swingWithError(p, 80), 'left').sprayDeg).toBeCloseTo(-80 * 0.22, 9);
  });

  it('is clamped and a perfect hit goes straight', () => {
    expect(judgeSwing(cfg, p, swingWithError(p, 0), 'right').sprayDeg).toBe(0);
    const wide = { ...cfg, sprayPerMs: 5 };
    expect(Math.abs(judgeSwing(wide, p, swingWithError(p, 100), 'right').sprayDeg)).toBe(
      cfg.sprayMax,
    );
  });

  it('fouls go to opposite sides for early and late', () => {
    const early = judgeSwing(cfg, p, swingWithError(p, -200), 'right');
    const late = judgeSwing(cfg, p, swingWithError(p, 200), 'right');
    expect(early.quality).toBe('foul');
    expect(late.quality).toBe('foul');
    expect(early.sprayDeg).toBeLessThan(0);
    expect(late.sprayDeg).toBeGreaterThan(0);
  });
});
