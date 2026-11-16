import type { SportBot } from '../../core/sport';
import type { ScriptStep } from '../../tracking/synthetic/script';
import { armDown, idle, openFist, twoHandSwing } from '../../tracking/synthetic/scripts/moves';
import type { BattingConfig } from './config';
import type { Pitch } from './pitch';

/** The synthetic source emits tracking frames at 30 Hz. */
const FRAME_MS = 1000 / 30;
/** Idle in slices; the director is only asked again a frame or two after a slice ends. */
const LEAD_MS = 50;
/** Start the swing when the remaining wait is no more than this. */
const START_WITHIN_MS = 25;
/** Too late to make this pitch by more than this: skip it. */
const SKIP_AFTER_MS = 150;

/**
 * The bot's swing: twoHandSwing with a slow first step. The hands drift to the new swing height
 * during the stance step; at the normal 500 ms that drift (up to 1.5 sw between a low and a high
 * pitch) is fast enough to be read as the swing itself, so the stance is stretched.
 */
export function botSwingSteps(
  cfg: BattingConfig,
  height: number,
  direction: -1 | 1 = 1,
): ScriptStep[] {
  const steps = twoHandSwing({ power: cfg.botPower, height, direction });
  steps[0] = { ...steps[0]!, dur: cfg.botStanceMs };
  return [...steps, ...idle(100)];
}

export interface BotView {
  /** The pitch the bot should still swing at, or null (none in the air, already swung, resolved). */
  pitch(): Pitch | null;
  /** The last pitch has been resolved: nothing more to swing at. */
  over(): boolean;
  /** Game ms of the newest tracking frame folded into the input state. */
  frameT(): number;
}

/**
 * The closed-loop player. It knows what a human can see: the pitch's arrival time. The swing onset
 * the recognizer will report lands `botOnsetOffsetMs` after the start of the twoHandSwing steps
 * (measured in bot.test.ts), and the bat needs `batTravelMs` more, so the steps must begin at
 * `arrival - batTravelMs - botOnsetOffsetMs`, plus a little seeded jitter so the bot hits like a
 * person: a mix of perfect and good.
 *
 * `rel` (the director's time) counts from the synthetic source's own anchor; the offset to game ms is
 * read from the input state, whose `t` is the previous frame's game time.
 */
export function createBattingBot(options: {
  cfg: BattingConfig;
  view: BotView;
  random: () => number;
  /** Which way the swing goes in the image: toward the plate (1 for a right-hander, -1 for a left-hander). */
  direction?: -1 | 1;
}): SportBot {
  const { cfg, view, random } = options;
  const direction = options.direction ?? 1;
  let swungFor = 0;
  let jitterFor = 0;
  let jitter = 0;
  let lowered = false;
  return {
    next(enqueue, rel): void {
      if (view.over()) {
        // Hands down and open, away from the results screen's buttons (hand cursors can press them).
        if (lowered) enqueue(idle(200));
        else {
          lowered = true;
          enqueue([
            ...openFist('left', 200),
            ...openFist('right', 200),
            ...armDown('left', 500),
            ...armDown('right', 500),
          ]);
        }
        return;
      }
      const frameT = view.frameT();
      if (!(frameT > 0) || rel < FRAME_MS * 0.5) {
        // The first frame carries no game time yet.
        enqueue(idle(30));
        return;
      }
      const anchor = frameT - (rel - FRAME_MS);
      const now = anchor + rel;
      const p = view.pitch();
      if (p === null || p.index === swungFor) {
        enqueue(idle(100));
        return;
      }
      if (jitterFor !== p.index) {
        jitterFor = p.index;
        jitter = (random() * 2 - 1) * cfg.botJitterMs;
      }
      const startAt = p.arrivalMs - cfg.batTravelMs - cfg.botOnsetOffsetMs + jitter;
      const remaining = startAt - now;
      if (remaining > START_WITHIN_MS) {
        enqueue(idle(Math.max(1, remaining - LEAD_MS)));
        return;
      }
      swungFor = p.index;
      if (remaining < -SKIP_AFTER_MS) {
        enqueue(idle(100)); // missed the moment; take this one off
        return;
      }
      // The bat should meet the ball a little below its centre: that lifts it.
      const batHeight = p.ty - cfg.botBatBelowBall;
      const eventHeight = (batHeight - cfg.shoulderHeightM + cfg.batDrop) / cfg.swToMetres;
      enqueue(botSwingSteps(cfg, eventHeight - cfg.botHeightOffset, direction));
    },
  };
}
