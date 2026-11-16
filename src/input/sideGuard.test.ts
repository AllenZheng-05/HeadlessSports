import { describe, expect, it } from 'vitest';
import {
  HAND_COUNT,
  HAND_STRIDE,
  HandIndex,
  POSE_COUNT,
  POSE_STRIDE,
  PoseIndex,
  WORLD_STRIDE,
} from '../tracking/types';
import type { HandObservation, LandmarkFrame } from '../tracking/types';
import { FrameProcessor } from './FrameProcessor';
import { inputConfig } from './config';
import {
  SIDE_ARMS,
  SIDE_BODY,
  SIDE_NONE,
  createSideGuardState,
  guardSides,
  sideGuardConfig,
  swapArms,
  swapBody,
} from './sideGuard';
import { createInputState } from './state';

const DT = 1000 / 30;
const X = (i: number): number => i * POSE_STRIDE;

function setLm(pose: Float32Array, i: number, x: number, y: number): void {
  pose[X(i)] = x;
  pose[X(i) + 1] = y;
  pose[X(i) + 3] = 1;
}

interface Arms {
  lex: number;
  ley: number;
  lwx: number;
  lwy: number;
  rex: number;
  rey: number;
  rwx: number;
  rwy: number;
}

/** A front-facing body (player's left on the smaller x) with both arms raised. */
function writeBody(pose: Float32Array, a: Arms): void {
  setLm(pose, PoseIndex.LEFT_SHOULDER, 0.4, 0.4);
  setLm(pose, PoseIndex.RIGHT_SHOULDER, 0.6, 0.4);
  setLm(pose, PoseIndex.LEFT_ELBOW, a.lex, a.ley);
  setLm(pose, PoseIndex.RIGHT_ELBOW, a.rex, a.rey);
  setLm(pose, PoseIndex.LEFT_WRIST, a.lwx, a.lwy);
  setLm(pose, PoseIndex.RIGHT_WRIST, a.rwx, a.rwy);
  setLm(pose, PoseIndex.LEFT_HIP, 0.45, 0.8);
  setLm(pose, PoseIndex.RIGHT_HIP, 0.55, 0.8);
  setLm(pose, PoseIndex.LEFT_KNEE, 0.45, 0.95);
  setLm(pose, PoseIndex.RIGHT_KNEE, 0.55, 0.95);
}

/** Arms overhead, wobbling a little so the frames differ. */
function overhead(k: number): Arms {
  const w = Math.sin(k / 6) * 0.01;
  return {
    lex: 0.36 + w,
    ley: 0.28,
    lwx: 0.33 + w,
    lwy: 0.15,
    rex: 0.64 - w,
    rey: 0.28,
    rwx: 0.67 - w,
    rwy: 0.15 + w,
  };
}

function makeHand(tipLength: number): Float32Array {
  const lm = new Float32Array(HAND_COUNT * HAND_STRIDE);
  for (let i = 0; i < HAND_COUNT; i++) {
    lm[i * HAND_STRIDE] = 0.5;
    lm[i * HAND_STRIDE + 1] = 0.8;
  }
  const fingers: [number, number, number][] = [
    [HandIndex.INDEX_MCP, HandIndex.INDEX_TIP, -0.03],
    [HandIndex.MIDDLE_MCP, HandIndex.MIDDLE_TIP, 0],
    [HandIndex.RING_MCP, HandIndex.RING_TIP, 0.03],
    [HandIndex.PINKY_MCP, HandIndex.PINKY_TIP, 0.06],
  ];
  for (const [mcp, tip, dx] of fingers) {
    lm[mcp * HAND_STRIDE] = 0.5 + dx;
    lm[mcp * HAND_STRIDE + 1] = 0.7;
    lm[tip * HAND_STRIDE] = 0.5 + dx;
    lm[tip * HAND_STRIDE + 1] = 0.8 - tipLength;
  }
  return lm;
}
const OPEN = makeHand(0.2);
const FIST = makeHand(0.07);

