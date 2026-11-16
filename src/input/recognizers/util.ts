import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import { SlopeEstimator } from '../filters/slope';
import type { InputState, RejectReason, Side } from '../types';
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

/** Where a wrist counts as seen and how long it is coasted when it is not (config.throw / .swing). */
export interface WristLimits {
  /** Visibility at which a wrist is first seen. */
  wristVisibility: number;
  /** Visibility that keeps a wrist that is already moving fast in use (it blurs at the peak). */
  movingVisibility: number;
  coastMs: number;
}

/** A wrist faster than this (sw/s) is "moving" for `movingVisibility`. */
const MOVING_SPEED = 1.5;

export const DEFAULT_WRIST_LIMITS: WristLimits = {
  wristVisibility: 0.25,
  movingVisibility: 0.1,
  coastMs: 120,
};

/**
 * One wrist's velocity RELATIVE TO THE SHOULDER MIDPOINT, sw/s, y up, read from the filtered pose.
 * `state.arms[hand].vx/vy` is the wrist's image velocity, which also contains the body's own
 * motion (a sidestep, a squat, a lean); gestures are judged on the arm alone, so recognizers use
 * this instead. The midpoint of the shoulders is steadier than either shoulder: side-on, the far
 * shoulder is hidden and jitters, and the near one is turning with the torso.
 *
 * A wrist that drops out of sight (motion blur at the speed peak, the far arm side-on) is coasted:
 * for `limits.coastMs` the last velocity is held and `visible` is false; after that the estimate is
 * cleared and `lost` is true. Scaled by `state.shoulderWidth`, which is a stable body scale.
 */
export class RelativeWrist {
  vx = 0;
  vy = 0;
  speed = 0;
  /** The wrist was seen on the latest frame. */
  visible = false;
  /** The wrist has been out of sight for longer than the coast. */
  lost = true;
  private readonly sx: SlopeEstimator;
  private readonly sy: SlopeEstimator;
  private lastSeenT = Number.NEGATIVE_INFINITY;
  private keptSeenT = Number.NEGATIVE_INFINITY;
  private pushedT = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly hand: Side,
    private readonly limits: WristLimits = DEFAULT_WRIST_LIMITS,
    window = 4,
  ) {
    this.sx = new SlopeEstimator(window);
    this.sy = new SlopeEstimator(window);
  }

  /** Game ms of the last frame the wrist was seen (kept after the estimate is cleared). */
  get lastSeen(): number {
    return this.keptSeenT;
  }

  push(state: InputState): void {
    const p = state.pose;
    const t = state.t;
    const wi = (this.hand === 'left' ? PoseIndex.LEFT_WRIST : PoseIndex.RIGHT_WRIST) * POSE_STRIDE;
    const sw = state.shoulderWidth;
    if (!(sw > 0)) {
      this.clear();
      return;
    }
    const coastMs = this.limits.coastMs;
    // A wrist that is already moving fast keeps being followed down to a lower visibility: motion
    // blur lowers it exactly at the speed peak, and the landmark is still good enough there.
    const need =
      this.speed > MOVING_SPEED && t - this.lastSeenT <= coastMs
        ? this.limits.movingVisibility
        : this.limits.wristVisibility;
    if (p[wi + 3] >= need) {
      const ls = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
      const rs = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;
      // A gap longer than the coast leaves old samples that would blur the slope: start afresh.
      if (t - this.pushedT > coastMs + 100) {
        this.sx.reset();
        this.sy.reset();
      }
      this.sx.push((p[wi] - (p[ls] + p[rs]) / 2) * state.aspect, t);
      this.sy.push((p[ls + 1] + p[rs + 1]) / 2 - p[wi + 1], t);
      this.pushedT = t;
      this.lastSeenT = t;
      this.keptSeenT = t;
      this.visible = true;
      this.lost = false;
      this.vx = this.sx.slope() / sw;
      this.vy = this.sy.slope() / sw;
      this.speed = Math.hypot(this.vx, this.vy);
      return;
    }
    this.visible = false;
    if (t - this.lastSeenT > coastMs) {
      this.clear();
    }
  }

  private clear(): void {
    this.sx.reset();
    this.sy.reset();
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.visible = false;
    this.lost = true;
    this.pushedT = Number.NEGATIVE_INFINITY;
    this.lastSeenT = Number.NEGATIVE_INFINITY;
  }

  reset(): void {
    this.clear();
    this.keptSeenT = Number.NEGATIVE_INFINITY;
  }
}

/**
 * Record a motion that was noticed but is not an event (see `InputState.rejected`). Does nothing
 * when the state has no note slot (hand-built test states). No allocation.
 */
export function noteRejected(
  state: InputState,
  kind: 'swing' | 'throw',
  reason: RejectReason,
  t: number,
  speed: number,
  hand?: Side,
): void {
  const r = state.rejected;
  if (r === undefined) return;
  r.hand = hand;
  r.seq++;
  r.t = t;
  r.kind = kind;
  r.reason = reason;
  r.speed = speed;
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
