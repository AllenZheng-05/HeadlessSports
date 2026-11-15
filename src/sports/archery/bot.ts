import type { SportBot } from '../../core/sport';
import type { Side } from '../../input/types';
import type { BodyControls } from '../../tracking/synthetic/controls';
import type { ScriptStep } from '../../tracking/synthetic/script';
import { idle } from '../../tracking/synthetic/scripts/moves';
import { otherSide, sideSign } from './aim';
import type { ArcheryConfig } from './config';

/** What the bot may look at: the sport's own state, never the future. */
export interface BotView {
  readonly phase: string;
  /** Smoothed draw, 0..1. */
  readonly draw: number;
  /** Where the arrow would land for the current aim, draw and wind, relative to the centre, metres. */
  readonly hitX: number;
  readonly hitY: number;
  readonly arrowsShot: number;
}

const STUCK_MS = 8000;
const MAX_ADJUSTMENTS = 3;
const NOCK_REACH = 1.4;
const BOW_OUT = 1.2;
const MAX_NOCK_TRIES = 4;

function wrist(hand: Side, x: number, y: number): Partial<BodyControls> {
  return hand === 'left' ? { leftWristX: x, leftWristY: y } : { rightWristX: x, rightWristY: y };
}

function fist(hand: Side, value: number): Partial<BodyControls> {
  return hand === 'left' ? { leftFist: value } : { rightFist: value };
}

/**
 * Bow arm out to the side at (`out`, `y`) and the draw hand brought next to it (`reach` sw from its
 * own shoulder toward the bow side), settle, close the fist (the nock) and dwell.
 */
export function nockSteps(
  drawHand: Side,
  opts: { out?: number; y?: number; reach?: number } = {},
): ScriptStep[] {
  const sb = -sideSign(drawHand);
  const out = opts.out ?? BOW_OUT;
  const y = opts.y ?? 0;
  const reach = opts.reach ?? NOCK_REACH;
  const bow = otherSide(drawHand);
  return [
    {
      dur: 700,
      to: {
        ...wrist(bow, sb * out, y),
        ...wrist(drawHand, sb * reach, y - 0.05),
        ...fist(drawHand, 0),
      },
      label: 'aim',
    },
    { dur: 250, label: 'settle' },
    { dur: 300, to: fist(drawHand, 1), label: 'grab' },
    { dur: 250, label: 'dwell' },
  ];
}

/** Pull the closed draw hand back across the chest; `draw` 0..1 scales the pull. */
export function pullSteps(drawHand: Side, y: number, draw = 1): ScriptStep[] {
  const sd = sideSign(drawHand);
  const sb = -sd;
  const endX = sb * NOCK_REACH + (sd * 0.25 - sb * NOCK_REACH) * draw;
  return [{ dur: 600 + 300 * draw, to: wrist(drawHand, endX, y - 0.05), label: 'draw' }];
}

/** Move the bow wrist to (`out`, `y`) and hold while the aim settles. */
export function adjustSteps(drawHand: Side, out: number, y: number, settleMs = 400): ScriptStep[] {
  const sb = -sideSign(drawHand);
  const bow = otherSide(drawHand);
  return [
    { dur: 220, to: wrist(bow, sb * out, y), label: 'adjust' },
    { dur: settleMs, label: 'hold' },
  ];
}

/**
 * The draw hand disappears for `ms` (behind the head at full draw, say) and comes back. Fist and
 * wrist stay where they were: a tracker that loses the hand does not move it.
 */
export function dropoutSteps(drawHand: Side, ms: number): ScriptStep[] {
  const vis = (v: number): Partial<BodyControls> =>
    drawHand === 'left' ? { leftHandVisible: v } : { rightHandVisible: v };
  return [
    { dur: 40, to: vis(0), label: 'hand-lost' },
    { dur: ms, label: 'hand-gone' },
    { dur: 40, to: vis(1), label: 'hand-back' },
    { dur: 200, label: 'hand-settle' },
  ];
}

/** Open the draw hand: the release. */
export function releaseSteps(drawHand: Side): ScriptStep[] {
  return [{ dur: 160, to: fist(drawHand, 0), label: 'release' }, ...idle(250)];
}

/** Bring the open draw hand back next to the bow hand. */
export function returnSteps(drawHand: Side, y: number, reach = NOCK_REACH): ScriptStep[] {
  const sb = -sideSign(drawHand);
  return [
    {
      dur: 600,
      to: { ...wrist(drawHand, sb * reach, y - 0.05), ...fist(drawHand, 0) },
      label: 'return',
    },
  ];
}