class Rig {
  readonly state = createInputState();
  readonly fp = new FrameProcessor(this.state, structuredClone(inputConfig));
  readonly hands: [HandObservation, HandObservation] = [
    { present: false, score: 0, landmarks: new Float32Array(HAND_COUNT * HAND_STRIDE) },
    { present: false, score: 0, landmarks: new Float32Array(HAND_COUNT * HAND_STRIDE) },
  ];
  readonly frame: { -readonly [K in keyof LandmarkFrame]: LandmarkFrame[K] } = {
    t: 0,
    seq: 0,
    inferenceMs: 0,
    aspect: 1.6,
    hasPose: true,
    pose: new Float32Array(POSE_COUNT * POSE_STRIDE),
    poseWorld: new Float32Array(POSE_COUNT * WORLD_STRIDE),
    hands: this.hands,
  };
  private n = 0;

  /** Feed a frame; `mode` says how the raw landmarks arrive. */
  feed(arms: Arms, mode: 'ok' | 'body' | 'arms'): void {
    writeBody(this.frame.pose, arms);
    if (mode === 'body') swapBody(this.frame.pose);
    if (mode === 'arms') swapArms(this.frame.pose);
    this.frame.t = ++this.n * DT;
    this.frame.seq = this.n;
    this.fp.process(this.frame);
  }

  lw(): number {
    return this.state.pose[X(PoseIndex.LEFT_WRIST)];
  }
  rw(): number {
    return this.state.pose[X(PoseIndex.RIGHT_WRIST)];
  }
  le(): number {
    return this.state.pose[X(PoseIndex.LEFT_ELBOW)];
  }
  re(): number {
    return this.state.pose[X(PoseIndex.RIGHT_ELBOW)];
  }
}

const ST = createSideGuardState();

describe('side guard on raw landmarks', () => {
  it('exchanges every pair on a sudden reversal and leaves a correct frame alone', () => {
    const pose = new Float32Array(POSE_COUNT * POSE_STRIDE);
    writeBody(pose, overhead(0));
    const before = pose.slice();
    expect(guardSides(pose, before, true, 1.6, 0.5, sideGuardConfig, ST)).toBe(SIDE_NONE);
    expect(pose).toEqual(before);
    swapBody(pose);
    expect(guardSides(pose, before, true, 1.6, 0.5, sideGuardConfig, ST)).toBe(SIDE_BODY);
    expect(pose).toEqual(before);
  });

  it('accepts a reversed first frame as it is, with nothing to compare against', () => {
    const pose = new Float32Array(POSE_COUNT * POSE_STRIDE);
    writeBody(pose, overhead(0));
    swapBody(pose);
    const copy = pose.slice();
    expect(guardSides(pose, copy, false, 1.6, 0.5, sideGuardConfig, ST)).toBe(SIDE_NONE);
    expect(pose).toEqual(copy);
  });

  it('does nothing when disabled', () => {
    const pose = new Float32Array(POSE_COUNT * POSE_STRIDE);
    writeBody(pose, overhead(0));
    const prev = pose.slice();
    swapBody(pose);
    const copy = pose.slice();
    const off = { ...sideGuardConfig, enabled: false };
    expect(guardSides(pose, prev, true, 1.6, 0.5, off, ST)).toBe(SIDE_NONE);
    expect(pose).toEqual(copy);
  });
});

/** Torso yawed by `deg` (0 = facing the camera), arms hanging; the right arm is the far arm. */
function writeTurned(pose: Float32Array, deg: number, farVis: number): void {
  const c = Math.cos((deg * Math.PI) / 180);
  const cx = 0.5;
  const put = (i: number, x: number, y: number, vis = 1): void => {
    setLm(pose, i, x, y);
    pose[X(i) + 3] = vis;
  };
  put(PoseIndex.LEFT_SHOULDER, cx - 0.1 * c, 0.4);
  put(PoseIndex.RIGHT_SHOULDER, cx + 0.1 * c, 0.4);
  put(PoseIndex.LEFT_ELBOW, cx - 0.12 * c, 0.55);
  put(PoseIndex.RIGHT_ELBOW, cx + 0.12 * c, 0.55, farVis);
  put(PoseIndex.LEFT_WRIST, cx - 0.13 * c, 0.7);
  put(PoseIndex.RIGHT_WRIST, cx + 0.13 * c, 0.7, farVis);
  put(PoseIndex.LEFT_HIP, cx - 0.07 * c, 0.8);
  put(PoseIndex.RIGHT_HIP, cx + 0.07 * c, 0.8);
  put(PoseIndex.LEFT_KNEE, cx - 0.07 * c, 0.95);
  put(PoseIndex.RIGHT_KNEE, cx + 0.07 * c, 0.95);
  put(PoseIndex.LEFT_ANKLE, cx - 0.07 * c, 1.1);
  put(PoseIndex.RIGHT_ANKLE, cx + 0.07 * c, 1.1);
}

