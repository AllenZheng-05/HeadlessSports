import { describe, expect, it } from 'vitest';
import { collector, drive, ofType } from '../testing/collect';
import { createTestState, setGrip, setWrist } from '../testing/frames';
import { PunchRecognizer } from './PunchRecognizer';
import { recognizerConfig } from './config';

function inOut(t: number, t0: number, d: number, L: number): number {
  if (t <= t0) return 0;
  if (t < t0 + d) {
    const p = (t - t0) / d;
    return (L / 2) * p * p;
  }
  if (t < t0 + 2 * d) {
    const q = (t - t0 - d) / d;
    return L / 2 + (L / 2) * (1 - (1 - q) * (1 - q));
  }
  return L;
}

interface Options {
  /** Elbow rate while the wrist is moving, rad/s. */
  elbowRate?: number;
  y?: number;
  L?: number;
  d?: number;
  /** Put both wrists together in a grip instead. */
  grip?: boolean;
  punches?: number[];
}

/** Right wrist jabs outward from (0.4, y) at each time in `punches` (default one at 1000). */
function run(opts: Options = {}, toMs = 3000) {
  const rec = new PunchRecognizer('right');
  const state = createTestState();
  const { events, emit } = collector();
  const y = opts.y ?? -0.2;
  const d = opts.d ?? 120;
  const L = opts.L ?? 0.9;
  const starts = opts.punches ?? [1000];
  drive(rec, state, emit, 0, toMs, (t) => {
    let u = 0;
    let moving = false;
    for (const s of starts) {
      if (t > s && t < s + 2 * d + 100) moving = true;
      u += inOut(t, s, d, L);
    }
    if (opts.grip) setGrip(state, 0.4 + u, y);
    else setWrist(state, 'right', 0.4 + u, y);
    state.arms.right.elbowRate = moving ? (opts.elbowRate ?? 8) : 0;
  });
  return events;
}

describe('PunchRecognizer', () => {
  const c = recognizerConfig.punch;

  it('emits one Punch stamped at the speed peak', () => {
    const events = run();
    const p = ofType(events, 'Punch');
    expect(p).toHaveLength(1);
    expect(p[0].hand).toBe('right');
    expect(Math.abs(p[0].t - 1120)).toBeLessThan(45);
    expect(p[0].speed).toBeGreaterThan(c.minPeak);
  });

  it('needs the elbow to extend', () => {
    expect(ofType(run({ elbowRate: 0.5 }), 'Punch')).toHaveLength(0);
  });

  it('needs speed', () => {
    // Peak speed 0.4 / 0.12 = 3.3 sw/s: under minPeak.
    expect(ofType(run({ L: 0.4 }), 'Punch')).toHaveLength(0);
  });

  it('only counts between minWristY and maxWristY', () => {
    expect(ofType(run({ y: c.maxWristY + 0.4 }), 'Punch')).toHaveLength(0);
    expect(ofType(run({ y: c.minWristY - 0.4 }), 'Punch')).toHaveLength(0);
    expect(ofType(run({ y: c.maxWristY - 0.1 }), 'Punch')).toHaveLength(1);
  });

  it('is suppressed while the wrists are in a swing grip', () => {
    expect(ofType(run({ grip: true }), 'Punch')).toHaveLength(0);
  });

  it('cooldown: a second punch right after is ignored, a later one is accepted', () => {
    expect(ofType(run({ punches: [1000, 1300] }), 'Punch')).toHaveLength(1);
    expect(ofType(run({ punches: [1000, 2000] }), 'Punch')).toHaveLength(2);
  });

  it('is not triggered by the other hand', () => {
    const rec = new PunchRecognizer('left');
    const state = createTestState();
    const { events, emit } = collector();
    drive(rec, state, emit, 0, 2000, (t) => {
      setWrist(state, 'right', 0.4 + inOut(t, 1000, 120, 0.9), -0.2);
      state.arms.right.elbowRate = 8;
    });
    expect(events).toHaveLength(0);
  });
});
