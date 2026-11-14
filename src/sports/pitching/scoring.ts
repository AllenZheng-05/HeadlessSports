import type { PitchingConfig } from './config';
import type { PitchKind } from './aim';
import { adjacent, cellAt, distanceOutsideZone, isCorner } from './zone';

export type Tier = 'bullseye' | 'adjacent' | 'zone' | 'near' | 'wild' | 'balk';

export interface PitchScore {
  points: number;
  tier: Tier;
  /** The cell the ball crossed in, or -1. */
  cell: number;
  base: number;
  speedBonus: number;
  curveBonus: number;
  label: string;
}

/** Points for one pitch. Pure. `scoredKmh` is capped again here, so callers cannot exceed it. */
export function scorePitch(
  cfg: PitchingConfig,
  x: number,
  y: number,
  targetCell: number,
  kind: PitchKind,
  scoredKmh: number,
): PitchScore {
  const cell = cellAt(cfg, x, y);
  let base = 0;
  let tier: Tier = 'wild';
  if (cell >= 0) {
    if (cell === targetCell) {
      base = cfg.pointsExact;
      tier = 'bullseye';
    } else if (adjacent(targetCell, cell)) {
      base = cfg.pointsAdjacent;
      tier = 'adjacent';
    } else {
      base = cfg.pointsZone;
      tier = 'zone';
    }
  } else if (distanceOutsideZone(cfg, x, y) <= cfg.nearMiss) {
    base = cfg.pointsNear;
    tier = 'near';
  }
  let speedBonus = 0;
  if (base >= cfg.pointsZone) {
    const span = Math.max(1e-6, cfg.scoredSpeedCapKmh - cfg.minKmh);
    const kmh = Math.min(scoredKmh, cfg.scoredSpeedCapKmh);
    const u = Math.min(1, Math.max(0, (kmh - cfg.minKmh) / span));
    speedBonus = Math.round(cfg.speedBonusMax * u);
  }
  const painted = tier === 'bullseye' && kind === 'curve';
  const curveBonus = painted ? cfg.curveBonus : 0;
  const label =
    tier === 'bullseye'
      ? painted && isCorner(targetCell)
        ? 'Painted the corner'
        : 'Bullseye'
      : tier === 'adjacent'
        ? 'Strike'
        : tier === 'zone'
          ? 'In the zone'
          : tier === 'near'
            ? 'Just missed'
            : 'Wild';
  return {
    points: base + speedBonus + curveBonus,
    tier,
    cell,
    base,
    speedBonus,
    curveBonus,
    label,
  };
}

export const BALK_SCORE: PitchScore = {
  points: 0,
  tier: 'balk',
  cell: -1,
  base: 0,
  speedBonus: 0,
  curveBonus: 0,
  label: 'Balk',
};

/** A resolved pitch, kept for the round summary. */
export interface PitchRecord {
  index: number;
  kind: PitchKind;
  target: number;
  balk: boolean;
  /** Where it crossed the plate plane, m (0 for a balk). */
  x: number;
  y: number;
  kmh: number;
  score: PitchScore;
  /** Distance from the target cell centre, m. */
  missM: number;
}

export interface RoundSummary {
  score: number;
  pitches: number;
  strikes: number;
  bullseyes: number;
  balks: number;
  fastballs: number;
  curves: number;
  bestKmh: number;
  meanMissCm: number;
}

export function summarize(records: readonly PitchRecord[]): RoundSummary {
  const s: RoundSummary = {
    score: 0,
    pitches: records.length,
    strikes: 0,
    bullseyes: 0,
    balks: 0,
    fastballs: 0,
    curves: 0,
    bestKmh: 0,
    meanMissCm: 0,
  };
  let miss = 0;
  let thrown = 0;
  for (const r of records) {
    s.score += r.score.points;
    if (r.balk) {
      s.balks++;
      continue;
    }
    thrown++;
    miss += r.missM;
    if (r.score.cell >= 0) s.strikes++;
    if (r.score.tier === 'bullseye') s.bullseyes++;
    if (r.kind === 'fastball') s.fastballs++;
    else s.curves++;
    if (r.kmh > s.bestKmh) s.bestKmh = r.kmh;
  }
  s.meanMissCm = thrown > 0 ? Math.round((miss / thrown) * 100) : 0;
  s.bestKmh = Math.round(s.bestKmh);
  return s;
}