/** 0 -> 110 degrees -> 0 over 120 frames at 30 Hz. */
function turnAngle(k: number): number {
  return k <= 60 ? (110 * k) / 60 : (110 * (120 - k)) / 60;
}

function jitter(pose: Float32Array, k: number): void {
  for (let i = 0; i < POSE_COUNT; i++) {
    pose[X(i)] += Math.sin(k * 7.3 + i) * 0.002;
    pose[X(i) + 1] += Math.cos(k * 5.1 + i * 2) * 0.002;
  }
}

describe('side guard through a real turn', () => {
  function run(injectAt: number): { swaps: number; maxErr: number } {
    const st = createSideGuardState();
    const prev = new Float32Array(POSE_COUNT * POSE_STRIDE);
    const raw = new Float32Array(POSE_COUNT * POSE_STRIDE);
    const truth = new Float32Array(POSE_COUNT * POSE_STRIDE);
    let swaps = 0;
    let maxErr = 0;
    for (let k = 0; k <= 120; k++) {
      const deg = turnAngle(k);
      // The far arm is barely visible while side-on.
      writeTurned(truth, deg, deg > 60 ? 0.2 : 1);
      jitter(truth, k);
      raw.set(truth);
      if (k === injectAt) swapBody(raw);
      const res = guardSides(raw, prev, k > 0, 1.6, 0.5, sideGuardConfig, st);
      if (res !== SIDE_NONE) swaps++;
      for (let j = 0; j < truth.length; j++) maxErr = Math.max(maxErr, Math.abs(raw[j] - truth[j]));
      prev.set(raw);
    }
    return { swaps, maxErr };
  }

  it('never touches a smooth turn through side-on to 110 degrees and back', () => {
    const r = run(-1);
    expect(r.swaps).toBe(0);
    expect(r.maxErr).toBe(0);
  });

  it('still repairs one whole-body swap frame in the frontal part of the turn', () => {
    const r = run(8);
    expect(r.swaps).toBe(1);
    expect(r.maxErr).toBeLessThan(1e-6);
  });

  it('keeps a body that stays past side-on exactly as it is', () => {
    const st = createSideGuardState();
    const prev = new Float32Array(POSE_COUNT * POSE_STRIDE);
    const raw = new Float32Array(POSE_COUNT * POSE_STRIDE);
    for (let k = 0; k < 90; k++) {
      writeTurned(raw, 100, 0.2);
      jitter(raw, k);
      const before = raw.slice();
      expect(guardSides(raw, prev, k > 0, 1.6, 0.5, sideGuardConfig, st)).toBe(SIDE_NONE);
      expect(raw).toEqual(before);
      prev.set(raw);
    }
  });

  it('reports no fix through the whole turn when run through FrameProcessor', () => {
    const r = new Rig();
    for (let k = 0; k <= 120; k++) {
      const deg = turnAngle(k);
      writeTurned(r.frame.pose, deg, deg > 60 ? 0.2 : 1);
      r.frame.t = (k + 1) * DT;
      r.frame.seq = k + 1;
      r.fp.process(r.frame);
      expect(r.fp.lastSideFix, `k=${k}`).toBe(SIDE_NONE);
    }
  });
});

