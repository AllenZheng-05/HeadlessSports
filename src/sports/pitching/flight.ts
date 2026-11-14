import type { PitchingConfig } from './config';

/** Seconds the ball takes from the hand to the plate. Faster pitches arrive sooner. */
export function flightSeconds(cfg: PitchingConfig, kmh: number): number {
  const ms = Math.max(5, kmh) / 3.6;
  return (cfg.plateDistance / ms) * cfg.flightTimeScale;
}

/**
 * Latency compensation: `eventT` is when the ball left the hand and the event arrives later.
 * Returns how far along the flight the ball already is (0 to maxLatencyFraction), so the ball is
 * never about to arrive the moment it appears.
 */
export function latencyProgress(
  cfg: PitchingConfig,
  nowMs: number,
  eventT: number,
  flightMs: number,
): number {
  const elapsed = Math.max(0, nowMs - eventT);
  const u = elapsed / Math.max(1, flightMs);
  return Math.min(Math.max(0, cfg.maxLatencyFraction), u);
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const smooth = (v: number): number => {
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return c * c * (3 - 2 * c);
};

/**
 * Ball position at flight progress `u` (0 to 1) from `from` to `to`. A curveball floats on a line
 * shifted by (-breakX, -breakY) (up and toward the throwing side) and drops onto `to` over the
 * last part of the flight. The shift is zero at both ends, so the ball leaves the hand and
 * arrives at the plate exactly.
 */
export function ballAt(
  cfg: PitchingConfig,
  from: Vec3,
  to: Vec3,
  u: number,
  curve: boolean,
  breakX: number,
  breakY: number,
  out: Vec3,
): Vec3 {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  out.x = from.x + (to.x - from.x) * c;
  out.y = from.y + (to.y - from.y) * c + 0.12 * 4 * c * (1 - c);
  out.z = from.z + (to.z - from.z) * c;
  if (curve) {
    const hold = 1 - smooth((c - cfg.curveBreakFrom) / Math.max(1e-6, 1 - cfg.curveBreakFrom));
    const k = c * hold;
    out.x -= breakX * k;
    out.y -= breakY * k;
  }
  return out;
}
