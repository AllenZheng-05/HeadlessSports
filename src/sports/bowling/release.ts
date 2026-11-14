import type { Side } from '../../input/types';

/** The slice of the config the release mapping reads. */
export interface ReleaseConfig {
  minBallSpeed: number;
  maxBallSpeed: number;
  speedFloor: number;
  speedCeil: number;
  neutralLateral: number;
  aimGain: number;
  maxAngle: number;
  aimShoulderHalf: number;
  aimSmooth: number;
  hookGain: number;
  maxHook: number;
  lateralScale: number;
  maxBowlerX: number;
  lateralSmooth: number;
}

export interface ReleaseInput {
  hand: Side;
  /** Peak wrist speed, sw/s. */
  speed: number;
  /** Wrist x relative to the shoulder midpoint at release, sw, positive screen right. */
  lateral: number;
  /** Signed path curvature, 1/sw, positive curving toward screen right. */
  curvature: number;
}

export interface Release {
  /** m/s. */
  ballSpeed: number;
  /** Radians from straight down the lane, positive toward +x (screen right). */
  angle: number;
  /** Sideways acceleration in m/s^2 at full bite, positive toward +x. */
  hook: number;
  /** 0..1 position of the speed between the floor and the ceiling. */
  power: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function sideSign(hand: Side): number {
  return hand === 'right' ? 1 : -1;
}

/** Wrist speed to ball speed: linear between the floor and the ceiling, clamped. */
export function ballSpeedFor(speed: number, cfg: ReleaseConfig): number {
  const span = cfg.speedCeil - cfg.speedFloor;
  const power = span > 0 ? clamp((speed - cfg.speedFloor) / span, 0, 1) : 1;
  return cfg.minBallSpeed + (cfg.maxBallSpeed - cfg.minBallSpeed) * power;
}

/** Wrist x from the same-side shoulder to wrist x from the shoulder midline (sw, screen right). */
export function lateralFromWrist(wristX: number, hand: Side, cfg: ReleaseConfig): number {
  return wristX + sideSign(hand) * cfg.aimShoulderHalf;
}

/** Launch angle for a wrist lateral (sw from the midline). The indicator and the release share it. */
export function aimAngleFor(lateral: number, hand: Side, cfg: ReleaseConfig): number {
  return clamp(
    (lateral - sideSign(hand) * cfg.neutralLateral) * cfg.aimGain,
    -cfg.maxAngle,
    cfg.maxAngle,
  );
}

/** Exponential smoothing of the live aim lateral; frame-rate independent. */
export function smoothAim(current: number, target: number, dt: number, cfg: ReleaseConfig): number {
  return current + (target - current) * (1 - Math.exp(-cfg.aimSmooth * dt));
}

/** Map a ThrowReleased event to a launch. Never reads depth or `poseWorld`. */
export function mapRelease(input: ReleaseInput, cfg: ReleaseConfig): Release {
  const span = cfg.speedCeil - cfg.speedFloor;
  const power = span > 0 ? clamp((input.speed - cfg.speedFloor) / span, 0, 1) : 1;
  return {
    ballSpeed: cfg.minBallSpeed + (cfg.maxBallSpeed - cfg.minBallSpeed) * power,
    angle: aimAngleFor(input.lateral, input.hand, cfg),
    hook: clamp(input.curvature * cfg.hookGain, -cfg.maxHook, cfg.maxHook),
    power,
  };
}

/** Where the bowler wants to stand, metres, for a body offset in sw. */
export function targetBowlerX(lateral: number, cfg: ReleaseConfig): number {
  return clamp(lateral * cfg.lateralScale, -cfg.maxBowlerX, cfg.maxBowlerX);
}

/** Exponential smoothing toward the target; frame-rate independent. */
export function smoothBowlerX(
  current: number,
  lateral: number,
  dt: number,
  cfg: ReleaseConfig,
): number {
  const target = targetBowlerX(lateral, cfg);
  return current + (target - current) * (1 - Math.exp(-cfg.lateralSmooth * dt));
}