describe('side guard arm swaps do not stick', () => {
  it('heals at once when the history was wrongly swapped but the raw frame is consistent', () => {
    const st = createSideGuardState();
    const raw = new Float32Array(POSE_COUNT * POSE_STRIDE);
    const prev = new Float32Array(POSE_COUNT * POSE_STRIDE);
    writeBody(prev, overhead(0));
    swapArms(prev); // a corrupted previous frame
    for (let k = 1; k < 10; k++) {
      writeBody(raw, overhead(k));
      const truth = raw.slice();
      guardSides(raw, prev, true, 1.6, 0.5, sideGuardConfig, st);
      expect(raw, `k=${k}`).toEqual(truth);
      prev.set(raw);
    }
  });

  it('gives up within the cap when the elbows are ambiguous near the midline', () => {
    const st = createSideGuardState();
    const raw = new Float32Array(POSE_COUNT * POSE_STRIDE);
    const prev = new Float32Array(POSE_COUNT * POSE_STRIDE);
    const mid = (k: number): Arms => ({
      lex: 0.49 + Math.sin(k) * 0.005,
      ley: 0.3,
      lwx: 0.46,
      lwy: 0.15,
      rex: 0.51 - Math.sin(k) * 0.005,
      rey: 0.3,
      rwx: 0.54,
      rwy: 0.15,
    });
    writeBody(prev, mid(0));
    swapArms(prev);
    let healedAt = -1;
    for (let k = 1; k < 60; k++) {
      writeBody(raw, mid(k));
      const truth = raw.slice();
      guardSides(raw, prev, true, 1.6, 0.5, sideGuardConfig, st);
      if (healedAt < 0 && raw.every((v, i) => v === truth[i])) healedAt = k;
      prev.set(raw);
    }
    expect(healedAt).toBeGreaterThan(0);
    expect(healedAt).toBeLessThanOrEqual(sideGuardConfig.armMaxRun + 1);
    expect(raw).toEqual(prev);
  });

  it('reports no swaps for overhead arms with elbows by the midline and jitter', () => {
    const st = createSideGuardState();
    const raw = new Float32Array(POSE_COUNT * POSE_STRIDE);
    const prev = new Float32Array(POSE_COUNT * POSE_STRIDE);
    for (let k = 0; k < 120; k++) {
      writeBody(raw, {
        lex: 0.49 + Math.sin(k * 1.7) * 0.01,
        ley: 0.3 + Math.cos(k * 2.3) * 0.01,
        lwx: 0.47 + Math.sin(k * 0.9) * 0.01,
        lwy: 0.15,
        rex: 0.51 + Math.cos(k * 1.3) * 0.01,
        rey: 0.3 + Math.sin(k * 2.9) * 0.01,
        rwx: 0.53 + Math.cos(k * 1.1) * 0.01,
        rwy: 0.15,
      });
      const before = raw.slice();
      expect(guardSides(raw, prev, k > 0, 1.6, 0.5, sideGuardConfig, st), `k=${k}`).toBe(SIDE_NONE);
      expect(raw).toEqual(before);
      prev.set(raw);
    }
  });
});

