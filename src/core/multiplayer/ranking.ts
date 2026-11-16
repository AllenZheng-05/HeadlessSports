import type { PlayerInfo, RoundResult } from '../sport';

export interface RankedRow {
  /** 1 for the winner; tied scores share a rank and the next rank skips (1, 1, 3). */
  rank: number;
  player: PlayerInfo;
  result: RoundResult;
}

/**
 * Rank one result per seat. Best first; ties keep seat order and share a rank. `higherIsBetter`
 * comes from `meta.score`. Pure.
 */
export function rankResults(
  players: readonly PlayerInfo[],
  results: readonly RoundResult[],
  higherIsBetter: boolean,
): RankedRow[] {
  const rows: RankedRow[] = [];
  for (const player of players) {
    const result = results[player.index];
    if (result !== undefined) rows.push({ rank: 0, player, result });
  }
  rows.sort((a, b) => {
    const d = higherIsBetter ? b.result.score - a.result.score : a.result.score - b.result.score;
    return d !== 0 ? d : a.player.index - b.player.index;
  });
  let rank = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const prev = rows[i - 1];
    rank = prev !== undefined && prev.result.score === row.result.score ? rank : i + 1;
    row.rank = rank;
  }
  return rows;
}

/** "Mia wins", or "It's a tie" when more than one seat shares first place. */
export function winnerLine(rows: readonly RankedRow[]): string {
  const first = rows.filter((r) => r.rank === 1);
  if (first.length === 1) return `${first[0]!.player.name} wins`;
  return "It's a tie";
}

/** Fallback for a sport that calls `finish` in a multiplayer game: one real result, the rest blank. */
export function singleResultFallback(
  count: number,
  seat: number,
  result: RoundResult,
): RoundResult[] {
  const out: RoundResult[] = [];
  for (let i = 0; i < count; i++) {
    out.push(i === seat ? result : { score: 0, headline: '-', saveScore: false });
  }
  return out;
}
