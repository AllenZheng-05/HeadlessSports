import type { Side } from '../../input/types';
import type { PitchingConfig } from './config';
import { cellCentre } from './zone';
import type { Point } from './zone';

export type PitchKind = 'fastball' | 'curve';

/** The parts of a ThrowReleased event the aim uses. */
export interface ThrowSample {
  speed: number;
  vy: number;
  lateral: number;
  curvature: number;
}

export interface Aim {
  /** Where the throw was aimed before the zone assist, m. */
  rawX: number;
  rawY: number;
  /** The scored location, m. */
  x: number;
  y: number;
  kmh: number;
  /** Speed that counts for scoring, km/h (capped). */
  scoredKmh: number;
}

export function createAim(): Aim {
  return { rawX: 0, rawY: 0, x: 0, y: 0, kmh: 0, scoredKmh: 0 };
}

/** +1 when the hand is on the screen-right side of the body. */
export const sideSign = (hand: Side): number => (hand === 'right' ? 1 : -1);

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Pitch speed shown on screen, km/h, before the curveball factor. */
export function baseKmh(cfg: PitchingConfig, speed: number): number {
  const u = clamp((speed - cfg.speedFloor) / Math.max(1e-6, cfg.speedCeil - cfg.speedFloor), 0, 1);
  return cfg.minKmh + (cfg.maxKmh - cfg.minKmh) * u;
}

/** Height offset from the zone centre for a release proxy s = vy / speed, m. */
export function heightOffset(cfg: PitchingConfig, proxy: number, debug: boolean): number {
  const lo = debug ? cfg.debugProxyLow : cfg.proxyLow;
  const hi = debug ? cfg.debugProxyHigh : cfg.proxyHigh;
  const u = clamp((proxy - lo) / Math.max(1e-6, hi - lo), 0, 1);
  return (u * 2 - 1) * cfg.heightRange;
}

/**
 * Where a pitch crosses the plate plane, from the release event and the lit cell. `debug` selects
 * the proxy range for keyboard-and-mouse throws. Positive x is screen right. No depth is used.
 */
export function aimPitch(
  cfg: PitchingConfig,
  e: ThrowSample,
  hand: Side,
  kind: PitchKind,
  targetCell: number,
  debug: boolean,
  out: Aim,
  scratch: Point,
): Aim {
  const s = sideSign(hand);
  let x = clamp((e.lateral - s * cfg.neutralLateral) * cfg.aimGainX, -cfg.maxMiss, cfg.maxMiss);
  const proxy = e.vy / Math.max(e.speed, 1e-3);
  let y = cfg.zoneCentreY + heightOffset(cfg, proxy, debug);
  let kmh = baseKmh(cfg, e.speed);
  if (kind === 'curve') {
    // Down, and toward the glove side: away from the throwing hand.
    y -= cfg.curveDrop;
    x -= s * cfg.curveSide;
    x += e.curvature * cfg.curvatureGain;
    kmh *= cfg.curveSpeedFactor;
  }
  cellCentre(cfg, targetCell, scratch);
  out.rawX = x;
  out.rawY = y;
  out.x = x + (scratch.x - x) * cfg.assist;
  out.y = y + (scratch.y - y) * cfg.assist;
  out.kmh = kmh;
  out.scoredKmh = Math.min(kmh, cfg.scoredSpeedCapKmh);
  return out;
}
