import { describe, expect, it } from 'vitest';
import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import { collector, drive, noop, ofType } from '../testing/collect';
import { createTestState, setKnees } from '../testing/frames';
import { CadenceRecognizer } from './CadenceRecognizer';
import { recognizerConfig } from './config';

/** Raised-cosine knee lift: one full lift-and-lower over `period` ms. */
function pulse(t: number, t0: number, period: number, amp: number): number {
  if (t < t0 || t > t0 + period) return 0;
  return amp * 0.5 * (1 - Math.cos((2 * Math.PI * (t - t0)) / period));
}

/** `count` alternating steps starting left at `t0`, `perSecond` steps per second. */
function stepper(count: number, perSecond: number, amp: number, t0 = 300) {
  const period = 1000 / perSecond;
  return (t: number): [number, number] => {
    let l = 0;
    let r = 0;
    for (let i = 0; i < count; i++) {
      const v = pulse(t, t0 + i * period, period, amp);
      if (i % 2 === 0) l += v;
      else r += v;
    }
    return [l, r];
  };
}

function run(
  lifts: (t: number) => [number, number],
  toMs: number,
  onFrame?: (cadence: { stepsPerSecond: number; amplitude: number }, t: number) => void,
) {
  const rec = new CadenceRecognizer();
  const state = createTestState();
  const { events, emit } = collector();
  drive(rec, state, emit, 0, toMs, (t) => {
    const [l, r] = lifts(t);
    setKnees(state, l, r);
  });
  // Re-run sampling variant when asked: separate pass so `events` stays clean.
  if (onFrame) {
    const rec2 = new CadenceRecognizer();
    const s2 = createTestState();
    drive(rec2, s2, noop, 0, toMs, (t) => {
      const [l, r] = lifts(t);
      setKnees(s2, l, r);
      // update runs after setup; sample the previous frame's output (one frame late is fine)
      onFrame(s2.cadence, t);
    });
  }
  return { events, state };
}

describe('CadenceRecognizer', () => {
  it('emits one Step per lift, alternating sides, stamped at the lift peak', () => {
    const { events } = run(stepper(6, 3, 0.7), 3000);
    const steps = ofType(events, 'Step');
    expect(steps).toHaveLength(6);
    expect(steps.map((s) => s.side)).toEqual(['left', 'right', 'left', 'right', 'left', 'right']);
    steps.forEach((s, i) => {
      const peak = 300 + i * (1000 / 3) + 1000 / 3 / 2;
      expect(Math.abs(s.t - peak)).toBeLessThan(40);
      expect(s.amplitude).toBeGreaterThan(0.6);
      expect(s.amplitude).toBeLessThan(0.75);
    });
  });

  it('ignores lifts below minLift', () => {
    const { events, state } = run(stepper(6, 3, recognizerConfig.cadence.minLift * 0.7), 3000);
    expect(ofType(events, 'Step')).toHaveLength(0);
    expect(state.cadence.stepsPerSecond).toBe(0);
  });

  it('measures steps per second from the last intervals and decays to 0 after the last step', () => {
    const samples: { t: number; v: number }[] = [];
    run(stepper(8, 3, 0.7), 6000, (c, t) => samples.push({ t, v: c.stepsPerSecond }));
    // Steps end at 300 + 8 * 333 = 2967 (the last peak is 167 ms earlier).
    const running = samples.filter((s) => s.t > 1500 && s.t < 2700);
    for (const s of running) expect(Math.abs(s.v - 3) / 3).toBeLessThan(0.1);
    const lastPeak = 300 + 7 * (1000 / 3) + 1000 / 6;
    const end = samples.find((s) => s.v === 0 && s.t > 2000);
    expect(end).toBeDefined();
    expect(end!.t - lastPeak).toBeLessThanOrEqual(recognizerConfig.cadence.decayMs + 80);
    // Once decayed, it stays at 0.
    const after = samples.filter((s) => s.t > lastPeak + recognizerConfig.cadence.decayMs + 80);
    for (const s of after) expect(s.v).toBe(0);
  });

  it('reports the mean amplitude and clamps the rate to softCap', () => {
    const { events, state } = run(stepper(12, 6.5, 0.6), 2400);
    // At 30 fps some peaks land closer than minStepMs and are dropped.
    expect(ofType(events, 'Step').length).toBeGreaterThanOrEqual(6);
    expect(state.cadence.stepsPerSecond).toBeLessThanOrEqual(recognizerConfig.cadence.softCap);
    expect(state.cadence.stepsPerSecond).toBeGreaterThan(3);
    expect(state.cadence.amplitude).toBeGreaterThan(0.3);
    expect(state.cadence.amplitude).toBeLessThan(0.65);
  });

  it('clamps to a lowered softCap', () => {
    const cfg = {
      ...recognizerConfig,
      cadence: { ...recognizerConfig.cadence, softCap: 2 },
    };
    const rec = new CadenceRecognizer(cfg);
    const state = createTestState();
    const lifts = stepper(8, 3, 0.7);
    drive(rec, state, noop, 0, 2300, (t) => {
      const [l, r] = lifts(t);
      setKnees(state, l, r);
    });
    expect(state.cadence.stepsPerSecond).toBeCloseTo(2, 5);
  });

  it('does not count both knees rising together (squat, jump)', () => {
    const { events } = run((t) => {
      const v = pulse(t, 300, 500, 0.7);
      return [v, v];
    }, 1500);
    expect(ofType(events, 'Step')).toHaveLength(0);
  });

  it('ignores a step closer than minStepMs to the previous one', () => {
    // Left peaks at 400, right peaks 100 ms later (but with the left knee already back down).
    const { events } = run((t) => [pulse(t, 300, 200, 0.7), pulse(t, 400, 200, 0.7)], 1200);
    // The two pulses overlap: the symmetry rule or the interval rule drops at least one.
    expect(ofType(events, 'Step').length).toBeLessThan(2);
  });

  it('with knees not visible: no steps, cadence decays to 0', () => {
    const rec = new CadenceRecognizer();
    const state = createTestState();
    const { events, emit } = collector();
    const lifts = stepper(6, 3, 0.7);
    drive(rec, state, emit, 0, 1500, (t) => {
      const [l, r] = lifts(t);
      setKnees(state, l, r);
    });
    const before = ofType(events, 'Step').length;
    expect(before).toBeGreaterThan(2);
    expect(state.cadence.stepsPerSecond).toBeGreaterThan(1);
    drive(rec, state, emit, 1500, 3500, (t) => {
      const [l, r] = lifts(t);
      setKnees(state, l, r);
      state.pose[PoseIndex.LEFT_KNEE * POSE_STRIDE + 3] = 0.1;
      state.pose[PoseIndex.RIGHT_KNEE * POSE_STRIDE + 3] = 0.1;
    });
    expect(ofType(events, 'Step')).toHaveLength(before);
    expect(state.cadence.stepsPerSecond).toBe(0);
    expect(state.cadence.amplitude).toBe(0);
  });

  it('reset clears the cadence history', () => {
    const rec = new CadenceRecognizer();
    const state = createTestState();
    const lifts = stepper(6, 3, 0.7);
    drive(rec, state, noop, 0, 1500, (t) => {
      const [l, r] = lifts(t);
      setKnees(state, l, r);
    });
    rec.reset();
    rec.update(state, noop);
    expect(state.cadence.stepsPerSecond).toBe(0);
  });
});
