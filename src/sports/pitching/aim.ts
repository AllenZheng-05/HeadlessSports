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
 * The shared tail of every aim: the sideways position and height offset become a pitch location
 * (with the curveball break and the zone assist). The release and the live indicator both end
 * here, so they cannot disagree.
 */
export function placeAim(
  cfg: PitchingConfig,
  hand: Side,
  kind: PitchKind,
  targetCell: number,
  lateral: number,
  yOffset: number,
  speed: number,
  curvature: number,
  out: Aim,
  scratch: Point,
): Aim {
  const s = sideSign(hand);
  let x = clamp((lateral - s * cfg.neutralLateral) * cfg.aimGainX, -cfg.maxMiss, cfg.maxMiss);
  let y = cfg.zoneCentreY + yOffset;
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
 * Where a pitch crosses the plate plane, from the release event and the called cell. `debug`
 * selects the proxy range for mouse throws. Positive x is screen right. No depth.
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
  const proxy = e.vy / Math.max(e.speed, 1e-3);
  return placeAim(
    cfg,
    hand,
    kind,
    targetCell,
    e.lateral,
    heightOffset(cfg, proxy, debug),
    e.speed,
    e.curvature,
    out,
    scratch,
  );
}

/** What the live aim reads each tracking frame. Filled in place. */
export interface LiveInput {
  /** Wrist x relative to the shoulder midpoint, sw (the same quantity as a release's `lateral`). */
  lateral: number;
  /** Height offset from the zone centre, m. */
  yOffset: number;
  /** Wrist speed, sw/s. */
  speed: number;
}

export function createLiveInput(): LiveInput {
  return { lateral: 0, yOffset: 0, speed: 0 };
}

/**
 * The throwing arm now. Sideways is the release formula exactly. Height blends from where the
 * wrist is held (while slow) to the release proxy vy / speed as the arm speeds up, and is the
 * release proxy alone at throw speed, so at the moment of release the live aim and the release aim
 * are the same number.
 */
export function trackedLive(
  cfg: PitchingConfig,
  arm: { wristX: number; wristY: number; vy: number; speed: number },
  hand: Side,
  out: LiveInput,
): LiveInput {
  const s = sideSign(hand);
  out.lateral = arm.wristX + s * 0.5;
  out.speed = arm.speed;
  const span = Math.max(1e-6, cfg.holdAimHigh - cfg.holdAimLow);
  const u = clamp((arm.wristY - cfg.holdAimLow) / span, 0, 1);
  const held = (u * 2 - 1) * cfg.heightRange;
  const moving = heightOffset(cfg, arm.vy / Math.max(arm.speed, 1e-3), false);
  const w = clamp(
    (arm.speed - cfg.blendSpeedLow) / Math.max(1e-6, cfg.minThrowSpeed - cfg.blendSpeedLow),
    0,
    1,
  );
  out.yOffset = held + (moving - held) * w;
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
