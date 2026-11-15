import { POSE_STRIDE, PoseIndex } from '../tracking/types';

/**
 * Left/right consistency guard for the pose landmarks. MediaPipe Pose sometimes exchanges the left
 * and right landmarks for a few frames or for a whole stretch, most often with the arms overhead.
 * Players also really turn side-on (pitching, javelin, batting, bowling), so the shoulders
 * reversing in x is NOT evidence of a swap. Everything is decided by continuity with the previous
 * corrected frame, on the raw landmarks of a frame, before filtering:
 *
 * 1. Body: the shoulders, hips and legs are compared with the last frame. Every pair is exchanged
 *    only when that fits the last frame much better than keeping them, a sudden exchange between
 *    consecutive frames. A turn is gradual, so it is never touched, even past side-on. With no
 *    previous frame (start, tracking lost) nothing is exchanged.
 * 2. Arms: the elbows and wrists are compared the same way, and the exchange also has to keep the
 *    upper-arm lengths plausible. It is vetoed when the raw frame is anatomically consistent (each
 *    elbow clearly nearer its own shoulder), and capped at `armMaxRun` consecutive frames when the
 *    raw frame is ambiguous, so a wrong exchange cannot feed on its own history.
 *
 * Distance margins scale with the shoulder width or torso length, with a floor for side-on poses.
 * Pure and allocation-free.
 */
export interface SideGuardConfig {
  enabled: boolean;
  /** A body exchange must cost at most this fraction of keeping the pairs as they are. */
  bodyRatio: number;
  /** ...and gain at least this many body scales (summed over the torso and leg landmarks). */
  bodyMinGain: number;
  /** An arm exchange must cost at most this fraction of keeping the arms as they are. */
  armRatio: number;
  /** ...and gain at least this many body scales (summed over elbows and wrists). */
  armMinGain: number;
  /** An elbow belongs to the nearer shoulder when it is nearer by this many body scales. */
  elbowSideMargin: number;
  /** Most consecutive arm exchanges accepted while the raw frame is not clearly swapped. */
  armMaxRun: number;
  /** Smallest body scale (aspect-scaled image units), for side-on poses. */
  scaleFloor: number;
}

export const sideGuardConfig: SideGuardConfig = {
  enabled: true,
  bodyRatio: 0.5,
  bodyMinGain: 0.5,
  armRatio: 0.5,
  armMinGain: 0.6,
  elbowSideMargin: 0.25,
  armMaxRun: 15,
  scaleFloor: 0.05,
};

/** Memory the guard keeps between frames; reset by any call with no previous frame. */
export interface SideGuardState {
  armRun: number;
}

export function createSideGuardState(): SideGuardState {
  return { armRun: 0 };
}

export const SIDE_NONE = 0;
export const SIDE_BODY = 1;
export const SIDE_ARMS = 2;

/** True when the arm landmarks, net of both exchanges, changed sides. */
export function armsSwapped(result: number): boolean {
  return result === SIDE_BODY || result === SIDE_ARMS;
}

function swap(pose: Float32Array, a: number, b: number): void {
  const ia = a * POSE_STRIDE;
  const ib = b * POSE_STRIDE;
  for (let c = 0; c < POSE_STRIDE; c++) {
    const t = pose[ia + c];
    pose[ia + c] = pose[ib + c];
    pose[ib + c] = t;
  }
}

/** Exchange every left/right pair (face and body). */
export function swapBody(pose: Float32Array): void {
  swap(pose, 1, 4);
  swap(pose, 2, 5);
  swap(pose, 3, 6);
  swap(pose, 7, 8);
  swap(pose, 9, 10);
  for (let i = PoseIndex.LEFT_SHOULDER; i < 32; i += 2) swap(pose, i, i + 1);
}

/** Exchange elbows, wrists and the hand points (pinky, index, thumb); shoulders stay. */
export function swapArms(pose: Float32Array): void {
  for (let i = PoseIndex.LEFT_ELBOW; i <= PoseIndex.LEFT_THUMB; i += 2) swap(pose, i, i + 1);
}

function dist(a: Float32Array, ia: number, b: Float32Array, ib: number, aspect: number): number {
  const dx = (a[ia * POSE_STRIDE] - b[ib * POSE_STRIDE]) * aspect;
  const dy = a[ia * POSE_STRIDE + 1] - b[ib * POSE_STRIDE + 1];
  return Math.sqrt(dx * dx + dy * dy);
}

function visible(p: Float32Array, i: number, min: number): boolean {
  return p[i * POSE_STRIDE + 3] >= min;
}

/** Body size for margins: shoulder width or half the torso, whichever is larger, never below the floor. */
function bodyScale(p: Float32Array, aspect: number, floor: number): number {
  const S = POSE_STRIDE;
  const LS = PoseIndex.LEFT_SHOULDER * S;
  const RS = PoseIndex.RIGHT_SHOULDER * S;
  const LH = PoseIndex.LEFT_HIP * S;
  const RH = PoseIndex.RIGHT_HIP * S;
  let scale = floor;
  const w = dist(p, PoseIndex.LEFT_SHOULDER, p, PoseIndex.RIGHT_SHOULDER, aspect);
  if (w > scale) scale = w;
  if (p[LH + 3] > 0 && p[RH + 3] > 0) {
    const mx = (p[LS] + p[RS] - p[LH] - p[RH]) * 0.5 * aspect;
    const my = (p[LS + 1] + p[RS + 1] - p[LH + 1] - p[RH + 1]) * 0.5;
    const torso = 0.5 * Math.sqrt(mx * mx + my * my);
    if (torso > scale) scale = torso;
  }
  return scale;
}

