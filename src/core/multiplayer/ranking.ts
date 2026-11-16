import type { PlayerInfo, RoundResult } from '../sport';
import { displayNames } from './players';

export interface RankedRow {
  /**
   * 1 for the winner; tied seats share a rank and the next rank skips (1, 1, 3). 0 for an
   * unranked seat (see `unranked`): show a dash.
   */
  rank: number;
  player: PlayerInfo;
  result: RoundResult;
  /** The seat produced no result: listed last, never the winner. */
  unranked?: boolean;
}

/** What a seat that produced nothing looks like to the ranking and the results table. */
export function blankResult(): RoundResult {
  return { score: 0, headline: '-', saveScore: false, unranked: true };
}

function sameStanding(a: RoundResult, b: RoundResult): boolean {
  return (
    a.score === b.score &&
    (a.tieBreak ?? Number.NEGATIVE_INFINITY) === (b.tieBreak ?? Number.NEGATIVE_INFINITY)
  );
}

/**
 * Rank one result per seat. Best first: by score (`higherIsBetter` comes from `meta.score`), then,
 * for equal scores, by the larger `tieBreak`. Seats that tie on both share a rank and keep seat
 * order. Seats with no result (missing from `results`, or marked `unranked`) come last in seat
 * order with rank 0. Pure.
 */
export function rankResults(
  players: readonly PlayerInfo[],
  results: readonly RoundResult[],
  higherIsBetter: boolean,
): RankedRow[] {
  const ranked: RankedRow[] = [];
  const unranked: RankedRow[] = [];
  for (const player of players) {
    const result = results[player.index];
    if (result === undefined)
      unranked.push({ rank: 0, player, result: blankResult(), unranked: true });
    else if (result.unranked === true) unranked.push({ rank: 0, player, result, unranked: true });
    else ranked.push({ rank: 0, player, result });
  }
  ranked.sort((a, b) => {
    const d = higherIsBetter ? b.result.score - a.result.score : a.result.score - b.result.score;
    if (d !== 0) return d;
    const t =
      (b.result.tieBreak ?? Number.NEGATIVE_INFINITY) -
      (a.result.tieBreak ?? Number.NEGATIVE_INFINITY);
    // Two absent tie-breaks give NaN (-inf minus -inf): equal.
    if (t !== 0 && !Number.isNaN(t)) return t;
    return a.player.index - b.player.index;
  });
  let rank = 0;
  for (let i = 0; i < ranked.length; i++) {
    const row = ranked[i] as RankedRow;
    const prev = ranked[i - 1];
    rank = prev !== undefined && sameStanding(prev.result, row.result) ? rank : i + 1;
    row.rank = rank;
  }
  return ranked.concat(unranked);
}

/**
 * "Mia wins", "It's a tie" when more than one ranked seat shares first place (that includes
 * everyone tying), or "No winner" when no seat has a result. Duplicate names carry their colour:
 * "Mia (blue) wins".
 */
export function winnerLine(rows: readonly RankedRow[]): string {
  const names = displayNames(rows.map((r) => r.player));
  let winner = '';
  let count = 0;
  rows.forEach((r, i) => {
    if (r.rank === 1 && r.unranked !== true) {
      count++;
      winner = names[i] as string;
    }
  });
  if (count === 0) return 'No winner';
  if (count === 1) return `${winner} wins`;
  return "It's a tie";
}

/** Fallback for a sport that calls `finish` in a multiplayer game: one real result, the rest unranked. */
export function singleResultFallback(
  count: number,
  seat: number,
  result: RoundResult,
): RoundResult[] {
  const out: RoundResult[] = [];
  for (let i = 0; i < count; i++) out.push(i === seat ? result : blankResult());
  return out;
}