describe('FrameProcessor side consistency', () => {
  it('repairs frames where the whole body comes back left/right reversed', () => {
    const r = new Rig();
    for (let k = 0; k < 40; k++) {
      const swapped = k >= 12 && k < 17;
      r.feed(overhead(k), swapped ? 'body' : 'ok');
      expect(r.lw(), `k=${k}`).toBeLessThan(0.5);
      expect(r.rw(), `k=${k}`).toBeGreaterThan(0.5);
      expect(r.state.pose[X(PoseIndex.LEFT_SHOULDER)]).toBeLessThan(
        r.state.pose[X(PoseIndex.RIGHT_SHOULDER)],
      );
      expect(r.state.pose[X(PoseIndex.LEFT_KNEE)]).toBeLessThan(0.5);
    }
  });

  it('repairs frames where only the elbows and wrists are exchanged', () => {
    const r = new Rig();
    let fixed = 0;
    for (let k = 0; k < 50; k++) {
      const swapped = (k >= 10 && k < 16) || k === 30 || k === 31;
      r.feed(overhead(k), swapped ? 'arms' : 'ok');
      if (swapped && r.fp.lastSideFix === SIDE_ARMS) fixed++;
      expect(r.lw(), `k=${k}`).toBeLessThan(0.5);
      expect(r.rw(), `k=${k}`).toBeGreaterThan(0.5);
      expect(r.le(), `k=${k}`).toBeLessThan(0.5);
      expect(r.re(), `k=${k}`).toBeGreaterThan(0.5);
    }
    expect(fixed).toBe(8);
  });

  it('keeps repairing a swap that never goes away', () => {
    const r = new Rig();
    for (let k = 0; k < 12; k++) r.feed(overhead(k), 'ok');
    for (let k = 12; k < 150; k++) {
      r.feed(overhead(k), 'arms');
      expect(r.lw(), `k=${k}`).toBeLessThan(0.5);
      expect(r.rw(), `k=${k}`).toBeGreaterThan(0.5);
    }
  });

  it('keeps repairing a reversed body that never goes away', () => {
    const r = new Rig();
    for (let k = 0; k < 12; k++) r.feed(overhead(k), 'ok');
    for (let k = 12; k < 150; k++) {
      r.feed(overhead(k), 'body');
      expect(r.lw(), `k=${k}`).toBeLessThan(0.5);
      expect(r.rw(), `k=${k}`).toBeGreaterThan(0.5);
    }
  });

  it('does not touch wrists that genuinely cross, slowly', () => {
    const r = new Rig();
    const frames = 90;
    for (let k = 0; k < frames; k++) {
      const u = k / (frames - 1);
      const a = overhead(0);
      // Wrists swap places over three seconds; the elbows stay by their shoulders.
      a.lwx = 0.33 + 0.34 * u;
      a.rwx = 0.67 - 0.34 * u;
      r.feed(a, 'ok');
      expect(r.fp.lastSideFix, `k=${k}`).toBe(SIDE_NONE);
    }
    expect(r.lw()).toBeGreaterThan(0.6);
    expect(r.rw()).toBeLessThan(0.4);
    expect(r.le()).toBeLessThan(0.5);
    expect(r.re()).toBeGreaterThan(0.5);
  });

  it('does not touch a quick but real reach with one arm', () => {
    const r = new Rig();
    for (let k = 0; k < 10; k++) r.feed(overhead(0), 'ok');
    for (let k = 0; k < 10; k++) {
      const a = overhead(0);
      a.lwx = 0.33 + k * 0.012;
      a.lwy = 0.15 + k * 0.03;
      r.feed(a, 'ok');
      expect(r.fp.lastSideFix, `k=${k}`).toBe(SIDE_NONE);
    }
  });

  it('moves a cropped hand to the wrist it belongs to when the arms were exchanged', () => {
    const r = new Rig();
    for (let k = 0; k < 30; k++) {
      const swapped = k >= 14 && k < 20;
      // Truth: the left hand is a fist, the right hand is open. Crops follow the (swapped) wrists.
      r.hands[0].present = true;
      r.hands[1].present = true;
      r.hands[0].landmarks.set(swapped ? OPEN : FIST);
      r.hands[1].landmarks.set(swapped ? FIST : OPEN);
      r.feed(overhead(k), swapped ? 'arms' : 'ok');
      if (k > 5) expect(r.state.hands.left.closed, `k=${k}`).toBe(true);
      expect(r.state.hands.right.closed, `k=${k}`).toBe(false);
    }
  });
});

