import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import { createInputState } from '../state';
import type { InputState, Side } from '../types';

/**
 * Hand-built `InputState` for recognizer unit tests. Aspect 16/9, shoulder width 0.1 of the image
 * height, shoulder midpoint at (0.5, 0.3), hips 1.5 sw lower, knees 1.1 sw below the hips, arms
 * hanging. Everything is set directly, with no filters, so tests control thresholds exactly.
 */
export const TEST_ASPECT = 16 / 9;
export const TEST_SW = 0.1;
export const TEST_SHOULDER_Y = 0.3;
export const TEST_HIP_Y = TEST_SHOULDER_Y + 1.5 * TEST_SW;
export const TEST_KNEE_DROP = 1.1;

const SHOULDER_X = [0.5 - 0.5 * (TEST_SW / TEST_ASPECT), 0.5 + 0.5 * (TEST_SW / TEST_ASPECT)];

function put(state: InputState, index: number, x: number, y: number, vis = 0.95): void {
  const o = index * POSE_STRIDE;
  state.pose[o] = x;
  state.pose[o + 1] = y;
  state.pose[o + 2] = 0;
  state.pose[o + 3] = vis;
}

export function createTestState(): InputState {
  const s = createInputState();
  s.aspect = TEST_ASPECT;
  s.hasPose = true;
  s.tracking = true;
  s.problem = 'none';
  s.shoulderWidth = TEST_SW;
  put(s, PoseIndex.LEFT_SHOULDER, SHOULDER_X[0], TEST_SHOULDER_Y);
  put(s, PoseIndex.RIGHT_SHOULDER, SHOULDER_X[1], TEST_SHOULDER_Y);
  setHips(s, 0);
  setKnees(s, 0, 0);
  setWrist(s, 'left', -0.12, -1.4);
  setWrist(s, 'right', 0.12, -1.4);
  return s;
}

/** Move the clock: `tPrev` becomes the old `t`. */
export function advance(state: InputState, t: number): void {
  state.tPrev = state.t;
  state.t = t;
}

/** Wrist relative to its own shoulder, sw, y up. Updates `state.arms` and the pose landmark. */
export function setWrist(state: InputState, hand: Side, x: number, y: number): void {
  const arm = state.arms[hand];
  arm.wristX = x;
  arm.wristY = y;
  const i = hand === 'left' ? 0 : 1;
  put(
    state,
    hand === 'left' ? PoseIndex.LEFT_WRIST : PoseIndex.RIGHT_WRIST,
    SHOULDER_X[i] + (x * TEST_SW) / TEST_ASPECT,
    TEST_SHOULDER_Y - y * TEST_SW,
  );
}

/** Both wrists at (x, y) sw from the shoulder MIDPOINT (y up), `gap` sw apart. */
export function setGrip(state: InputState, x: number, y: number, gap = 0.1): void {
  const mid = 0.5;
  const lx = mid + ((x - gap / 2) * TEST_SW) / TEST_ASPECT;
  const rx = mid + ((x + gap / 2) * TEST_SW) / TEST_ASPECT;
  const py = TEST_SHOULDER_Y - y * TEST_SW;
  put(state, PoseIndex.LEFT_WRIST, lx, py);
  put(state, PoseIndex.RIGHT_WRIST, rx, py);
  state.arms.left.wristX = x - gap / 2 + 0.5;
  state.arms.right.wristX = x + gap / 2 - 0.5;
  state.arms.left.wristY = y;
  state.arms.right.wristY = y;
}

/** Knee lifts in sw above standing (0 = standing). */
export function setKnees(state: InputState, left: number, right: number): void {
  const hipX = [0.5 - 0.31 * (TEST_SW / TEST_ASPECT), 0.5 + 0.31 * (TEST_SW / TEST_ASPECT)];
  const hipY = state.pose[PoseIndex.LEFT_HIP * POSE_STRIDE + 1];
  put(state, PoseIndex.LEFT_KNEE, hipX[0], hipY + (TEST_KNEE_DROP - left) * TEST_SW);
  put(state, PoseIndex.RIGHT_KNEE, hipX[1], hipY + (TEST_KNEE_DROP - right) * TEST_SW);
}

/** Hips `rise` sw above the standing height (negative = crouched). Does not move the knees. */
export function setHips(state: InputState, rise: number): void {
  const y = TEST_HIP_Y - rise * TEST_SW;
  put(state, PoseIndex.LEFT_HIP, 0.5 - 0.31 * (TEST_SW / TEST_ASPECT), y);
  put(state, PoseIndex.RIGHT_HIP, 0.5 + 0.31 * (TEST_SW / TEST_ASPECT), y);
}
