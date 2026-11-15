import { describe, expect, it } from 'vitest';
import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import { collector, noop, ofType } from '../testing/collect';
import {
  advance,
  createTestState,
  setKnees,
  TEST_HIP_Y,
  TEST_SHOULDER_Y,
  TEST_SW,
} from '../testing/frames';
import type { InputState } from '../types';
import { CadenceRecognizer } from './CadenceRecognizer';
import { recognizerConfig } from './config';

const FRAME_MS = 1000 / 30;
const I = PoseIndex;

/** Deterministic noise (mulberry32 + Box-Muller). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A runner seen from the front, in sw. Left and right alternate; `fs` steps per second. Every
 * amplitude is peak lift or swing for one limb, 0 turns that part off. The knee lifts are small
 * (a jog, not a march) because most of the lift is toward the camera.
 */
interface Motion {
  fs: number;
  /** Knee rise toward the hip, sw. */
  knee: number;
  /** Ankle rise, sw. */
  foot: number;
  /** Wrist swing amplitude (up and down) for each arm, sw. */
  arms: number;
  /** Elbow swing as a fraction of the wrist's. */
  elbow: number;
  /** Torso rise per step, sw. */
  bob: number;
  /** Hold this arm up (the javelin arm) instead of pumping it. */
  hold: 'left' | 'right' | null;
  ankleVis: number;
  /** Landmark noise sigma, sw. */
  noise: number;
  /** Phase offset of the arms against the legs, rad. */
  armPhase: number;
  /** Motion runs from `t0` to `t1` (ms); outside it the body stands. */
  t0: number;
  t1: number;
}

const JOG: Motion = {
  fs: 3,
  knee: 0.2,
  foot: 0.3,
  arms: 0.35,
  elbow: 0.5,
  bob: 0.07,
  hold: null,
  ankleVis: 0.95,
  noise: 0.0115,
  armPhase: 0.6,
  t0: 500,
  t1: 8500,
};

class Rig {
  readonly state = createTestState();
  private readonly gauss: () => number;
  private prevWrist = [0, 0];
  private prevT = Number.NaN;
  constructor(
    readonly m: Motion,
    seed = 1,
  ) {
    const u = rng(seed);
    this.gauss = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  }

  private put(i: number, x: number, ySw: number, vis: number): void {
    const o = i * POSE_STRIDE;
    this.state.pose[o] = x;
    this.state.pose[o + 1] = ySw * TEST_SW + this.gauss() * this.m.noise * TEST_SW;
    this.state.pose[o + 3] = vis;
  }

  /** Write the pose at time `t` (ms) and advance the state clock. */
  frame(t: number): void {
    const m = this.m;
    const s = this.state;
    advance(s, t);
    const on = t >= m.t0 && t <= m.t1;
    const th = on ? (Math.PI * m.fs * (t - m.t0)) / 1000 : 0;
    const sin = Math.sin(th);
    const bobUp = on ? m.bob * (0.5 - 0.5 * Math.cos(2 * th)) : 0;
    const shY = TEST_SHOULDER_Y / TEST_SW - bobUp;
    const hipY = TEST_HIP_Y / TEST_SW - bobUp;
    const x = [0.45, 0.55];
    const lift = [on ? Math.max(0, sin) : 0, on ? Math.max(0, -sin) : 0];
    this.put(I.LEFT_SHOULDER, 0.47, shY, 0.95);
    this.put(I.RIGHT_SHOULDER, 0.53, shY, 0.95);
    this.put(I.LEFT_HIP, 0.48, hipY, 0.95);
    this.put(I.RIGHT_HIP, 0.52, hipY, 0.95);
    for (let i = 0; i < 2; i++) {
      this.put(i === 0 ? I.LEFT_KNEE : I.RIGHT_KNEE, x[i], hipY + 1.1 - m.knee * lift[i], 0.95);
      this.put(
        i === 0 ? I.LEFT_ANKLE : I.RIGHT_ANKLE,
        x[i],
        hipY + 2.0 - m.foot * lift[i],
        m.ankleVis,
      );
      // Arms: antiphase pump, left a phase ahead of the left leg by armPhase.
      const dir = i === 0 ? 1 : -1;
      let wrist = -0.6 + (on ? dir * m.arms * Math.sin(th + m.armPhase) : 0);
      let elbow = -0.2 + (on ? dir * m.arms * m.elbow * Math.sin(th + m.armPhase) : 0);
      if (m.hold === (i === 0 ? 'left' : 'right')) {
        wrist = 1.1;
        elbow = 0.6;
      }
      this.put(i === 0 ? I.LEFT_WRIST : I.RIGHT_WRIST, x[i] + dir * 0.02, shY - wrist, 0.95);
      this.put(i === 0 ? I.LEFT_ELBOW : I.RIGHT_ELBOW, x[i] + dir * 0.03, shY - elbow, 0.95);
      const arm = i === 0 ? s.arms.left : s.arms.right;
      arm.wristY = wrist;
      arm.speed = Number.isNaN(this.prevT)
        ? 0
        : (Math.abs(wrist - this.prevWrist[i]) * 1000) / (t - this.prevT);
      this.prevWrist[i] = wrist;
    }
    this.prevT = t;
  }
}

