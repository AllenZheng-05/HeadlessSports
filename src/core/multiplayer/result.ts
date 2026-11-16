import type { RoundResult } from '../sport';

/**
 * What `SportHost.play` resolves with when a multiplayer game finishes. The per-seat results are on
 * `host.multiResults`. Like `TUTORIAL_DONE` it is recognised by identity and never stored.
 */
export const MULTI_DONE: RoundResult = Object.freeze({
  score: 0,
  headline: 'Game over',
  saveScore: false,
});
