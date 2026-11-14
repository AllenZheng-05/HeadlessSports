import { PoseIndex, POSE_COUNT, POSE_STRIDE } from '../../tracking/types';
import { inputConfig } from '../config';
import { SlopeEstimator } from '../filters/slope';
import type { ArmState, Calibration, InputState } from '../types';

/** Time constant of the shoulder-width smoothing, seconds. */
const SHOULDER_TAU_S = 0.5;

/** Zero the visibility of every landmark whose x or y lies outside [0, 1]. In place. */
export function sanitizeVisibility(pose: Float32Array): void {
  for (let i = 0; i < POSE_COUNT; i++) {
    const o = i * POSE_STRIDE;
    const x = pose[o];
    const y = pose[o + 1];
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) pose[o + 3] = 0;
  }
}

/** Interior angle at b for points a-b-c, aspect-corrected 2D, radians. */
export function jointAngle(
  pose: Float32Array,
  a: number,
  b: number,
  c: number,
  aspect: number,
): number {
  const bo = b * POSE_STRIDE;
  const ax = (pose[a * POSE_STRIDE] - pose[bo]) * aspect;
  const ay = pose[a * POSE_STRIDE + 1] - pose[bo + 1];
  const cx = (pose[c * POSE_STRIDE] - pose[bo]) * aspect;
  const cy = pose[c * POSE_STRIDE + 1] - pose[bo + 1];
  return Math.atan2(Math.abs(ax * cy - ay * cx), ax * cx + ay * cy);
}

export class PoseKinematics {
  private readonly minVisibility: number;
  private readonly wristXLeft: SlopeEstimator;
  private readonly wristYLeft: SlopeEstimator;
  private readonly elbowLeft: SlopeEstimator;
  private readonly wristXRight: SlopeEstimator;
  private readonly wristYRight: SlopeEstimator;
  private readonly elbowRight: SlopeEstimator;
  private smoothedWidth = 0;
  private hasWidth = false;
  private lastT = Number.NaN;

  constructor(velocityWindow = 4, minVisibility = inputConfig.minVisibility) {
    this.minVisibility = minVisibility;
    this.wristXLeft = new SlopeEstimator(velocityWindow);
    this.wristYLeft = new SlopeEstimator(velocityWindow);
    this.elbowLeft = new SlopeEstimator(velocityWindow);
    this.wristXRight = new SlopeEstimator(velocityWindow);
    this.wristYRight = new SlopeEstimator(velocityWindow);
    this.elbowRight = new SlopeEstimator(velocityWindow);
  }

  /** Reads state.pose (already filtered) and fills shoulderWidth, arms, lean, lateral, rise. */
  update(state: InputState, calibration: Calibration | null): void {
    const p = state.pose;
    const a = state.aspect;
    const t = state.t;
    const ls = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
    const rs = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;

    if (p[ls + 3] >= this.minVisibility && p[rs + 3] >= this.minVisibility) {
      const w = Math.hypot((p[ls] - p[rs]) * a, p[ls + 1] - p[rs + 1]);
      if (!this.hasWidth) {
        this.smoothedWidth = w;
        this.hasWidth = true;
      } else {
        const dt = Number.isFinite(this.lastT) ? Math.max(0, t - this.lastT) / 1000 : 0;
        this.smoothedWidth += (1 - Math.exp(-dt / SHOULDER_TAU_S)) * (w - this.smoothedWidth);
      }
      state.shoulderWidth = this.smoothedWidth;
    }
    this.lastT = t;
    const sw = state.shoulderWidth;

    this.updateArm(
      state.arms.left,
      p,
      a,
      t,
      sw,
      PoseIndex.LEFT_SHOULDER,
      PoseIndex.LEFT_ELBOW,
      PoseIndex.LEFT_WRIST,
      this.wristXLeft,
      this.wristYLeft,
      this.elbowLeft,
    );
    this.updateArm(
      state.arms.right,
      p,
      a,
      t,
      sw,
      PoseIndex.RIGHT_SHOULDER,
      PoseIndex.RIGHT_ELBOW,
      PoseIndex.RIGHT_WRIST,
      this.wristXRight,
      this.wristYRight,
      this.elbowRight,
    );

    const midSx = (p[ls] + p[rs]) / 2;
    const midSy = (p[ls + 1] + p[rs + 1]) / 2;
    const lh = PoseIndex.LEFT_HIP * POSE_STRIDE;
    const rh = PoseIndex.RIGHT_HIP * POSE_STRIDE;
    if (p[lh + 3] >= this.minVisibility && p[rh + 3] >= this.minVisibility) {
      const midHx = (p[lh] + p[rh]) / 2;
      const midHy = (p[lh + 1] + p[rh + 1]) / 2;
      state.lean = Math.atan2((midSx - midHx) * a, midHy - midSy);
      state.rise = calibration !== null && sw > 0 ? (calibration.hipY - midHy) / sw : 0;
    }
    const centreX = calibration !== null ? calibration.centreX : 0.5;
    state.lateral = sw > 0 ? ((midSx - centreX) * a) / sw : 0;
  }

  private updateArm(
    arm: ArmState,
    p: Float32Array,
    aspect: number,
    t: number,
    sw: number,
    shoulder: number,
    elbow: number,
    wrist: number,
    sx: SlopeEstimator,
    sy: SlopeEstimator,
    se: SlopeEstimator,
  ): void {
    const so = shoulder * POSE_STRIDE;
    const wo = wrist * POSE_STRIDE;
    const wx = p[wo] * aspect;
    const wyUp = -p[wo + 1];
    sx.push(wx, t);
    sy.push(wyUp, t);
    const angle = jointAngle(p, shoulder, elbow, wrist, aspect);
    se.push(angle, t);
    arm.elbowAngle = angle;
    arm.elbowRate = se.slope();
    if (sw > 0) {
      arm.wristX = (wx - p[so] * aspect) / sw;
      arm.wristY = (wyUp + p[so + 1]) / sw;
      arm.vx = sx.slope() / sw;
      arm.vy = sy.slope() / sw;
      arm.speed = Math.hypot(arm.vx, arm.vy);
    } else {
      arm.wristX = 0;
      arm.wristY = 0;
      arm.vx = 0;
      arm.vy = 0;
      arm.speed = 0;
    }
  }

  reset(): void {
    this.wristXLeft.reset();
    this.wristYLeft.reset();
    this.elbowLeft.reset();
    this.wristXRight.reset();
    this.wristYRight.reset();
    this.elbowRight.reset();
    this.smoothedWidth = 0;
    this.hasWidth = false;
    this.lastT = Number.NaN;
  }
}
