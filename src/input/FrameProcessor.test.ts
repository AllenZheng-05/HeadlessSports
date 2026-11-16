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
import { palmSize } from './hands/fist';
import { createInputState } from './state';

const DT = 1000 / 30;

function setLm(pose: Float32Array, i: number, x: number, y: number, vis = 1): void {
  pose[i * POSE_STRIDE] = x;
  pose[i * POSE_STRIDE + 1] = y;
  pose[i * POSE_STRIDE + 3] = vis;
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
  readonly frame: {
    -readonly [K in keyof LandmarkFrame]: LandmarkFrame[K];
  };
  readonly hands: [HandObservation, HandObservation];
  private seq = 0;

  constructor() {
    this.hands = [
      { present: false, score: 0, landmarks: new Float32Array(HAND_COUNT * HAND_STRIDE) },
      { present: false, score: 0, landmarks: new Float32Array(HAND_COUNT * HAND_STRIDE) },
    ];
    const pose = new Float32Array(POSE_COUNT * POSE_STRIDE);
    this.standing(pose, 0.5, 0.08);
    this.frame = {
      t: 0,
      seq: 0,
      inferenceMs: 0,
      aspect: 1,
      hasPose: true,
      pose,
      poseWorld: new Float32Array(POSE_COUNT * WORLD_STRIDE),
      hands: this.hands,
    };
  }

  standing(pose: Float32Array, midX: number, half: number): void {
    setLm(pose, PoseIndex.LEFT_SHOULDER, midX - half, 0.3);
    setLm(pose, PoseIndex.RIGHT_SHOULDER, midX + half, 0.3);
    setLm(pose, PoseIndex.LEFT_ELBOW, midX - half, 0.45);
    setLm(pose, PoseIndex.RIGHT_ELBOW, midX + half, 0.45);
    setLm(pose, PoseIndex.LEFT_WRIST, midX - half, 0.6);
    setLm(pose, PoseIndex.RIGHT_WRIST, midX + half, 0.6);
    setLm(pose, PoseIndex.LEFT_HIP, midX - 0.05, 0.6);
    setLm(pose, PoseIndex.RIGHT_HIP, midX + 0.05, 0.6);
  }

  step(t: number): number {
    this.frame.t = t;
    this.frame.seq = ++this.seq;
    return this.fp.process(this.frame as LandmarkFrame);
  }

  setHand(i: 0 | 1, present: boolean, landmarks?: Float32Array): void {
    this.hands[i].present = present;
    if (landmarks) this.hands[i].landmarks.set(landmarks);
  }
}

