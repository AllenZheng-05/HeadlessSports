import type { JavelinConfig } from './config';

export type DistanceCfg = Pick<
  JavelinConfig,
  | 'baseSpeed'
  | 'runGain'
  | 'maxRunSpeed'
  | 'throwGain'
  | 'throwFloor'
  | 'throwCeil'
  | 'minAngle'
  | 'maxAngle'
  | 'angleCurve'
  | 'proxyLow'
  | 'proxyHigh'
  | 'releaseHeight'
  | 'gravity'
  | 'gravityScale'
  | 'effCenter'
  | 'effK'
>;

const DEG = Math.PI / 180;

const saturate = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 0..1 (a little over at the soft-capped top) from the approach speed. */
export function runFraction(cfg: DistanceCfg, runSpeed: number): number {
  return Math.max(0, Math.min(1.15, runSpeed / cfg.maxRunSpeed));
}

/** 0..1 from the wrist speed at the release. */
export function armPower(cfg: DistanceCfg, throwSpeed: number): number {
  const span = Math.max(1e-6, cfg.throwCeil - cfg.throwFloor);
  return saturate((throwSpeed - cfg.throwFloor) / span);
}

/**
 * Javelin speed off the hand, m/s, before the angle efficiency:
 * `baseSpeed + runGain * runFraction + throwGain * armPower`. With the default constants the run
 * is 8.5 of the 23.5 m/s that vary between a standing, feeble throw and a flat-out best throw
 * (about 36 percent), the arm the other 64.
 */
export function releaseSpeed(cfg: DistanceCfg, runSpeed: number, throwSpeed: number): number {
  return (
    cfg.baseSpeed +
    cfg.runGain * runFraction(cfg, runSpeed) +
    cfg.throwGain * armPower(cfg, throwSpeed)
  );
}

/**
 * Release angle in degrees from the 2D release direction. A player facing the camera throws INTO
 * the screen, so the image path cannot give a true loft: `vy / speed` (vy positive up) is only a
 * proxy for how upward the release was. It is mapped from [proxyLow, proxyHigh] onto
 * [minAngle, maxAngle]. This is a proxy to be tuned by playtest; the result line shows the angle
 * the game read so the owner can see it.
 */
export function releaseAngleDeg(cfg: DistanceCfg, vy: number, speed: number): number {
  const s = vy / Math.max(speed, 1e-3);
  const span = Math.max(1e-6, cfg.proxyHigh - cfg.proxyLow);
  const up = Math.pow(saturate((s - cfg.proxyLow) / span), cfg.angleCurve);
  return cfg.minAngle + (cfg.maxAngle - cfg.minAngle) * up;
}

/** Throwing steeper or flatter than the natural angle costs speed. */
export function efficiency(cfg: DistanceCfg, angleDeg: number): number {
  const d = angleDeg - cfg.effCenter;
  return Math.max(0.2, 1 - cfg.effK * d * d);
}

function effGravity(cfg: DistanceCfg): number {
  return cfg.gravity * cfg.gravityScale;
}

/** Time from release to landing, s (analytic). */
export function flightTime(cfg: DistanceCfg, v: number, angleDeg: number): number {
  const sp = v * efficiency(cfg, angleDeg);
  const vy = sp * Math.sin(angleDeg * DEG);
  const g = effGravity(cfg);
  return (vy + Math.sqrt(vy * vy + 2 * g * cfg.releaseHeight)) / g;
}

/** Horizontal distance from the release point to the landing point, m (analytic). */
export function flightRange(cfg: DistanceCfg, v: number, angleDeg: number): number {
  const sp = v * efficiency(cfg, angleDeg);
  return sp * Math.cos(angleDeg * DEG) * flightTime(cfg, v, angleDeg);
}

export interface Flight {
  /** Absolute position along the runway, m. */
  x: number;
  /** Height above the turf, m. */
  y: number;
  vx: number;
  vy: number;
  /** Seconds in the air. */
  t: number;
  landed: boolean;
}

export function createFlight(): Flight {
  return { x: 0, y: 0, vx: 0, vy: 0, t: 0, landed: true };
}

/** Launch from release point `x0` at the model's release height. */
export function startFlight(
  f: Flight,
  cfg: DistanceCfg,
  x0: number,
  v: number,
  angleDeg: number,
): void {
  const sp = v * efficiency(cfg, angleDeg);
  f.x = x0;
  f.y = cfg.releaseHeight;
  f.vx = sp * Math.cos(angleDeg * DEG);
  f.vy = sp * Math.sin(angleDeg * DEG);
  f.t = 0;
  f.landed = false;
}

/** A low toss (a javelin dropped at the line). */
export function startDrop(f: Flight, x0: number, y0: number, vx: number): void {
  f.x = x0;
  f.y = y0;
  f.vx = vx;
  f.vy = 0;
  f.t = 0;
  f.landed = false;
}

/**
 * Advance the flight by `dt`. Constant gravity is integrated exactly, so any step size agrees
 * with `flightRange`; the landing is placed inside the step.
 */
export function stepFlight(f: Flight, cfg: DistanceCfg, dt: number): void {
  if (f.landed) return;
  const g = effGravity(cfg);
  const hit = (f.vy + Math.sqrt(Math.max(0, f.vy * f.vy + 2 * g * f.y))) / g;
  if (hit <= dt) {
    f.x += f.vx * hit;
    f.vy -= g * hit;
    f.y = 0;
    f.t += hit;
    f.landed = true;
    return;
  }
  f.x += f.vx * dt;
  f.y += f.vy * dt - 0.5 * g * dt * dt;
  f.vy -= g * dt;
  f.t += dt;
}

/** Pitch of the javelin along its velocity, radians (positive nose up). */
export function flightPitch(f: Flight): number {
  return Math.atan2(f.vy, Math.max(1e-6, Math.abs(f.vx)));
}