type Stage = 'start' | 'nocking' | 'pulled' | 'aiming' | 'released';

/**
 * The closed-loop synthetic archer: raise the bow arm, nock, draw to the full, then nudge the bow
 * wrist until the sport's own reticle says the arrow would land near the centre (plus a seeded
 * human error), and open the hand. A failed nock is retried; with no progress for 8 s it starts
 * over from `ready`.
 */
export function createArcheryBot(
  view: BotView,
  cfg: ArcheryConfig,
  drawHand: Side,
  random: () => number,
): SportBot {
  const sb = -sideSign(drawHand);
  let stage: Stage = 'start';
  let out = BOW_OUT;
  let y = 0;
  let tries = 0;
  let adjustments = 0;
  let tolerance = 0.12;
  let lastKey = '';
  let lastProgressMs = -1;
  let handBack = false;
  // The first arrow of the round loses the draw hand for a moment at full draw: it must not fire.
  let dropoutDone = false;

  const progress = (nowMs: number): boolean => {
    const key = `${view.phase}|${view.arrowsShot}|${Math.round(view.draw * 8)}`;
    if (key !== lastKey || lastProgressMs < 0) {
      lastKey = key;
      lastProgressMs = nowMs;
    }
    return nowMs - lastProgressMs > STUCK_MS;
  };

  const newArrow = (): void => {
    stage = 'start';
    tries = 0;
    adjustments = 0;
    out = BOW_OUT;
    y = 0;
    // Seeded human error on top of the 12 cm aim: a few centimetres, sometimes more.
    tolerance = 0.12 + random() * random() * 0.12;
  };
  newArrow();

  return {
    next(enqueue, nowMs): void {
      if (progress(nowMs)) {
        lastProgressMs = nowMs;
        enqueue([...releaseSteps(drawHand), ...returnSteps(drawHand, y)]);
        newArrow();
        return;
      }
      const phase = view.phase;
      if (phase === 'finishing') {
        enqueue(idle(300));
        return;
      }
      switch (stage) {
        case 'start':
          if (phase !== 'ready') {
            if (phase === 'drawing') {
              // Already nocked (a restart in mid-draw): go straight to aiming.
              stage = 'pulled';
              enqueue(idle(100));
              return;
            }
            enqueue(idle(250));
            return;
          }
          handBack = false;
          enqueue(nockSteps(drawHand, { out, y, reach: NOCK_REACH - 0.1 * tries }));
          stage = 'nocking';
          return;
        case 'nocking':
          if (phase === 'drawing') {
            enqueue(pullSteps(drawHand, y, 1));
            stage = 'pulled';
          } else {
            // No nock: open, tuck the hand a little closer, and try again.
            tries = Math.min(tries + 1, MAX_NOCK_TRIES);
            enqueue([...releaseSteps(drawHand)]);
            stage = 'start';
          }
          return;
        case 'pulled':
          enqueue(idle(250));
          adjustments = 0;
          stage = 'aiming';
          return;
        case 'aiming': {
          if (phase !== 'drawing') {
            // The arrow went back (hand lost, arm dropped): start over.
            enqueue(releaseSteps(drawHand));
            newArrow();
            return;
          }
          if (view.draw < 0.9) {
            enqueue(idle(150));
            return;
          }
          if (!dropoutDone) {
            dropoutDone = true;
            enqueue(dropoutSteps(drawHand, 300));
            return;
          }
          const miss = Math.hypot(view.hitX, view.hitY);
          if (miss <= tolerance || adjustments >= MAX_ADJUSTMENTS) {
            enqueue(releaseSteps(drawHand));
            stage = 'released';
            return;
          }
          const run = cfg.targetDistance;
          // Yaw is out-positive for the bow side: a hit to the right of centre needs yaw to the left.
          const dYaw = -view.hitX / run;
          const dPitch = -view.hitY / run;
          out = clamp(out + (sb * dYaw * 0.9) / cfg.aimGainX, 0.7, 1.55);
          y = clamp(y + (dPitch * 0.9) / cfg.aimGainY, -0.7, 0.8);
          adjustments++;
          enqueue(adjustSteps(drawHand, out, y));
          return;
        }
        case 'released':
          if (phase === 'ready') {
            newArrow();
            enqueue(idle(100));
            return;
          }
          if (phase === 'drawing') {
            // The release did not register: open again.
            enqueue(releaseSteps(drawHand));
            return;
          }
          if (!handBack) {
            // While the arrow flies, bring the open hand back next to the bow hand.
            handBack = true;
            enqueue(returnSteps(drawHand, y));
            return;
          }
          enqueue(idle(250));
          return;
      }
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