describe('FrameProcessor', () => {
  it('rolls pose and posePrev and sets timing fields', () => {
    const r = new Rig();
    r.step(1000);
    expect(r.state.tPrev).toBe(1000);
    expect(r.state.t).toBe(1000);
    expect(r.state.hasPose).toBe(true);
    expect(r.state.tracking).toBe(true);
    expect(r.state.problem).toBe('none');
    const lw = PoseIndex.LEFT_WRIST * POSE_STRIDE;
    expect(r.state.pose[lw]).toBeCloseTo(0.42, 6);
    expect(r.state.posePrev[lw]).toBeCloseTo(0.42, 6);
    r.frame.pose[lw] = 0.3;
    r.step(1000 + DT);
    expect(r.state.tPrev).toBe(1000);
    expect(r.state.t).toBeCloseTo(1000 + DT, 6);
    expect(r.state.posePrev[lw]).toBeCloseTo(0.42, 6);
    expect(r.state.pose[lw]).toBeLessThan(0.42);
    expect(r.state.pose[lw]).toBeGreaterThan(0.3);
    const before = r.state.pose[lw];
    r.step(1000 + 2 * DT);
    expect(r.state.posePrev[lw]).toBe(before);
    expect(r.state.shoulderWidth).toBeCloseTo(0.16, 5);
  });

  it('reports a fist change exactly once and tracks hand state', () => {
    const r = new Rig();
    r.setHand(1, true, OPEN);
    let total = 0;
    let t = 0;
    for (let i = 0; i < 5; i++) total += r.step((t += DT));
    expect(total).toBe(0);
    expect(r.state.hands.right.known).toBe(true);
    expect(r.state.hands.right.closed).toBe(false);
    expect(r.state.hands.left.present).toBe(false);
    r.setHand(1, true, FIST);
    let events = 0;
    for (let i = 0; i < 6; i++) {
      const n = r.step((t += DT));
      for (let j = 0; j < n; j++) {
        const c = r.fp.fistChange(j);
        expect(c.hand).toBe('right');
        expect(c.closed).toBe(true);
        expect(c.t).toBe(t);
      }
      events += n;
    }
    expect(events).toBe(1);
    expect(r.state.hands.right.closed).toBe(true);
    expect(r.state.hands.right.curl).toBeLessThan(0.9);
    // Hand disappears: closed state is kept, velocity zeroed.
    r.setHand(1, false);
    r.step((t += DT));
    expect(r.state.hands.right.present).toBe(false);
    expect(r.state.hands.right.closed).toBe(true);
    expect(r.state.hands.right.known).toBe(true);
    expect(r.state.hands.right.vx).toBe(0);
    r.setHand(1, true, OPEN);
    events = 0;
    for (let i = 0; i < 4; i++) events += r.step((t += DT));
    expect(events).toBe(1);
    expect(r.fp.fistChange(0).closed).toBe(false);
  });

  it('computes palm velocity in sw/s', () => {
    const r = new Rig();
    const lm = new Float32Array(OPEN);
    for (let i = 0; i < 30; i++) {
      const dx = 0.3 * ((i * DT) / 1000);
      for (let k = 0; k < HAND_COUNT; k++) lm[k * HAND_STRIDE] = OPEN[k * HAND_STRIDE] + dx;
      r.setHand(0, true, lm);
      r.step(i * DT);
    }
    // Hand filter lags a ramp but the slope settles close to the true speed.
    expect(r.state.hands.left.vx).toBeGreaterThan((0.3 / 0.16) * 0.8);
    expect(r.state.hands.left.vx).toBeLessThan((0.3 / 0.16) * 1.05);
  });

  it('scales hand velocity by palm size once the pose is gone (no stale shoulder width)', () => {
    const r = new Rig();
    const lm = new Float32Array(OPEN);
    const move = (i: number): void => {
      const dx = 0.3 * ((i * DT) / 1000);
      for (let k = 0; k < HAND_COUNT; k++) lm[k * HAND_STRIDE] = OPEN[k * HAND_STRIDE] + dx;
      r.setHand(0, true, lm);
    };
    for (let i = 0; i < 20; i++) {
      move(i);
      r.step(i * DT);
    }
    const withPose = r.state.hands.left.vx;
    expect(r.state.shoulderWidth).toBeGreaterThan(0);
    r.frame.hasPose = false;
    for (let i = 20; i < 60; i++) {
      move(i);
      r.step(i * DT);
    }
    const handsOnly = r.state.hands.left.vx;
    const palm = palmSize(OPEN, r.state.aspect);
    // Same hand speed: the palm scale (4 x palm) must be used, not the leftover shoulder width.
    const expected = (0.3 * r.state.aspect) / (4 * palm);
    expect(r.state.shoulderWidth).toBeGreaterThan(0);
    expect(handsOnly).toBeGreaterThan(expected * 0.8);
    expect(handsOnly).toBeLessThan(expected * 1.1);
    expect(withPose).toBeGreaterThan(0);
  });

  it('loses tracking after lostAfterMs and recovers', () => {
    const r = new Rig();
    r.step(1000);
    r.fp.tick(1000 + 300);
    expect(r.state.tracking).toBe(true);
    r.fp.tick(1000 + 500);
    expect(r.state.tracking).toBe(false);
    expect(r.state.problem).toBe('lost');
    r.step(1600);
    expect(r.state.tracking).toBe(true);
  });

  it('works hands-only', () => {
    const r = new Rig();
    r.frame.hasPose = false;
    r.setHand(0, true, OPEN);
    r.setHand(1, true, OPEN);
    r.step(1000);
    expect(r.state.hasPose).toBe(false);
    expect(r.state.tracking).toBe(true);
    expect(r.state.problem).toBe('none');
    // Right hand drops out of view.
    r.setHand(1, false);
    r.step(1200);
    expect(r.state.problem).toBe('none');
    r.step(1500);
    expect(r.state.problem).toBe('hands-out-of-view');
    r.setHand(0, false);
    r.step(1600);
    expect(r.state.tracking).toBe(false);
    expect(r.state.problem).toBe('lost');
  });

  it('is not tracking without a hand or shoulders', () => {
    const r = new Rig();
    r.frame.hasPose = false;
    r.step(100);
    expect(r.state.tracking).toBe(false);
    expect(r.state.problem).toBe('lost');
    r.frame.hasPose = true;
    r.frame.pose[PoseIndex.LEFT_SHOULDER * POSE_STRIDE + 3] = 0.1;
    r.step(200);
    expect(r.state.tracking).toBe(false);
  });

  it('tracks a side-on player whose far shoulder is faint, but not one who is not there', () => {
    const r = new Rig();
    // Far shoulder at 0.3: hidden behind the torso, still seen faintly. The player is tracked.
    r.frame.pose[PoseIndex.LEFT_SHOULDER * POSE_STRIDE + 3] = 0.3;
    r.step(100);
    expect(r.state.tracking).toBe(true);
    expect(r.state.problem).toBe('none');
    // Both shoulders gone: not tracking.
    r.frame.pose[PoseIndex.RIGHT_SHOULDER * POSE_STRIDE + 3] = 0.3;
    r.step(200);
    expect(r.state.tracking).toBe(false);
  });

  it('gives positioning hints', () => {
    const r = new Rig();
    r.standing(r.frame.pose, 0.9, 0.05);
    r.step(0);
    expect(r.state.problem).toBe('move-left');
    r.fp.reset();
    r.standing(r.frame.pose, 0.1, 0.05);
    r.step(DT);
    expect(r.state.problem).toBe('move-right');
    r.fp.reset();
    r.standing(r.frame.pose, 0.5, 0.25);
    r.step(2 * DT);
    expect(r.state.problem).toBe('step-back');
    r.standing(r.frame.pose, 0.5, 0.02);
    r.fp.reset();
    r.step(3 * DT);
    expect(r.state.problem).toBe('step-closer');
  });

  it('treats off-image landmarks as invisible', () => {
    const r = new Rig();
    setLm(r.frame.pose, PoseIndex.LEFT_ANKLE, 0.5, 1.4, 0.99);
    r.step(0);
    expect(r.state.pose[PoseIndex.LEFT_ANKLE * POSE_STRIDE + 3]).toBe(0);
  });

  it('resets when the clock goes backwards and ignores duplicate timestamps', () => {
    const r = new Rig();
    r.step(5000);
    expect(r.step(5000)).toBe(0);
    r.step(100);
    expect(r.state.t).toBe(100);
    expect(r.state.tPrev).toBe(100);
    expect(r.state.tracking).toBe(true);
  });

  it('survives 2000 frames with finite outputs', () => {
    const r = new Rig();
    r.setHand(0, true, OPEN);
    r.setHand(1, true, FIST);
    const pose = r.frame.pose;
    for (let i = 0; i < 2000; i++) {
      const s = i * 0.1;
      setLm(pose, PoseIndex.RIGHT_WRIST, 0.6 + 0.2 * Math.sin(s), 0.4 + 0.2 * Math.cos(s * 1.3));
      setLm(pose, PoseIndex.LEFT_WRIST, 0.4 + 0.2 * Math.sin(s * 0.7), 0.5);
      setLm(pose, PoseIndex.NOSE, 1.2, -0.2);
      r.hands[1].landmarks[HandIndex.INDEX_TIP * HAND_STRIDE + 1] = 0.5 + 0.3 * Math.sin(s);
      r.hands[0].present = i % 50 < 40;
      r.frame.hasPose = i % 300 < 280;
      r.step(i * DT);
      if (i % 3 === 0) r.fp.tick(i * DT);
    }
    const st = r.state;
    const nums = [
      st.shoulderWidth,
      st.lean,
      st.lateral,
      st.rise,
      st.arms.left.vx,
      st.arms.left.vy,
      st.arms.left.speed,
      st.arms.left.elbowAngle,
      st.arms.left.elbowRate,
      st.arms.right.vx,
      st.arms.right.speed,
      st.hands.left.x,
      st.hands.left.vx,
      st.hands.right.curl,
      st.hands.right.vy,
    ];
    for (const n of nums) expect(Number.isFinite(n)).toBe(true);
    for (const v of st.pose) expect(Number.isFinite(v)).toBe(true);
  });
});
