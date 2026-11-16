import type { SportBot } from '../../core/sport';
import type { Side } from '../../input/types';
import type { ScriptStep } from '../../tracking/synthetic/script';
import { closeFist, idle, openFist, underarmSwing } from '../../tracking/synthetic/scripts/moves';
import type { BowlPhase } from './game';

import type { TutorialProbe } from './tutorial';

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
  probe?: TutorialProbe,
): SportBot {
  let pickupTries = 0;
  let swingTries = 0;
  let launchesAtSwing = -1;
  let wiggled = false;
  return {
    next(enqueue: (steps: ScriptStep[]) => void): void {
      const steps: ScriptStep[] = [];
      // Without a tutorial the bot does everything; with one it waits for the step that asks.
      const gate = probe === undefined ? 3 : probe.gate;
      if (view.phase !== 'aim') wiggled = false;
      switch (view.phase) {
        case 'pickup': {
          if (gate < 1) {
            steps.push(...idle(200));
            break;
          }
          swingTries = 0;
          if (pickupTries > 0) steps.push(...openFist(hand, 200), ...idle(200));
          pickupTries++;
          steps.push(...closeFist(hand), ...idle(300));
          break;
        }
        case 'aim': {
          if (gate < 3) {
            // Line up the arrows when asked: slide the hanging hand one way, then the other.
            const sg0 = hand === 'right' ? 1 : -1;
            if (gate === 2 && !wiggled) {
              wiggled = true;
              const wrist = (x: number): ScriptStep => ({
                dur: 1000,
                to:
                  hand === 'right'
                    ? { rightWristX: x, rightWristY: -1.4 }
                    : { leftWristX: x, leftWristY: -1.4 },
                label: 'aim',
              });
              steps.push(wrist(sg0 * 0.12 - 0.5), wrist(sg0 * 0.12 + 0.5), ...idle(300));
            } else steps.push(...idle(200));
            break;
          }
          pickupTries = 0;
          if (launchesAtSwing === view.launches) swingTries++;
          else swingTries = 0;
          launchesAtSwing = view.launches;
          if (swingTries > 0) steps.push(...idle(500));
          const power = Math.min(1, 0.75 + random() * 0.2 + swingTries * 0.08);
          const lateral = aimBias + (random() - 0.5) * 0.12;
          // A little path curve varies the hook, so leftover pins on the hooking side get hit too.
          const curve = -0.5 + random() * 0.6;
          // Aim the way a player does: slide the hanging hand sideways and let the aim settle,
          // then swing from there. The aim is read from the hand before the swing starts.
          const sg = hand === 'right' ? 1 : -1;
          const rx = sg * 0.12 + lateral;
          steps.push({
            dur: 450,
            to:
              hand === 'right'
                ? { rightWristX: rx, rightWristY: -1.4 }
                : { leftWristX: rx, leftWristY: -1.4 },
            label: 'aim',
          });
          steps.push(...idle(450));
          // underarmSwing's backswing starts at -sg*0.1 + lateral: match it to the aimed hand.
          steps.push(
            ...underarmSwing(hand, { power, lateral: lateral + sg * 0.22, curve }),
            ...openFist(hand, 200),
          );
          break;
        }
        default:
          steps.push(...idle(200));
      }
      enqueue(steps);
    },
  };
}
