import { describe, expect, it } from 'vitest';
import { HandIndex, PoseIndex } from '../types';
import type { LandmarkFrame } from '../types';
import { SyntheticBody, createEmptyFrame } from './body';
import { defaultControls } from './controls';
import type { BodyControls } from './controls';

const ASPECT = 16 / 9;

function render(c: BodyControls, noise: { sigma?: number; seed?: number } = {}): LandmarkFrame {
  const body = new SyntheticBody(ASPECT, { sigma: 0, seed: 1, ...noise });
  const f = createEmptyFrame(ASPECT);
  body.write(c, f);
  return f;
}

function px(f: LandmarkFrame, i: number): number {
  return f.pose[i * 4];
}
function py(f: LandmarkFrame, i: number): number {
  return f.pose[i * 4 + 1];
}
/** Aspect-corrected distance between two pose landmarks. */
function pdist(f: LandmarkFrame, a: number, b: number): number {
  return Math.hypot((px(f, a) - px(f, b)) * ASPECT, py(f, a) - py(f, b));
}

/** The project's curl metric: mean fingertip distance over palm length, aspect corrected. */
function curl(lm: Float32Array): number {
  const d = (a: number, b: number): number =>
    Math.hypot((lm[a * 3] - lm[b * 3]) * ASPECT, lm[a * 3 + 1] - lm[b * 3 + 1]);
  const palm = d(HandIndex.MIDDLE_MCP, HandIndex.WRIST);
  const tips = [HandIndex.INDEX_TIP, HandIndex.MIDDLE_TIP, HandIndex.RING_TIP, HandIndex.PINKY_TIP];
  let sum = 0;
  for (const tip of tips) sum += d(tip, HandIndex.WRIST) / palm;
  return sum / tips.length;
}

