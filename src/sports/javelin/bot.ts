import type { SportBot } from '../../core/sport';
import { idle, jogInPlace, overarmThrow, runInPlace } from '../../tracking/synthetic/scripts/moves';
import type { JavelinConfig } from './config';
import type { GameState } from './game';
import { targetRunSpeed } from './runSpeed';

/** Amplitude the recognizer reports for the synthetic jog (full effort is 0.45 sw). */
const EXPECTED_AMPLITUDE = 0.45;

/**
 * Distance the athlete still covers in `t` seconds from speed `v` once the player stops
 * stepping: the recognizer holds the old cadence for `hold` seconds, then the athlete slows down
 * at `decel`.
 */
export function coastDistance(v: number, t: number, hold: number, decel: number): number {
  if (t <= hold) return v * t;
  const t2 = t - hold;
  const tStop = v / decel;
  const slow = t2 < tStop ? v * t2 - 0.5 * decel * t2 * t2 : (v * v) / (2 * decel);
  return v * hold + slow;
}

/**
 * What the tutorial tells the bot about the step it is in (a normal round has no probe).
 * `hold`: keep jogging and never throw (the running steps). `standing`: throw at once, without a
 * run-up (the practice throw).
 */
export interface TutorialProbe {
  hold: boolean;
  standing: boolean;
}

/**
 * The closed-loop javelin player. In `ready` it waits for the run to start by itself. In `run` it
 * runs in short bursts, re-reading the athlete's position between them, and throws when the
 * distance left to the line is what the athlete will still cover while the throw winds up and the
 * step rate fades (`coastDistance` over `botThrowLeadS`, plus a margin). In every other phase it
 * waits. `style` 'legs' lifts the knees only, 'jog' jogs with the whole body (arms and torso too). The step rate is random in a normal range, or fixed by `variant`: 'slow' and 'fast' give
 * a slower and a faster approach with the same throw, to show that quicker feet throw farther.
 *
 * `overarmThrow`'s loft argument is the angle of the wrist's *image* path, which is not the
 * javelin's loft: the release proxy reads vy / speed, and values around 95 to 110 here give the
 * 25 to 40 degree releases a good throw needs. Power and loft are drawn once, so the variants of
 * one seed throw the same arm.
 */
export function createJavelinBot(
  cfg: JavelinConfig,
  state: GameState,
  /** A function when the seat (and so the throwing hand) can change between turns. */
  handSource: 'left' | 'right' | (() => 'left' | 'right'),
  random: () => number,
  variant: 'slow' | 'fast' | null = null,
  style: 'legs' | 'jog' = 'legs',
  probe?: TutorialProbe,
): SportBot {
  const power = 0.85 + 0.15 * random();
  const loftDeg = 95 + 15 * random();
  /** Steps jogged so far in this run: the next burst carries on with the same leg and arm phase. */
  let stepsDone = 0;
  const hand = (): 'left' | 'right' =>
    typeof handSource === 'function' ? handSource() : handSource;
  return {
    next(enqueue): void {
      switch (state.phase) {
        case 'run': {
          if (probe?.standing === true && !probe.hold) {
            enqueue(overarmThrow(hand(), { power, loftDeg }));
            return;
          }
          const sps =
            variant === 'slow'
              ? cfg.botSlowCadence
              : variant === 'fast'
                ? cfg.botFastCadence
                : 3.6 + 0.6 * random();
          const remaining = cfg.runwayLength - state.position;
          const v = Math.max(state.speed, targetRunSpeed(sps, EXPECTED_AMPLITUDE, cfg));
          const need =
            coastDistance(v, cfg.botThrowLeadS, cfg.botCadenceHoldS, cfg.decel) + cfg.botMarginM;
          const slack = remaining - need;
          const burst = probe?.hold === true ? 4 : Math.min(4, Math.floor((slack / v) * sps));
          if (burst < 1) {
            enqueue(overarmThrow(hand(), { power, loftDeg }));
            return;
          }
          const steps = stepsDone === 0 ? Math.max(burst, 3) : burst;
          if (style === 'jog') {
            // A whole-body jog as a front-on camera sees it: small knee lift, arm pump, torso bob.
            enqueue(
              jogInPlace({
                steps,
                stepsPerSecond: sps,
                kneeLift: 0.3,
                armPump: 0.4,
                bob: 0.06,
                startStep: stepsDone,
                prep: stepsDone === 0,
                settle: false,
              }),
            );
          } else {
            // Knee lifts only: the legs-only runner, which the recognizer must also follow.
            enqueue(runInPlace({ steps, stepsPerSecond: sps, amplitude: 0.8 }));
          }
          stepsDone += steps;
          return;
        }
        default:
          stepsDone = 0;
          enqueue(idle(200));
      }
    },
  };
}
