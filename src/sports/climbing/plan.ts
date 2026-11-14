import type { ClimbingConfig } from './config';
import { KIND_CRIMP } from './layout';
import type { Layout } from './layout';

/** Where a free hand would like its next hold, relative to the shoulders, metres. */
const IDEAL_REL_Y = 0.65;
const IDEAL_REL_X = 0.3;

/**
 * Choose the next hold for a hand: above the shoulders, on the hand's own side, preferring jugs.
 * `cx, cy` is the climber's (shoulder) position the hand will reach from. Returns an index or -1.
 * Used by the synthetic player and by the browser tests.
 */
export function chooseHold(
  layout: Layout,
  cfg: Pick<ClimbingConfig, 'reachWidth' | 'reachHeight' | 'reachOffsetY'>,
  cx: number,
  cy: number,
  side: 0 | 1,
  avoid: number,
): number {
  layout.ensure(cy + 4);
  const sign = side === 1 ? 1 : -1;
  const halfX = cfg.reachWidth / 2 - 0.12;
  const topRel = cfg.reachHeight / 2 + cfg.reachOffsetY - 0.12;
  for (let pass = 0; pass < 2; pass++) {
    const minRel = pass === 0 ? 0.3 : 0.05;
    const maxRel = Math.min(pass === 0 ? 0.85 : 1.0, topRel);
    const r0 = layout.rowOf(cy + minRel - 0.35);
    const r1 = Math.min(layout.rows, layout.rowOf(cy + maxRel) + 1);
    let best = -1;
    let bestScore = Infinity;
    for (let i = layout.rowStart[r0]!; i < layout.rowStart[r1]!; i++) {
      if (i === avoid) continue;
      const relX = layout.xs[i]! - cx;
      const relY = layout.ys[i]! - cy;
      if (relY < minRel || relY > maxRel || Math.abs(relX) > halfX) continue;
      if (pass === 0 && relX * sign < -0.1) continue;
      let score = Math.abs(relY - IDEAL_REL_Y) + 0.6 * Math.abs(relX - sign * IDEAL_REL_X);
      if (layout.kinds[i] === KIND_CRIMP) score += 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}
