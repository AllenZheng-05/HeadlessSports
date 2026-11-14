import { describe, expect, it } from 'vitest';
import { collector, drive, ofType } from '../testing/collect';
import { createTestState, setHips } from '../testing/frames';
import { recognizerConfig } from './config';
import { SquatJumpRecognizer } from './SquatJumpRecognizer';

/** Hip rise (sw) over time: smooth bump of height `h` (negative = squat) from t0 over `ms`. */
function bump(t: number, t0: number, ms: number, h: number): number {
  if (t < t0 || t > t0 + ms) return 0;
  return h * 0.5 * (1 - Math.cos((2 * Math.PI * (t - t0)) / ms));
}

/** Plateau: eases to `h`, holds, eases back. */
function plateau(t: number, t0: number, hold: number, h: number, ramp = 200): number {
  if (t < t0 || t > t0 + hold + 2 * ramp) return 0;
  if (t < t0 + ramp) return (h * (t - t0)) / ramp;
  if (t < t0 + ramp + hold) return h;
  return (h * (t0 + 2 * ramp + hold - t)) / ramp;
}

function run(rise: (t: number) => number, toMs: number, calibrated: boolean) {
  const rec = new SquatJumpRecognizer();
  rec.setCalibrated(calibrated);
  const state = createTestState();
  const { events, emit } = collector();
  drive(rec, state, emit, 0, toMs, (t) => {
    setHips(state, rise(t));
    state.rise = calibrated ? rise(t) : 0;
  });
  return events;
}

describe.each([true, false])('SquatJumpRecognizer (calibrated: %s)', (calibrated) => {
  const sq = recognizerConfig.squat;
  const jp = recognizerConfig.jump;

  it('emits one Squat after the dwell, not before', () => {
    const events = run((t) => plateau(t, 1000, 600, -0.8), 3000, calibrated);
    const squats = ofType(events, 'Squat');
    expect(squats).toHaveLength(1);
    expect(squats[0].depth).toBeGreaterThan(sq.depth);
    // The drop crosses `depth` partway down the ramp; the event is dwellMs after that.
    expect(squats[0].t).toBeGreaterThan(1000 + (200 * sq.depth) / 0.8 + sq.dwellMs - 40);
    expect(squats[0].t).toBeLessThan(1000 + 200 + 600);
    expect(ofType(events, 'Jump')).toHaveLength(0);
  });

  it('ignores a dip shallower than depth', () => {
    const events = run((t) => plateau(t, 1000, 600, -(sq.depth - 0.1)), 3000, calibrated);
    expect(ofType(events, 'Squat')).toHaveLength(0);
  });

  it('ignores a dip shorter than the dwell', () => {
    const events = run((t) => plateau(t, 1000, 0, -0.8, 30), 3000, calibrated);
    expect(ofType(events, 'Squat')).toHaveLength(0);
  });

  it('re-arms after standing up', () => {
    const events = run(
      (t) => plateau(t, 1000, 500, -0.8) + plateau(t, 3000, 500, -0.8),
      5000,
      calibrated,
    );
    expect(ofType(events, 'Squat')).toHaveLength(2);
  });

  it('emits Jump at the peak with the peak rise, once', () => {
    const events = run((t) => bump(t, 1000, 500, 1.0), 3000, calibrated);
    const jumps = ofType(events, 'Jump');
    expect(jumps).toHaveLength(1);
    expect(Math.abs(jumps[0].t - 1250)).toBeLessThan(40);
    expect(jumps[0].height).toBeGreaterThan(0.9);
    expect(jumps[0].height).toBeLessThanOrEqual(1.0001);
  });

  it('ignores a hop lower than height', () => {
    const events = run((t) => bump(t, 1000, 500, jp.height * 0.6), 3000, calibrated);
    expect(ofType(events, 'Jump')).toHaveLength(0);
  });

  it('respects the jump cooldown', () => {
    const closeTogether = run(
      (t) => bump(t, 1000, 300, 0.8) + bump(t, 1300, 300, 0.8),
      3000,
      calibrated,
    );
    expect(ofType(closeTogether, 'Jump').length).toBeLessThan(2);
    const apart = run((t) => bump(t, 1000, 400, 0.8) + bump(t, 2200, 400, 0.8), 4000, calibrated);
    expect(ofType(apart, 'Jump')).toHaveLength(2);
  });

  it('does not report the landing crouch after a jump as a squat', () => {
    const events = run(
      (t) => bump(t, 1000, 500, 1.0) + plateau(t, 1500, 300, -0.5, 100),
      4000,
      calibrated,
    );
    expect(ofType(events, 'Jump')).toHaveLength(1);
    expect(ofType(events, 'Squat')).toHaveLength(0);
  });
});

describe('SquatJumpRecognizer baseline (no calibration)', () => {
  it('adapts to a new standing height over seconds, without events', () => {
    const events = run((t) => Math.min(0.3, (t / 20000) * 0.3), 20000, false);
    expect(events).toHaveLength(0);
  });
});
