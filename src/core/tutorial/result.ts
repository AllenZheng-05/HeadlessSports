import type { RoundResult } from '../sport';

/**
 * What `SportHost.play` resolves with when a tutorial finishes (the last step, "End tutorial", or
 * a sport that calls `finish()` by mistake). It is never stored: `saveScore` is false and the
 * shell recognises it by identity, so no score or personal best can come out of a tutorial.
 */
export const TUTORIAL_DONE: RoundResult = Object.freeze({
  score: 0,
  headline: 'Tutorial done',
  saveScore: false,
});
