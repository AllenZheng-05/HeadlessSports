import type { ScoreStore } from '../scores';
import type { RoundResult, SportMeta } from '../sport';

export interface RecordedRound {
  isBest: boolean;
  /** Personal best after this round, or null when there is none yet. */
  best: number | null;
}

/**
 * Store a finished round and report whether it is a new best. A result with `saveScore: false`
 * is shown but not stored and never claims a best; `best` is then the existing one.
 */
export async function recordRound(
  scores: ScoreStore,
  meta: SportMeta,
  result: RoundResult,
  at: string = new Date().toISOString(),
): Promise<RecordedRound> {
  const higher = meta.score.higherIsBetter;
  if (result.saveScore === false) {
    const best = await scores.best(meta.id, higher);
    return { isBest: false, best: best === null ? null : best.score };
  }
  const saved = await scores.add(
    { sportId: meta.id, score: result.score, at, detail: result.detail },
    higher,
  );
  return { isBest: saved.isBest, best: saved.best.score };
}
