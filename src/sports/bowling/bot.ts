import type { SportBot } from '../../core/sport';
import type { Side } from '../../input/types';
import type { ScriptStep } from '../../tracking/synthetic/script';
import { closeFist, idle, openFist, underarmSwing } from '../../tracking/synthetic/scripts/moves';
import type { BowlPhase } from './game';

export interface BotView {
  readonly phase: BowlPhase;
  /** Counts up on every pick-up and every launched ball, so the bot can tell a miss from a new turn. */
  readonly launches: number;
}

/**
 * Closed-loop bowler. It looks at the sport's phase, never at the clock: close the fist in
 * pickup, swing in aim, wait otherwise. If the swing did not launch the ball (the phase is still
 * aim when it is asked again) it pauses and swings again a little harder.
 */
export function createBowlingBot(
  view: BotView,
  hand: Side,
  random: () => number,
  aimBias = 0,
): SportBot {
  let pickupTries = 0;
  let swingTries = 0;
  let launchesAtSwing = -1;
  return {
    next(enqueue: (steps: ScriptStep[]) => void): void {
      const steps: ScriptStep[] = [];
      switch (view.phase) {
        case 'pickup': {
          swingTries = 0;
          if (pickupTries > 0) steps.push(...openFist(hand, 200), ...idle(200));
          pickupTries++;
          steps.push(...closeFist(hand), ...idle(300));
          break;
        }
        case 'aim': {
          pickupTries = 0;
          if (launchesAtSwing === view.launches) swingTries++;
          else swingTries = 0;
          launchesAtSwing = view.launches;
          if (swingTries > 0) steps.push(...idle(500));
          const power = Math.min(1, 0.75 + random() * 0.2 + swingTries * 0.08);
          const lateral = aimBias + (random() - 0.5) * 0.12;
          // A little path curve varies the hook, so leftover pins on the hooking side get hit too.
          const curve = -0.5 + random() * 0.6;
          steps.push(...underarmSwing(hand, { power, lateral, curve }), ...openFist(hand, 200));
          break;
        }
        default:
          steps.push(...idle(200));
      }
      enqueue(steps);
    },
  };
}
