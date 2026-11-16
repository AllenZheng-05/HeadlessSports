import type { Calibration } from '../../input/types';
import type { Ui } from '../../ui/types';
import type { ScoreStore } from '../scores';
import type { SportEntry } from '../sport';
import { TUTORIAL_DONE } from '../tutorial/result';
import type { SportHost } from './SportHost';
import type { GameHook } from './hook';
import { recordRound } from './recordRound';

export interface RoundsDeps {
  host: Pick<SportHost, 'play' | 'lastRoundFailed'>;
  ui: Pick<Ui, 'showResults' | 'showTutorialDone'>;
  scores: ScoreStore;
  hook: Pick<GameHook, 'phase' | 'result' | 'isBest' | 'tutorial'>;
  /** False once the flow has been restarted (camera switched off): the chain stops quietly. */
  isCurrent(): boolean;
}

/** How a run of rounds ended. */
export type RoundsEnd = 'menu' | 'failed' | 'stale';

/**
 * Play rounds of one sport until the player goes back to the menu. The calibration is measured
 * once, before the first round; "Play again" and "Play now" (after a tutorial) reuse it. A
 * tutorial is never recorded: no score is stored and no personal best is claimed.
 */
export async function playRounds(
  deps: RoundsDeps,
  entry: SportEntry,
  calibration: Calibration | null,
  tutorial: boolean,
): Promise<RoundsEnd> {
  const { host, ui, scores, hook } = deps;
  const meta = entry.meta;
  let wantTutorial = tutorial && meta.hasTutorial === true;
  for (;;) {
    hook.phase = 'loading';
    hook.result = null;
    hook.isBest = null;
    hook.tutorial = wantTutorial;
    const result = await host.play(entry, calibration, { tutorial: wantTutorial });
    if (!deps.isCurrent()) return 'stale';
    if (result === null) return host.lastRoundFailed ? 'failed' : 'menu';
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
