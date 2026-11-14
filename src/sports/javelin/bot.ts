import type { SportBot } from '../../core/sport';
import { idle, overarmThrow, runInPlace } from '../../tracking/synthetic/scripts/moves';
import type { JavelinConfig } from './config';
import type { GameState } from './game';
import { targetRunSpeed } from './runSpeed';

/** Knee amplitude the synthetic runner reports, sw (what runInPlace's 0.8 turns into). */
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
 * The closed-loop javelin player. In `ready` it waits for the run to start by itself. In `run` it
 * runs in short bursts, re-reading the athlete's position between them, and throws when the
 * distance left to the line is what the athlete will still cover while the throw winds up and the
 * step rate fades (`coastDistance` over `botThrowLeadS`, plus a margin). In every other phase it
 * waits. The step rate is random in a normal range, or fixed by `variant`: 'slow' and 'fast' give
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
  hand: 'left' | 'right',
  random: () => number,
  variant: 'slow' | 'fast' | null = null,
): SportBot {
  const power = 0.85 + 0.15 * random();
  const loftDeg = 95 + 15 * random();
  return {
    next(enqueue): void {
      switch (state.phase) {
        case 'run': {
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
          const burst = Math.min(4, Math.floor((slack / v) * sps));
          if (burst < 1) {
            enqueue(overarmThrow(hand, { power, loftDeg }));
            return;
          }
          enqueue(
            runInPlace({
              steps: state.speed < 1 ? Math.max(burst, 3) : burst,
              stepsPerSecond: sps,
              amplitude: 0.8,
            }),
          );
          return;
        }
        default:
          enqueue(idle(200));
      }
    },
  };
}