interface Result {
  events: ReturnType<typeof collector>['events'];
  /** Cadence per frame. */
  rate: Float64Array;
  amp: Float64Array;
  times: Float64Array;
  rec: CadenceRecognizer;
  state: InputState;
}

function run(m: Partial<Motion>, toMs = 9000, seed = 1): Result {
  const motion = { ...JOG, ...m };
  const rig = new Rig(motion, seed);
  const rec = new CadenceRecognizer();
  const { events, emit } = collector();
  const n = Math.floor(toMs / FRAME_MS);
  const rate = new Float64Array(n);
  const amp = new Float64Array(n);
  const times = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const t = (k + 1) * FRAME_MS;
    rig.frame(t);
    rec.update(rig.state, emit);
    rate[k] = rig.state.cadence.stepsPerSecond;
    amp[k] = rig.state.cadence.amplitude;
    times[k] = t;
  }
  return { events, rate, amp, times, rec, state: rig.state };
}

/** First time (ms) at or after `from` where the rate is above 0. */
function firstRunning(r: Result, from: number): number {
  for (let k = 0; k < r.times.length; k++)
    if (r.times[k] >= from && r.rate[k] > 0) return r.times[k];
  return Number.POSITIVE_INFINITY;
}

/** First time at or after `from` where the rate is back to 0. */
function firstStopped(r: Result, from: number): number {
  for (let k = 0; k < r.times.length; k++)
    if (r.times[k] >= from && r.rate[k] === 0) return r.times[k];
  return Number.POSITIVE_INFINITY;
}