describe('the guard leaves swing- and throw-speed motion alone', () => {
  /** Run `frames` through the guard (aspect 1); returns the fixes it made and whether any landmark moved. */
  function run(
    body: (pose: Float32Array, k: number) => void,
    frames: number,
  ): { fixes: number[]; moved: boolean } {
    const st = createSideGuardState();
    const prev = new Float32Array(POSE_COUNT * POSE_STRIDE);
    const pose = new Float32Array(POSE_COUNT * POSE_STRIDE);
    const fixes: number[] = [];
    let moved = false;
    for (let k = 0; k < frames; k++) {
      body(pose, k);
      const raw = Float32Array.from(pose);
      fixes.push(guardSides(pose, prev, k > 0, 1, 0.5, sideGuardConfig, st));
      for (let i = 0; i < pose.length; i++) if (pose[i] !== raw[i]) moved = true;
      prev.set(pose);
    }
    return { fixes, moved };
  }
  const lerp = (a: number, b: number, u: number): number =>
    a + (b - a) * Math.min(1, Math.max(0, u));

  /** Shoulders `half` either side of x 0.5 at y 0.4, hips below, the near/far arms given. */
  function body(pose: Float32Array, half: number, a: Arms): void {
    writeBody(pose, a);
    setLm(pose, PoseIndex.LEFT_SHOULDER, 0.5 - half, 0.4);
    setLm(pose, PoseIndex.RIGHT_SHOULDER, 0.5 + half, 0.4);
    setLm(pose, PoseIndex.LEFT_HIP, 0.5 - half * 0.7, 0.8);
    setLm(pose, PoseIndex.RIGHT_HIP, 0.5 + half * 0.7, 0.8);
  }

  it('a javelin throw with the right arm at about 15 sw/s, facing the camera', () => {
    const r = run((pose, k) => {
      const u = (k - 8) / 5; // five frames from behind the head to forward and down
      body(pose, 0.1, {
        ...overhead(0),
        lex: 0.36,
        ley: 0.38,
        lwx: 0.34,
        lwy: 0.6,
        rex: lerp(0.72, 0.66, u),
        rey: lerp(0.3, 0.45, u),
        rwx: lerp(0.78, 0.5, u),
        rwy: lerp(0.18, 0.55, u),
      });
    }, 24);
    expect(r.fixes.every((f) => f === SIDE_NONE)).toBe(true);
    expect(r.moved).toBe(false);
  });

  it('the same throw seen side-on (shoulders overlapped, near arm only moving fast)', () => {
    const r = run((pose, k) => {
      const u = (k - 8) / 5;
      body(pose, 0.015, {
        lex: 0.5,
        ley: 0.5,
        lwx: 0.5,
        lwy: 0.62,
        rex: lerp(0.45, 0.55, u),
        rey: lerp(0.3, 0.42, u),
        rwx: lerp(0.4, 0.62, u),
        rwy: lerp(0.18, 0.4, u),
      });
    }, 24);
    expect(r.fixes.every((f) => f === SIDE_NONE)).toBe(true);
    expect(r.moved).toBe(false);
  });

  it('a two-handed swing across the body in five frames, facing the camera and side-on', () => {
    for (const half of [0.1, 0.015]) {
      const r = run((pose, k) => {
        const u = (k - 8) / 5;
        const x = lerp(0.36, 0.64, u);
        body(pose, half, {
          lex: x - 0.03,
          ley: 0.55,
          lwx: x - 0.02,
          lwy: 0.58,
          rex: x + 0.03,
          rey: 0.55,
          rwx: x + 0.02,
          rwy: 0.58,
        });
      }, 24);
      expect(
        r.fixes.every((f) => f === SIDE_NONE),
        `half ${half}`,
      ).toBe(true);
      expect(r.moved, `half ${half}`).toBe(false);
    }
  });

  it('a one-handed swing with the other arm still, side-on', () => {
    const r = run((pose, k) => {
      const u = (k - 8) / 4;
      body(pose, 0.015, {
        lex: 0.5,
        ley: 0.5,
        lwx: 0.5,
        lwy: 0.58,
        rex: lerp(0.45, 0.56, u),
        rey: 0.5,
        rwx: lerp(0.4, 0.66, u),
        rwy: 0.56,
      });
    }, 24);
    expect(r.fixes.every((f) => f === SIDE_NONE)).toBe(true);
    expect(r.moved).toBe(false);
  });
});

describe('full-frame hands', () => {
  it('are not moved by the guard, since they are assigned by position', () => {
    const r = new Rig();
    r.fp.handsFollowPose = false;
    for (let k = 0; k < 20; k++) {
      r.hands[0].present = true;
      r.hands[1].present = true;
      r.hands[0].landmarks.set(FIST);
      r.hands[1].landmarks.set(OPEN);
      r.feed(overhead(k), k >= 10 ? 'arms' : 'ok');
    }
    expect(r.state.hands.left.closed).toBe(true);
    expect(r.state.hands.right.closed).toBe(false);
  });
});
