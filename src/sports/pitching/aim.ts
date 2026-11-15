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

/** The throwing arm's small correction on top of the locked aim, m. Positive x is screen right. */
export function steerOffset(
  cfg: PitchingConfig,
  e: ThrowSample,
  hand: Side,
  debug: boolean,
  out: Point,
): Point {
  const s = sideSign(hand);
  const proxy = e.vy / Math.max(e.speed, 1e-3);
  out.x = clamp(
    (e.lateral - s * cfg.neutralLateral) * cfg.steerGainX,
    -cfg.steerMaxX,
    cfg.steerMaxX,
  );
  out.y = clamp(heightOffset(cfg, proxy, debug) * cfg.steerGainY, -cfg.steerMaxY, cfg.steerMaxY);
  return out;
}

/**
 * The shared tail of every aim: a base point on the plate plane (the glove's aim, m) becomes a pitch
 * location (with the curveball break and the zone assist). The live ring and the no-ring fallback
 * both end here, so they cannot disagree.
 */
export function placeAim(
  cfg: PitchingConfig,
  hand: Side,
  kind: PitchKind,
  targetCell: number,
  baseX: number,
  baseY: number,
  speed: number,
  curvature: number,
  out: Aim,
  scratch: Point,
): Aim {
  const s = sideSign(hand);
  let x = clamp(baseX, -cfg.maxMiss, cfg.maxMiss);
  let y = baseY;
  let kmh = baseKmh(cfg, speed);
  if (kind === 'curve') {
    // Down, and toward the glove side: away from the throwing hand.
    y -= cfg.curveDrop;
    x -= s * cfg.curveSide;
    x += curvature * cfg.curvatureGain;
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

/**
 * Where a pitch crosses the plate plane when there is no ring to read (the glove was never seen at
 * all): the middle of the zone plus the throwing arm's steering. `debug` selects the proxy range
 * for mouse throws. Positive x is screen right. No depth.
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
  steerOffset(cfg, e, hand, debug, scratch);
  const sx = scratch.x;
  const sy = scratch.y;
  return placeAim(
    cfg,
    hand,
    kind,
    targetCell,
    sx,
    cfg.zoneCentreY + sy,
    e.speed,
    e.curvature,
    out,
    scratch,
  );
}

/** The glove hand is the side opposite the throwing hand. */
export const gloveSide = (hand: Side): Side => (hand === 'right' ? 'left' : 'right');

/** What the live aim reads each tracking frame. Filled in place. */
export interface LiveInput {
  /** Where the glove hand points on the plate plane, m (before the curve break and the assist). */
  baseX: number;
  baseY: number;
  /** The glove wrist is tracked right now. */
  gloveTracked: boolean;
  /** Throwing wrist speed, sw/s. */
  speed: number;
}

export function createLiveInput(): LiveInput {
  return { baseX: 0, baseY: 0, gloveTracked: false, speed: 0 };
}

/**
 * The glove hand to an aim point. `wristX` / `wristY` are the glove wrist relative to its own
 * shoulder (sw, x toward screen right, y up: the `ArmState` convention). The neutral point is the
 * hand in front of the chest; moving it right, left, up or down moves the aim the same way on
 * screen, for either handedness.
 */
export function gloveAim(
  cfg: PitchingConfig,
  hand: Side,
  wristX: number,
  wristY: number,
  out: Point,
): Point {
  const g = sideSign(gloveSide(hand));
  // Relative to the shoulder midpoint: the glove-side shoulder is half a shoulder width out.
  const lateral = wristX + g * 0.5;
  out.x = clamp((lateral - g * cfg.gloveNeutralX) * cfg.gloveGainX, -cfg.maxMiss, cfg.maxMiss);
  out.y =
    cfg.zoneCentreY +
    clamp((wristY - cfg.gloveNeutralY) * cfg.gloveGainY, -cfg.heightRange, cfg.heightRange);
  return out;
}

/** Fill the live input from the glove arm and the throwing arm's speed. */
export function trackedLive(
  cfg: PitchingConfig,
  glove: { wristX: number; wristY: number },
  throwSpeed: number,
  hand: Side,
  gloveTracked: boolean,
  out: LiveInput,
  scratch: Point,
): LiveInput {
  gloveAim(cfg, hand, glove.wristX, glove.wristY, scratch);
  out.baseX = scratch.x;
  out.baseY = scratch.y;
  out.gloveTracked = gloveTracked;
  out.speed = throwSpeed;
  return out;
}

/**
 * Mouse play: a point on the drawn zone plane (world m) as a scored location, limited to the
 * range a tracked arm can reach. The ring sits under the cursor and the pitch goes there.
 */
export function pointedAim(cfg: PitchingConfig, worldX: number, worldY: number, out: Point): Point {
  out.x = clamp(worldX / cfg.zoneVisualScale, -cfg.maxMiss, cfg.maxMiss);
  out.y = clamp(
    cfg.zoneCentreY + (worldY - cfg.zoneDrawCentreY) / cfg.zoneVisualScale,
    cfg.zoneCentreY - cfg.heightRange,
    cfg.zoneCentreY + cfg.heightRange,
  );
  return out;
}

/** The pitch speed of a mouse throw (wrist speed, sw/s): fixed per pitch type. */
export const mouseThrowSpeed = (cfg: PitchingConfig, kind: PitchKind): number =>
  kind === 'curve' ? cfg.mouseCurveSpeed : cfg.mouseFastballSpeed;
