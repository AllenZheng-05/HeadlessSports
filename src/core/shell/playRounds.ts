import type { Calibration } from '../../input/types';
import type { Ui } from '../../ui/types';
import { MULTI_DONE } from '../multiplayer/result';
import { rankResults, winnerLine } from '../multiplayer/ranking';
import type { ScoreStore } from '../scores';
import type { SportEntry } from '../sport';
import { TUTORIAL_DONE } from '../tutorial/result';
import type { MultiplayerSetup, SportHost } from './SportHost';
import type { GameHook } from './hook';
import { recordRound } from './recordRound';

export interface RoundsDeps {
  host: Pick<SportHost, 'play' | 'lastRoundFailed' | 'multiResults'>;
  ui: Pick<Ui, 'showResults' | 'showTutorialDone' | 'showMultiResults'>;
  scores: ScoreStore;
  hook: Pick<GameHook, 'phase' | 'result' | 'isBest' | 'tutorial' | 'ranking'>;
  /** False once the flow has been restarted (camera switched off): the chain stops quietly. */
  isCurrent(): boolean;
}

/** How a run of rounds ended. 'change' is "Change players" on the pass-and-play results. */
export type RoundsEnd = 'menu' | 'failed' | 'stale' | 'change';

/**
 * Play rounds of one sport until the player goes back to the menu. The calibration is measured
 * once, before the first round; "Play again" and "Play now" (after a tutorial) reuse it. A
 * tutorial is never recorded: no score is stored and no personal best is claimed.
 *
 * With `multi` (2 or more seats) the rounds are pass-and-play games: "Play again" keeps the same
 * players and their calibrations, "Change players" ends the run so the shell can ask for names
 * again, and nothing is ever saved: no score, no personal best.
 */
export async function playRounds(
  deps: RoundsDeps,
  entry: SportEntry,
  calibration: Calibration | null,
  tutorial: boolean,
  multi?: MultiplayerSetup,
): Promise<RoundsEnd> {
  const { host, ui, scores, hook } = deps;
  const meta = entry.meta;
  let wantTutorial = tutorial && meta.hasTutorial === true;
  for (;;) {
    hook.phase = 'loading';
    hook.result = null;
    hook.isBest = null;
    hook.ranking = null;
    hook.tutorial = wantTutorial;
    const result = await host.play(
      entry,
      calibration,
      multi !== undefined && !wantTutorial
        ? { tutorial: false, multiplayer: multi }
        : { tutorial: wantTutorial },
    );
    if (!deps.isCurrent()) return 'stale';
    if (result === null) return host.lastRoundFailed ? 'failed' : 'menu';
    if (result === MULTI_DONE) {
      const results = host.multiResults;
      if (multi === undefined || results === null) return 'menu';
      const rows = rankResults(multi.players, results, meta.score.higherIsBetter);
      hook.ranking = rows.map((r) => ({
        rank: r.rank,
        name: r.player.name,
        score: r.result.score,
        headline: r.result.headline,
      }));
      hook.phase = 'results';
      const next = await ui.showMultiResults(meta, rows, winnerLine(rows));
      if (!deps.isCurrent()) return 'stale';
      if (next === 'menu') return 'menu';
      if (next === 'change') return 'change';
      continue;
    }
    if (result === TUTORIAL_DONE) {
      hook.phase = 'tutorial-done';
      const next = await ui.showTutorialDone(meta);
      if (!deps.isCurrent()) return 'stale';
      if (next === 'menu') return 'menu';
      wantTutorial = false;
      continue;
    }
    const { isBest, best } = await recordRound(scores, meta, result);
    hook.result = result;
    hook.isBest = isBest;
    hook.phase = 'results';
    const next = await ui.showResults(meta, result, { isBest, best });
    if (!deps.isCurrent()) return 'stale';
    if (next === 'menu') return 'menu';
    wantTutorial = false;
  }
}