describe('SyntheticBody', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const run = (seed: number): number[] => {
      const body = new SyntheticBody(ASPECT, { seed });
      const f = createEmptyFrame(ASPECT);
      const out: number[] = [];
      for (let i = 0; i < 20; i++) {
        body.write(defaultControls(), f);
        out.push(...f.pose, ...f.hands[0].landmarks, ...f.hands[1].landmarks);
      }
      return out;
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it('reseed restarts the sequence', () => {
    const body = new SyntheticBody(ASPECT, { seed: 3 });
    const f = createEmptyFrame(ASPECT);
    body.write(defaultControls(), f);
    const first = Array.from(f.pose);
    body.write(defaultControls(), f);
    body.reseed(3);
    body.write(defaultControls(), f);
    expect(Array.from(f.pose)).toEqual(first);
  });

  it('standing pose is anatomically ordered and inside the image', () => {
    const f = render(defaultControls(), { sigma: 0.0015 });
    expect(f.hasPose).toBe(true);
    const I = PoseIndex;
    expect(py(f, I.LEFT_SHOULDER)).toBeLessThan(py(f, I.LEFT_HIP));
    expect(py(f, I.LEFT_HIP)).toBeLessThan(py(f, I.LEFT_KNEE));
    expect(py(f, I.LEFT_KNEE)).toBeLessThan(py(f, I.LEFT_ANKLE));
    expect(py(f, I.RIGHT_SHOULDER)).toBeLessThan(py(f, I.RIGHT_HIP));
    expect(py(f, I.RIGHT_HIP)).toBeLessThan(py(f, I.RIGHT_KNEE));
    expect(py(f, I.RIGHT_KNEE)).toBeLessThan(py(f, I.RIGHT_ANKLE));
    expect(py(f, I.NOSE)).toBeLessThan(py(f, I.LEFT_SHOULDER));
    const pairs = [
      [I.LEFT_SHOULDER, I.RIGHT_SHOULDER],
      [I.LEFT_ELBOW, I.RIGHT_ELBOW],
      [I.LEFT_WRIST, I.RIGHT_WRIST],
      [I.LEFT_HIP, I.RIGHT_HIP],
      [I.LEFT_KNEE, I.RIGHT_KNEE],
      [I.LEFT_ANKLE, I.RIGHT_ANKLE],
      [1, 4],
      [7, 8],
    ];
    for (const [l, r] of pairs) expect(px(f, l)).toBeLessThan(px(f, r));
    for (let i = 0; i < 33; i++) {
      expect(px(f, i)).toBeGreaterThanOrEqual(0);
      expect(px(f, i)).toBeLessThanOrEqual(1);
      expect(py(f, i)).toBeGreaterThanOrEqual(0);
      expect(py(f, i)).toBeLessThanOrEqual(1);
      expect(f.pose[i * 4 + 3]).toBeCloseTo(0.95, 5);
    }
    for (const v of f.poseWorld) expect(Number.isFinite(v)).toBe(true);
  });

  it('shoulder width matches the control in aspect-corrected units', () => {
    for (const sw of [0.09, 0.13, 0.2]) {
      const f = render({ ...defaultControls(), shoulderWidth: sw });
      expect(pdist(f, PoseIndex.LEFT_SHOULDER, PoseIndex.RIGHT_SHOULDER)).toBeCloseTo(sw, 4);
    }
  });

  it('puts the wrist on the requested target with the bone lengths intact', () => {
    const sw = 0.13;
    const c = {
      ...defaultControls(),
      rightWristX: 0.5,
      rightWristY: 0.6,
      leftWristX: -0.9,
      leftWristY: 0.2,
    };
    const f = render(c);
    const I = PoseIndex;
    const relX = ((px(f, I.RIGHT_WRIST) - px(f, I.RIGHT_SHOULDER)) * ASPECT) / sw;
    const relY = (py(f, I.RIGHT_SHOULDER) - py(f, I.RIGHT_WRIST)) / sw;
    expect(relX).toBeCloseTo(0.5, 2);
    expect(relY).toBeCloseTo(0.6, 2);
    expect(pdist(f, I.RIGHT_SHOULDER, I.RIGHT_ELBOW) / sw).toBeCloseTo(0.8, 2);
    expect(pdist(f, I.RIGHT_ELBOW, I.RIGHT_WRIST) / sw).toBeCloseTo(0.72, 2);
    expect(pdist(f, I.LEFT_SHOULDER, I.LEFT_ELBOW) / sw).toBeCloseTo(0.8, 2);
    expect(pdist(f, I.LEFT_ELBOW, I.LEFT_WRIST) / sw).toBeCloseTo(0.72, 2);
    // Elbow bends outward or down, never inward and up.
    expect(px(f, I.RIGHT_ELBOW)).toBeGreaterThan(px(f, I.RIGHT_SHOULDER));
  });

  it('clamps targets beyond the reach', () => {
    const f = render({ ...defaultControls(), rightWristX: 3, rightWristY: 0 });
    expect(pdist(f, PoseIndex.RIGHT_SHOULDER, PoseIndex.RIGHT_WRIST) / 0.13).toBeLessThanOrEqual(
      1.521,
    );
    expect(pdist(f, PoseIndex.RIGHT_SHOULDER, PoseIndex.RIGHT_WRIST) / 0.13).toBeGreaterThan(1.5);
  });

  it('crouch lowers the hips, jump raises the body, knee lift raises the knee', () => {
    const I = PoseIndex;
    const stand = render(defaultControls());
    const crouch = render({ ...defaultControls(), crouch: 1 });
    expect(py(crouch, I.LEFT_HIP)).toBeGreaterThan(py(stand, I.LEFT_HIP) + 0.1);
    expect(py(crouch, I.LEFT_ANKLE)).toBeCloseTo(py(stand, I.LEFT_ANKLE), 4);
    const jump = render({ ...defaultControls(), jump: 1 });
    expect(py(jump, I.LEFT_ANKLE)).toBeLessThan(py(stand, I.LEFT_ANKLE) - 0.1);
    const lift = render({ ...defaultControls(), leftKnee: 1 });
    expect(py(lift, I.LEFT_KNEE)).toBeCloseTo(py(lift, I.LEFT_HIP), 3);
    expect(py(lift, I.RIGHT_KNEE)).toBeCloseTo(py(stand, I.RIGHT_KNEE), 4);
  });

  it('lean moves the shoulders over to the right while the hips stay put', () => {
    const I = PoseIndex;
    const stand = render(defaultControls());
    const lean = render({ ...defaultControls(), lean: 0.3 });
    expect(px(lean, I.LEFT_SHOULDER)).toBeGreaterThan(px(stand, I.LEFT_SHOULDER));
    expect(px(lean, I.LEFT_HIP)).toBeCloseTo(px(stand, I.LEFT_HIP), 5);
  });

  it('keeps out-of-image points out of range with visibility 0.9', () => {
    const f = render({ ...defaultControls(), centreX: 1.4 });
    expect(px(f, PoseIndex.LEFT_SHOULDER)).toBeGreaterThan(1);
    expect(f.pose[PoseIndex.LEFT_SHOULDER * 4 + 3]).toBeCloseTo(0.9, 5);
  });

  it('hand templates meet the curl bounds and blend monotonically', () => {
    const scores: number[] = [];
    for (let i = 0; i <= 10; i++) {
      const f = render({ ...defaultControls(), rightFist: i / 10, leftFist: 1 - i / 10 });
      scores.push(curl(f.hands[1].landmarks));
      // The left hand runs the opposite way and must agree.
      expect(curl(f.hands[0].landmarks)).toBeCloseTo(
        curl(render({ ...defaultControls(), rightFist: 1 - i / 10 }).hands[1].landmarks),
        3,
      );
    }
    expect(scores[0]).toBeGreaterThan(1.7);
    expect(scores[10]).toBeLessThan(0.75);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
  });

  it('places the hand at the wrist, oriented along the forearm, palm 0.19 sw', () => {
    const f = render({ ...defaultControls(), rightWristX: 0.5, rightWristY: 0.6 });
    const lm = f.hands[1].landmarks;
    expect(lm[0]).toBeCloseTo(px(f, PoseIndex.RIGHT_WRIST), 4);
    expect(lm[1]).toBeCloseTo(py(f, PoseIndex.RIGHT_WRIST), 4);
    const palm = Math.hypot((lm[27] - lm[0]) * ASPECT, lm[28] - lm[1]);
    expect(palm).toBeCloseTo(0.19 * 0.13, 4);
    expect(f.hands[1].present).toBe(true);
  });

  it('hands-only mode has no pose and puts the hands where asked', () => {
    const c: BodyControls = {
      ...defaultControls(),
      handsOnly: 1,
      bodyVisible: 0,
      shoulderWidth: 0,
      leftHandX: 0.3,
      leftHandY: 0.4,
      rightHandX: 0.7,
      rightHandY: 0.55,
      handSize: 0.2,
      rightFist: 1,
    };
    const f = render(c);
    expect(f.hasPose).toBe(false);
    expect(f.hands[0].present && f.hands[1].present).toBe(true);
    for (const [h, x, y] of [
      [0, 0.3, 0.4],
      [1, 0.7, 0.55],
    ] as const) {
      const lm = f.hands[h].landmarks;
      expect((lm[0] + lm[27]) / 2).toBeCloseTo(x, 4);
      expect((lm[1] + lm[28]) / 2).toBeCloseTo(y, 4);
      expect(Math.hypot((lm[27] - lm[0]) * ASPECT, lm[28] - lm[1])).toBeCloseTo(0.2, 4);
      // Upright: fingers above the wrist.
      expect(lm[HandIndex.MIDDLE_TIP * 3 + 1]).toBeLessThan(lm[1]);
    }
    expect(curl(f.hands[0].landmarks)).toBeGreaterThan(1.7);
    expect(curl(f.hands[1].landmarks)).toBeLessThan(0.75);
  });

  it('hides hands when not visible, and the whole body when bodyVisible is 0', () => {
    const f = render({ ...defaultControls(), leftHandVisible: 0 });
    expect(f.hands[0].present).toBe(false);
    expect(f.hands[1].present).toBe(true);
    const gone = render({ ...defaultControls(), bodyVisible: 0 });
    expect(gone.hasPose).toBe(false);
    expect(gone.hands[0].present || gone.hands[1].present).toBe(false);
  });

  it('drops hands at random when dropHandChance is set', () => {
    const body = new SyntheticBody(ASPECT, { seed: 5, dropHandChance: 0.5 });
    const f = createEmptyFrame(ASPECT);
    let present = 0;
    for (let i = 0; i < 400; i++) {
      body.write(defaultControls(), f);
      if (f.hands[0].present) present++;
    }
    expect(present).toBeGreaterThan(120);
    expect(present).toBeLessThan(280);
  });
});