const costs = { keep: 0, exch: 0 };

/** Add one left/right pair's keep and exchange costs to `costs` when all four points are visible. */
function addPair(
  pose: Float32Array,
  prev: Float32Array,
  l: number,
  aspect: number,
  minVis: number,
): boolean {
  const r = l + 1;
  if (
    !visible(pose, l, minVis) ||
    !visible(pose, r, minVis) ||
    !visible(prev, l, minVis) ||
    !visible(prev, r, minVis)
  ) {
    return false;
  }
  costs.keep += dist(pose, l, prev, l, aspect) + dist(pose, r, prev, r, aspect);
  costs.exch += dist(pose, l, prev, r, aspect) + dist(pose, r, prev, l, aspect);
  return true;
}

/**
 * Corrects `pose` in place. `prev` is the previous corrected frame (valid when `hasPrev`); without
 * one nothing is changed. Returns a bit set of what was exchanged: SIDE_BODY, SIDE_ARMS, both, or
 * SIDE_NONE. The arms (and so any hand cropped around a wrist) changed sides only when exactly one
 * bit is set.
 */
export function guardSides(
  pose: Float32Array,
  prev: Float32Array,
  hasPrev: boolean,
  aspect: number,
  minVisibility: number,
  cfg: SideGuardConfig,
  st: SideGuardState,
): number {
  if (!hasPrev) st.armRun = 0;
  if (!cfg.enabled || !hasPrev) return SIDE_NONE;
  const LS = PoseIndex.LEFT_SHOULDER;
  const RS = PoseIndex.RIGHT_SHOULDER;
  let result = SIDE_NONE;

  // 1. Whole body by continuity: shoulders, hips and legs. The arms get their own check below.
  costs.keep = 0;
  costs.exch = 0;
  const shoulders = addPair(pose, prev, LS, aspect, minVisibility);
  const hips = addPair(pose, prev, PoseIndex.LEFT_HIP, aspect, minVisibility);
  if (shoulders || hips) {
    for (let l = PoseIndex.LEFT_KNEE; l < 32; l += 2) addPair(pose, prev, l, aspect, minVisibility);
    const scale = bodyScale(prev, aspect, cfg.scaleFloor);
    if (
      costs.exch < costs.keep * cfg.bodyRatio &&
      costs.keep - costs.exch > cfg.bodyMinGain * scale
    ) {
      swapBody(pose);
      result = SIDE_BODY;
    }
  }

  // 2. Arms: continuity, plausibility, and an independent look at the raw frame.
  const LE = PoseIndex.LEFT_ELBOW;
  const RE = PoseIndex.RIGHT_ELBOW;
  const LW = PoseIndex.LEFT_WRIST;
  const RW = PoseIndex.RIGHT_WRIST;
  if (
    !visible(pose, LS, minVisibility) ||
    !visible(pose, RS, minVisibility) ||
    !visible(pose, LE, minVisibility) ||
    !visible(pose, RE, minVisibility) ||
    !visible(pose, LW, minVisibility) ||
    !visible(pose, RW, minVisibility) ||
    !visible(prev, LE, minVisibility) ||
    !visible(prev, RE, minVisibility) ||
    !visible(prev, LW, minVisibility) ||
    !visible(prev, RW, minVisibility)
  ) {
    st.armRun = 0;
    return result;
  }
  const keep =
    dist(pose, LE, prev, LE, aspect) +
    dist(pose, LW, prev, LW, aspect) +
    dist(pose, RE, prev, RE, aspect) +
    dist(pose, RW, prev, RW, aspect);
  const exch =
    dist(pose, LE, prev, RE, aspect) +
    dist(pose, LW, prev, RW, aspect) +
    dist(pose, RE, prev, LE, aspect) +
    dist(pose, RW, prev, LW, aspect);
  const scale = bodyScale(pose, aspect, cfg.scaleFloor);
  if (!(exch < keep * cfg.armRatio && keep - exch > cfg.armMinGain * scale)) {
    st.armRun = 0;
    return result;
  }

  // The raw frame on its own, independent of the corrected history: is each elbow nearer its own
  // shoulder? If both clearly are, the history is what is wrong, so keep the raw arms.
  const margin = cfg.elbowSideMargin * scale;
  const leftOwn = dist(pose, LE, pose, LS, aspect);
  const leftOther = dist(pose, LE, pose, RS, aspect);
  const rightOwn = dist(pose, RE, pose, RS, aspect);
  const rightOther = dist(pose, RE, pose, LS, aspect);
  if (leftOther - leftOwn > margin && rightOther - rightOwn > margin) {
    st.armRun = 0;
    return result;
  }
  // Not clearly swapped either (elbows near the midline): do not keep exchanging for ever.
  const clearlySwapped = leftOwn - leftOther > margin && rightOwn - rightOther > margin;
  if (!clearlySwapped && st.armRun >= cfg.armMaxRun) {
    st.armRun = 0;
    return result;
  }

  // Plausibility: the upper arm from each shoulder should keep the length it had a frame ago.
  const lenL = dist(prev, LS, prev, LE, aspect);
  const lenR = dist(prev, RS, prev, RE, aspect);
  const errKeep =
    Math.abs(dist(pose, LS, pose, LE, aspect) - lenL) +
    Math.abs(dist(pose, RS, pose, RE, aspect) - lenR);
  const errExch =
    Math.abs(dist(pose, LS, pose, RE, aspect) - lenL) +
    Math.abs(dist(pose, RS, pose, LE, aspect) - lenR);
  if (errExch > errKeep) {
    st.armRun = 0;
    return result;
  }

  swapArms(pose);
  st.armRun++;
  return result | SIDE_ARMS;
}