function medianOf(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

function stepIntervals(r: Result): number[] {
  const steps = ofType(r.events, 'Step');
  const out: number[] = [];
  for (let i = 1; i < steps.length; i++) out.push(steps[i].t - steps[i - 1].t);
  return out;
}

const SEEDS = [1, 2, 3, 4, 5];

describe('CadenceRecognizer: a front-view jog (arms, legs and bob)', () => {
  it.each(SEEDS)(
    'starts within 700 ms of the first motion and stops within 600 ms (seed %i)',
    (seed) => {
      const r = run({}, 11000, seed);
      const start = firstRunning(r, 0) - JOG.t0;
      const stop = firstStopped(r, JOG.t1 - 200) - JOG.t1;
      expect(start).toBeLessThan(700);
      expect(stop).toBeLessThan(600);
      // And it never dropped out in between.
      for (let k = 0; k < r.times.length; k++) {
        if (r.times[k] > JOG.t0 + 1200 && r.times[k] < JOG.t1 - 100)
          expect(r.rate[k]).toBeGreaterThan(0);
      }
    },
  );

  it.each([1.8, 2.5, 3, 4, 5])('measures %f steps per second within 10 percent', (fs) => {
    const r = run({ fs }, 8000);
    const mid: number[] = [];
    for (let k = 0; k < r.times.length; k++)
      if (r.times[k] > 2500 && r.times[k] < 7500) mid.push(r.rate[k]);
    const m = medianOf(mid);
    expect(Math.abs(m - fs) / fs).toBeLessThan(0.1);
    const iv = medianOf(stepIntervals(r));
    expect(Math.abs(1000 / iv - fs) / fs).toBeLessThan(0.1);
  });

  it('emits Steps alternating sides at the step rhythm, none while standing', () => {
    const r = run({}, 11000);
    const steps = ofType(r.events, 'Step');
    expect(steps.length).toBeGreaterThanOrEqual(20);
    expect(steps.length).toBeLessThanOrEqual(26);
    for (const s of steps) {
      expect(s.t).toBeGreaterThan(JOG.t0);
      expect(s.t).toBeLessThan(JOG.t1 + 50);
      expect(s.amplitude).toBeGreaterThan(0);
    }
    for (let i = 1; i < steps.length; i++) expect(steps[i].t).toBeGreaterThan(steps[i - 1].t);
    const iv = stepIntervals(r);
    for (const v of iv) expect(Math.abs(v - 333) / 333).toBeLessThan(0.3);
  });

  it('reports an amplitude that follows effort and stays inside the javelin scale', () => {
    const big = run({ knee: 0.45, foot: 0.5, arms: 0.7, bob: 0.12 });
    const small = run({ knee: 0.12, foot: 0.18, arms: 0.22, bob: 0.05 });
    const at = (r: Result): number => r.amp[Math.floor(5000 / FRAME_MS)];
    expect(at(big)).toBeGreaterThan(at(small));
    expect(at(big)).toBeLessThanOrEqual(recognizerConfig.cadence.amplitudeScale + 1e-9);
    expect(at(small)).toBeGreaterThan(0.05);
  });

  it('clamps the rate to softCap', () => {
    const cfg = { ...recognizerConfig, cadence: { ...recognizerConfig.cadence, softCap: 2 } };
    const rig = new Rig({ ...JOG, fs: 4 });
    const rec = new CadenceRecognizer(cfg);
    for (let t = FRAME_MS; t < 5000; t += FRAME_MS) {
      rig.frame(t);
      rec.update(rig.state, noop);
    }
    expect(rig.state.cadence.stepsPerSecond).toBeCloseTo(2, 5);
  });
});

describe('CadenceRecognizer: each cue can carry the detection alone', () => {
  const NONE = { knee: 0, foot: 0, arms: 0, bob: 0 };

  function checkRuns(m: Partial<Motion>, maxStartMs: number, which: number): void {
    for (const seed of SEEDS) {
      const r = run({ ...NONE, ...m }, 9000, seed);
      const start = firstRunning(r, 0) - JOG.t0;
      expect(start).toBeLessThan(maxStartMs);
      const mid: number[] = [];
      for (let k = 0; k < r.times.length; k++)
        if (r.times[k] > 3000 && r.times[k] < 8000) mid.push(r.rate[k]);
      expect(Math.abs(medianOf(mid) - 3) / 3).toBeLessThan(0.12);
      expect(r.rec.cueConf[which]).toBeGreaterThanOrEqual(0);
      expect(firstStopped(r, JOG.t1 - 200) - JOG.t1).toBeLessThan(650);
    }
  }

  it('arm pump alone (legs still, no bob)', () => checkRuns({ arms: 0.35 }, 1300, 0));
  it('arm pump alone, small', () => checkRuns({ arms: 0.18 }, 1300, 0));
  it('thigh alone (small knee lift, ankles hidden)', () =>
    checkRuns({ knee: 0.18, ankleVis: 0 }, 1300, 1));
  it('foot alone (ankles visible, knees too small to count)', () =>
    checkRuns({ foot: 0.3, knee: 0.01 }, 1300, 2));
  it('torso bob alone', () => checkRuns({ bob: 0.09 }, 1500, 3));

  it('legs alone with one arm held up still (the javelin arm)', () =>
    checkRuns({ knee: 0.2, hold: 'right' }, 1300, 1));
  it('the other arm pumping plus bob, javelin arm held up, legs hidden', () =>
    checkRuns({ arms: 0.4, bob: 0.07, hold: 'right', ankleVis: 0 }, 1300, 0));
  it('the other arm pumping alone with the javelin arm held up', () =>
    checkRuns({ arms: 0.4, hold: 'left' }, 1500, 0));

  it('reports each cue separately', () => {
    const r = run({ ...NONE, knee: 0.2 }, 5000);
    expect(r.rec.cueConf[1]).toBeGreaterThan(0.5);
    expect(r.rec.cueRate[1]).toBeGreaterThan(2.7);
    expect(r.rec.cueRate[1]).toBeLessThan(3.3);
    expect(r.rec.cueConf[0]).toBe(0);
    expect(r.rec.cueConf[3]).toBe(0);
  });
});

describe('CadenceRecognizer: no false running', () => {
  const QUIET = { knee: 0, foot: 0, arms: 0, bob: 0 };

  it.each(SEEDS)('standing still with landmark noise for 40 s (seed %i)', (seed) => {
    const r = run({ ...QUIET }, 40000, seed);
    expect(ofType(r.events, 'Step')).toHaveLength(0);
    expect(Math.max(...r.rate)).toBe(0);
  });

  it('standing with double the usual noise', () => {
    const r = run({ ...QUIET, noise: 0.023 }, 30000, 3);
    expect(ofType(r.events, 'Step')).toHaveLength(0);
  });

  it('shifting weight slowly (sway of the whole body and one knee at a time)', () => {
    const rig = new Rig({ ...JOG, ...QUIET });
    const rec = new CadenceRecognizer();
    const { events, emit } = collector();
    for (let t = FRAME_MS; t < 30000; t += FRAME_MS) {
      rig.frame(t);
      const w = Math.sin((2 * Math.PI * t) / 2400);
      const p = rig.state.pose;
      // Whole body sways 0.15 sw; the weight-bearing knee bends 0.12 sw.
      for (const j of [I.LEFT_SHOULDER, I.RIGHT_SHOULDER, I.LEFT_HIP, I.RIGHT_HIP]) {
        p[j * POSE_STRIDE + 1] += 0.015 * TEST_SW * Math.abs(w);
      }
      p[I.LEFT_KNEE * POSE_STRIDE + 1] -= 0.12 * TEST_SW * Math.max(0, w);
      p[I.RIGHT_KNEE * POSE_STRIDE + 1] -= 0.12 * TEST_SW * Math.max(0, -w);
      rec.update(rig.state, emit);
      expect(rig.state.cadence.stepsPerSecond).toBe(0);
    }
    expect(ofType(events, 'Step')).toHaveLength(0);
  });

  it('a single arm raise and lower, then a second one later', () => {
    const rig = new Rig({ ...JOG, ...QUIET });
    const rec = new CadenceRecognizer();
    const { events, emit } = collector();
    for (let t = FRAME_MS; t < 12000; t += FRAME_MS) {
      rig.frame(t);
      // Up over 500 ms, hold, down over 500 ms; again at 7 s, quicker.
      let up = 0;
      if (t > 1000 && t < 3000) up = Math.min(1, (t - 1000) / 500) * Math.min(1, (3000 - t) / 500);
      if (t > 7000 && t < 8200) up = Math.min(1, (t - 7000) / 300) * Math.min(1, (8200 - t) / 300);
      const wrist = -0.6 + 1.7 * up;
      const arm = rig.state.arms.right;
      arm.wristY = wrist;
      arm.speed = 1.5;
      const p = rig.state.pose;
      p[I.RIGHT_WRIST * POSE_STRIDE + 1] = TEST_SHOULDER_Y - wrist * TEST_SW;
      p[I.RIGHT_ELBOW * POSE_STRIDE + 1] = TEST_SHOULDER_Y - (wrist * 0.5 - 0.1) * TEST_SW;
      rec.update(rig.state, emit);
      expect(rig.state.cadence.stepsPerSecond).toBe(0);
    }
    expect(ofType(events, 'Step')).toHaveLength(0);
  });

  it('both knees up together (a jump or a squat) does not count', () => {
    const rig = new Rig({ ...JOG, ...QUIET });
    const rec = new CadenceRecognizer();
    const { events, emit } = collector();
    for (let t = FRAME_MS; t < 6000; t += FRAME_MS) {
      rig.frame(t);
      const lift = 0.5 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 500));
      setKnees(rig.state, lift, lift);
      rec.update(rig.state, emit);
    }
    expect(ofType(events, 'Step')).toHaveLength(0);
  });

  it('a fast throw-like wrist movement is not a pump, and a throw during a run does not stall it', () => {
    // Pumping, then a violent arm movement (speed above armBlankSpeed): the arm cue starts over.
    const r = run({ ...QUIET, arms: 0.4 }, 4000);
    expect(r.rec.isRunning).toBe(true);
    const rig = new Rig({ ...JOG, ...QUIET, arms: 0.4 });
    const rec = new CadenceRecognizer();
    for (let t = FRAME_MS; t < 3000; t += FRAME_MS) {
      rig.frame(t);
      if (t > 2000 && t < 2200)
        rig.state.arms.right.speed = recognizerConfig.cadence.armBlankSpeed + 2;
      rec.update(rig.state, noop);
    }
    expect(rec.cueStreak[0]).toBeLessThanOrEqual(2);
  });

  it('with the whole pose lost it stops and stays at 0', () => {
    const rig = new Rig({ ...JOG });
    const rec = new CadenceRecognizer();
    const { events, emit } = collector();
    for (let t = FRAME_MS; t < 3000; t += FRAME_MS) {
      rig.frame(t);
      rec.update(rig.state, emit);
    }
    expect(rig.state.cadence.stepsPerSecond).toBeGreaterThan(1);
    const before = ofType(events, 'Step').length;
    for (let t = 3000; t < 5000; t += FRAME_MS) {
      rig.frame(t);
      rig.state.hasPose = false;
      rec.update(rig.state, emit);
    }
    expect(ofType(events, 'Step')).toHaveLength(before);
    expect(rig.state.cadence.stepsPerSecond).toBe(0);
    expect(rig.state.cadence.amplitude).toBe(0);
  });

  it('reset clears the state', () => {
    const rig = new Rig({ ...JOG });
    const rec = new CadenceRecognizer();
    for (let t = FRAME_MS; t < 3000; t += FRAME_MS) {
      rig.frame(t);
      rec.update(rig.state, noop);
    }
    expect(rec.isRunning).toBe(true);
    rec.reset();
    expect(rec.isRunning).toBe(false);
    rig.state.hasPose = false;
    rec.update(rig.state, noop);
    expect(rig.state.cadence.stepsPerSecond).toBe(0);
  });
});

