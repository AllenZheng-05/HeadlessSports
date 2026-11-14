import type { Side } from '../../input/types';
import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import type { ArcheryConfig } from './config';

/** -1 for the left side, +1 for the right (screen direction, mirrored image coordinates). */
export function sideSign(side: Side): number {
  return side === 'left' ? -1 : 1;
}

export function otherSide(side: Side): Side {
  return side === 'left' ? 'right' : 'left';
}

export const saturate = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The bow wrist is far enough from its shoulder and roughly at shoulder height. */
export function bowArmUp(
  wristX: number,
  wristY: number,
  cfg: Pick<ArcheryConfig, 'bowMinReach' | 'bowMaxDrop'>,
): boolean {
  return Math.hypot(wristX, wristY) >= cfg.bowMinReach && Math.abs(wristY) <= cfg.bowMaxDrop;
}

/** How far the bow wrist is out from its shoulder, sw, outward positive for either side. */
export function bowOut(wristX: number, bowSide: Side): number {
  return sideSign(bowSide) * wristX;
}

/**
 * World yaw (radians, positive toward screen right / world +x) for a bow wrist position. Moving the
 * bow hand further out aims further out, so the sign follows the bow side.
 */
export function targetYaw(wristX: number, bowSide: Side, cfg: ArcheryConfig): number {
  const raw = (bowOut(wristX, bowSide) - cfg.neutralX) * cfg.aimGainX;
  const mag = raw < -cfg.maxYaw ? -cfg.maxYaw : raw > cfg.maxYaw ? cfg.maxYaw : raw;
  return sideSign(bowSide) * mag;
}

/** Pitch (radians, positive up) for a bow wrist height (positive up, sw). */
export function targetPitch(wristY: number, cfg: ArcheryConfig): number {
  const raw = (wristY - cfg.neutralY) * cfg.aimGainY;
  return raw < cfg.minPitch ? cfg.minPitch : raw > cfg.maxPitch ? cfg.maxPitch : raw;
}

/** Critically damped follower for one scalar. */
export class DampedValue {
  value = 0;
  private vel = 0;

  reset(value: number): void {
    this.value = value;
    this.vel = 0;
  }

  update(target: number, dt: number, smoothS: number): number {
    if (dt <= 0) return this.value;
    const omega = 2 / Math.max(1e-3, smoothS);
    const x = omega * dt;
    const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.value - target;
    const temp = (this.vel + omega * change) * dt;
    this.vel = (this.vel - omega * temp) * e;
    this.value = target + (change + temp) * e;
    return this.value;
  }
}

/** Sway amplitude, radians, after `holdFullS` seconds at full draw. */
export function swayAmplitude(holdFullS: number, cfg: ArcheryConfig): number {
  return cfg.maxSwayRad * saturate(holdFullS / Math.max(1e-3, cfg.swayRampS));
}

export interface Sway {
  x: number;
  y: number;
}

const TAU = Math.PI * 2;

/**
 * Slow, small, deterministic sway: two sines per axis. `phases` holds four phases in radians.
 * Always within +-amp on each axis.
 */
export function swayOffset(t: number, amp: number, phases: ArrayLike<number>, out: Sway): void {
  out.x =
    (amp * (Math.sin(TAU * 0.31 * t + phases[0]!) + 0.6 * Math.sin(TAU * 0.77 * t + phases[1]!))) /
    1.6;
  out.y =
    (amp * (Math.sin(TAU * 0.43 * t + phases[2]!) + 0.6 * Math.sin(TAU * 0.97 * t + phases[3]!))) /
    1.6;
}

/**
 * 2D distance between the two wrists in shoulder widths, from pose landmarks 15 and 16 with aspect
 * correction. Returns -1 when the wrists are not both visible or the shoulder width is unknown.
 */
export function wristDistance(
  pose: Float32Array,
  aspect: number,
  shoulderWidth: number,
  minVisibility = 0.3,
): number {
  if (!(shoulderWidth > 1e-6)) return -1;
  const l = PoseIndex.LEFT_WRIST * POSE_STRIDE;
  const r = PoseIndex.RIGHT_WRIST * POSE_STRIDE;
  if (pose[l + 3]! < minVisibility || pose[r + 3]! < minVisibility) return -1;
  const dx = (pose[l]! - pose[r]!) * aspect;
  const dy = pose[l + 1]! - pose[r + 1]!;
  return Math.hypot(dx, dy) / shoulderWidth;
}

/** 0..1 draw from the wrist distance. */
export function drawFraction(
  dist: number,
  cfg: Pick<ArcheryConfig, 'drawStart' | 'drawFull'>,
): number {
  return saturate((dist - cfg.drawStart) / Math.max(1e-6, cfg.drawFull - cfg.drawStart));
}
