import type { BattingConfig } from './config';

export type Difficulty = 'easy' | 'medium' | 'hard';

/** One pitch. Every time is game ms on the one shared timeline. */
export interface Pitch {
  /** 1-based number within the round. */
  index: number;
  difficulty: Difficulty;
  /** 0 low, 1 middle, 2 high. */
  band: number;
  windupStartMs: number;
  releaseMs: number;
  /** When the ball crosses the front of the plate. Known from the moment the pitch is planned. */
  arrivalMs: number;
  flightMs: number;
  /** Release point (metres). Updated at release when the pitcher's real hand position is sampled. */
  rx: number;
  ry: number;
  rz: number;
  /** Where the ball crosses the plate: lateral x, height y, depth z. */
  tx: number;
  ty: number;
  tz: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Bulge of the arc above the straight line, metres (the ball is thrown, not fired). */
export const PITCH_ARC_M = 0.22;

export function difficultyFor(index: number, cfg: BattingConfig): Difficulty {
  if (index <= cfg.easyUntil) return 'easy';
  if (index <= cfg.mediumUntil) return 'medium';
  return 'hard';
}

export function flightMsFor(difficulty: Difficulty, cfg: BattingConfig): number {
  if (difficulty === 'easy') return cfg.flightEasyMs;
  if (difficulty === 'medium') return cfg.flightMediumMs;
  return cfg.flightHardMs;
}

export function bandHeight(band: number, cfg: BattingConfig): number {
  if (band <= 0) return cfg.heightLow;
  if (band === 1) return cfg.heightMiddle;
  return cfg.heightHigh;
}

/**
 * Plan a pitch whose wind-up starts at `windupStartMs`. The release and arrival times follow
 * immediately, so the arrival is known before the ball leaves the pitcher's hand.
 * Uses two draws from `random`: the height band and the lateral wobble.
 */
export function planPitch(
  index: number,
  windupStartMs: number,
  random: () => number,
  cfg: BattingConfig,
): Pitch {
  const difficulty = difficultyFor(index, cfg);
  const flightMs = flightMsFor(difficulty, cfg);
  const band = Math.min(2, Math.floor(random() * 3));
  const wobble = (random() * 2 - 1) * cfg.lateralWobble;
  const releaseMs = windupStartMs + cfg.windupMs;
  return {
    index,
    difficulty,
    band,
    windupStartMs,
    releaseMs,
    arrivalMs: releaseMs + flightMs,
    flightMs,
    rx: cfg.releaseX,
    ry: cfg.releaseY,
    rz: cfg.releaseZ,
    tx: wobble,
    ty: bandHeight(band, cfg),
    tz: cfg.plateZ,
  };
}

/** Pitched ball position at game time `tMs` (clamped to start at the release point). No allocation. */
export function ballPosition(p: Pitch, tMs: number, out: Vec3): void {
  let f = (tMs - p.releaseMs) / p.flightMs;
  if (f < 0) f = 0;
  out.x = p.rx + (p.tx - p.rx) * f;
  out.z = p.rz + (p.tz - p.rz) * f;
  // The arc term is zero at f = 0 and f = 1, so the ball is exactly at the target on arrival.
  out.y = p.ry + (p.ty - p.ry) * f + 4 * PITCH_ARC_M * f * (1 - f);
}