describe('CadenceRecognizer: large clean knee lifts (the old knee-only signal) still work', () => {
  /** Raised-cosine knee lift: one full lift-and-lower over `period` ms. */
  function pulse(t: number, t0: number, period: number, amp: number): number {
    if (t < t0 || t > t0 + period) return 0;
    return amp * 0.5 * (1 - Math.cos((2 * Math.PI * (t - t0)) / period));
  }

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

  function drive(lifts: (t: number) => [number, number], toMs: number) {
    const rec = new CadenceRecognizer();
    const state = createTestState();
    const { events, emit } = collector();
    for (let t = FRAME_MS; t <= toMs; t += FRAME_MS) {
      advance(state, t);
      const [l, r] = lifts(t);
      setKnees(state, l, r);
      rec.update(state, emit);
    }
    return { events, state, rec };
  }

  it('emits one Step per lift, alternating sides, stamped at the lift peak', () => {
    const { events } = drive(stepper(6, 3, 0.7), 3000);
    const steps = ofType(events, 'Step');
    expect(steps).toHaveLength(6);
    expect(steps.map((s) => s.side)).toEqual(['left', 'right', 'left', 'right', 'left', 'right']);
    steps.forEach((s, i) => {
      const peak = 300 + i * (1000 / 3) + 1000 / 3 / 2;
      expect(Math.abs(s.t - peak)).toBeLessThan(40);
    });
  });

  it('ignores lifts far below the thigh threshold', () => {
    const { events, state } = drive(stepper(10, 3, 0.04), 4000);
    expect(ofType(events, 'Step')).toHaveLength(0);
    expect(state.cadence.stepsPerSecond).toBe(0);
  });

  it('measures steps per second and goes to 0 after the last step', () => {
    const { state } = drive(stepper(8, 3, 0.7), 2800);
    expect(Math.abs(state.cadence.stepsPerSecond - 3) / 3).toBeLessThan(0.1);
    const { state: after } = drive(stepper(8, 3, 0.7), 6000);
    expect(after.cadence.stepsPerSecond).toBe(0);
  });

  it('clamps a fast cadence to softCap', () => {
    const { events, state } = drive(stepper(14, 5.5, 0.6), 2800);
    expect(ofType(events, 'Step').length).toBeGreaterThanOrEqual(6);
    expect(state.cadence.stepsPerSecond).toBeLessThanOrEqual(recognizerConfig.cadence.softCap);
    expect(state.cadence.stepsPerSecond).toBeGreaterThan(4);
  });

  it('ignores a step closer than minStepMs to the previous one', () => {
    const { events } = drive((t) => [pulse(t, 300, 200, 0.7), pulse(t, 400, 200, 0.7)], 1200);
    expect(ofType(events, 'Step').length).toBeLessThan(2);
  });
});
