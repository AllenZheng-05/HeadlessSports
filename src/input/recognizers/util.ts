import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import { SlopeEstimator } from '../filters/slope';
import type { InputState, Side } from '../types';
import type { RecognizerConfig } from './config';

/** How far back (ms) a velocity estimate made at this frame really points. */
export function velocityLagMs(state: InputState, config: RecognizerConfig): number {
  const dt = state.t - state.tPrev;
  return dt > 0 && dt < 200 ? config.velocityLagFrames * dt : 0;
}

export function visible(pose: Float32Array, index: number, min = 0.5): boolean {
  return pose[index * POSE_STRIDE + 3] >= min;
}

/** Shoulder-line height above image y `y` in sw (positive when `y` is above the shoulders). */
export function heightAboveShoulders(state: InputState, y: number): number {
  const p = state.pose;
  const mid =
    (p[PoseIndex.LEFT_SHOULDER * POSE_STRIDE + 1] + p[PoseIndex.RIGHT_SHOULDER * POSE_STRIDE + 1]) /
    2;
  return state.shoulderWidth > 0 ? (mid - y) / state.shoulderWidth : 0;
}

/**
 * Distance between the two wrists in sw, or Infinity when either is not visible or the shoulder
 * width is unknown.
 */
export function wristDistance(state: InputState): number {
  const p = state.pose;
  const l = PoseIndex.LEFT_WRIST;
  const r = PoseIndex.RIGHT_WRIST;
  if (!visible(p, l) || !visible(p, r) || !(state.shoulderWidth > 0)) return Infinity;
  const a = state.aspect;
  return (
    Math.hypot(
      (p[l * POSE_STRIDE] - p[r * POSE_STRIDE]) * a,
      p[l * POSE_STRIDE + 1] - p[r * POSE_STRIDE + 1],
    ) / state.shoulderWidth
  );
}

/**
 * Signed Menger curvature of the path a -> b -> c, in 1/length, y UP.
 * Positive when the path turns clockwise on screen, i.e. curves toward screen right as it
 * advances (going up and bending toward +x is positive). 0 for a straight or degenerate path.
 */
export function signedCurvature(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const bcx = cx - bx;
  const bcy = cy - by;
  const cross = abx * bcy - aby * bcx; // positive = counter-clockwise (left turn)
  const d = Math.hypot(abx, aby) * Math.hypot(bcx, bcy) * Math.hypot(cx - ax, cy - ay);
  if (!(d > 1e-9)) return 0;
  return (-2 * cross) / d;
}

/**
 * One wrist's velocity RELATIVE TO ITS SHOULDER, sw/s, y up. `state.arms[hand].vx/vy` is the
 * wrist's image velocity, which also contains the body's own motion (a sidestep, a squat, a
 * lean); gestures are judged on the arm alone, so recognizers use this instead.
 */
export class RelativeWrist {
  vx = 0;
  vy = 0;
  speed = 0;
  private readonly sx: SlopeEstimator;
  private readonly sy: SlopeEstimator;

  constructor(
    private readonly hand: Side,
    window = 4,
  ) {
    this.sx = new SlopeEstimator(window);
    this.sy = new SlopeEstimator(window);
  }

  push(state: InputState): void {
    const arm = state.arms[this.hand];
    this.sx.push(arm.wristX, state.t);
    this.sy.push(arm.wristY, state.t);
    this.vx = this.sx.slope();
    this.vy = this.sy.slope();
    this.speed = Math.hypot(this.vx, this.vy);
  }

  reset(): void {
    this.sx.reset();
    this.sy.reset();
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
  }
}

/** Speed of the shoulder midpoint in the image, sw/s. */
export class BodyMotion {
  speed = 0;
  private readonly sx: SlopeEstimator;
  private readonly sy: SlopeEstimator;

  constructor(window = 4) {
    this.sx = new SlopeEstimator(window);
    this.sy = new SlopeEstimator(window);
  }

  push(state: InputState): void {
    const p = state.pose;
    const ls = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
    const rs = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;
    this.sx.push(((p[ls] + p[rs]) / 2) * state.aspect, state.t);
    this.sy.push(-(p[ls + 1] + p[rs + 1]) / 2, state.t);
    const sw = state.shoulderWidth;
    this.speed = sw > 0 ? Math.hypot(this.sx.slope(), this.sy.slope()) / sw : 0;
  }

  reset(): void {
    this.sx.reset();
    this.sy.reset();
    this.speed = 0;
  }
}
