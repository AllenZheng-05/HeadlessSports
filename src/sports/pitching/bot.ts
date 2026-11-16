import type { SportBot } from '../../core/sport';
import type { Side } from '../../input/types';
import type { ScriptStep } from '../../tracking/synthetic/script';
import { closeFist, idle, openFist, overarmThrow } from '../../tracking/synthetic/scripts/moves';
import { gloveReach } from '../../tracking/synthetic/scripts/pitching';
import { gloveSide, sideSign } from './aim';
import type { PitchKind } from './aim';
import type { PitchingConfig } from './config';
import type { GameState } from './game';
import { cellCentre } from './zone';

/**
 * What the tutorial tells the bot it is teaching. `steer`, `hold` and `throw` are the glove-only
 * steps (the pitch is picked for the player there); every other stage plays the round as normal.
 */
export type BotStage = 'normal' | 'steer' | 'hold' | 'throw';

/** The tutorial sets it, the bot reads it. */
export interface TutorialProbe {
  stage: BotStage;
}

/**
 * The `overarmThrow` options for a plain, unsteered throw: mid height and the natural line, so the
 * throwing arm adds no steering and the glove decides where the pitch goes.
 */
export function botThrowOptions(
  cfg: PitchingConfig,
  hand: Side,
  power: number,
): { power: number; loftDeg: number; lateral: number } {
  const s = sideSign(hand);
  const loftDeg = (cfg.botLoftLow + cfg.botLoftHigh) / 2;
  const eventLateral = s * cfg.neutralLateral;
  const lateral = (eventLateral - s * cfg.botNaturalLateral) / cfg.botLateralPerOption;
  return { power, loftDeg, lateral };
}

/**
 * The glove wrist target (sw from the glove shoulder, y up) that puts the ring on `cell`: the
 * inverse of `gloveAim`, plus the break a curveball will add back.
 */
export function botGloveTarget(
  cfg: PitchingConfig,
  hand: Side,
  cell: number,
  kind: PitchKind,
): { x: number; y: number } {
  const s = sideSign(hand);
  const g = -s;
  const c = cellCentre(cfg, cell, { x: 0, y: 0 });
  const curve = kind === 'curve';
  const wantY = c.y + (curve ? cfg.curveDrop : 0);
  const wantX = c.x + (curve ? s * cfg.curveSide : 0);
  const lateral = g * cfg.gloveNeutralX + wantX / cfg.gloveGainX;
  return {
    x: lateral - g * 0.5,
    y: cfg.gloveNeutralY + (wantY - cfg.zoneCentreY) / cfg.gloveGainY,
  };
}

/**
 * The closed-loop pitcher. It reads the catcher's call: in `sign` it shows the called pitch (a fist
 * or an open hand), points the glove hand at the called cell and holds still (in slices, until the sport reports `windup`); in `windup` it
 * throws once at the called cell with the glove still; in every other phase
 * (including the call itself, while the player would be reading it) it waits. Every wait is sliced, so it cannot deadlock.
 * It is not meant to be perfect: the throwing arm adds a little steering and power noise.
 */
export function createPitchingBot(
  cfg: PitchingConfig,
  game: GameState,
  handOrGetter: Side | (() => Side),
  random: () => number,
  probe?: TutorialProbe,
): SportBot {
  // Pass-and-play: the next player may throw with the other hand, so the sport passes a getter.
  let hand: Side = typeof handOrGetter === 'function' ? handOrGetter() : handOrGetter;
  /** The glove wrist for a cell, with a fastball's ring (the tutorial's glove steps pick it for you). */
  const reach = (cell: number, ms: number): ScriptStep[] => {
    const g = botGloveTarget(cfg, hand, cell, 'fastball');
    return gloveReach(gloveSide(hand), g.x, g.y, ms);
  };
  return {
    next(enqueue): void {
      if (typeof handOrGetter === 'function') hand = handOrGetter();
      const stage = probe?.stage ?? 'normal';
      if (stage === 'steer') {
        // Sweep the glove across the zone: the top left tile, then the bottom right one.
        enqueue([...reach(0, 700), ...idle(250), ...reach(8, 700), ...idle(250)]);
        return;
      }
      if (stage === 'hold') {
        enqueue([...reach(game.target, 700), ...idle(400)]);
        return;
      }
      if (stage === 'throw') {
        if (game.phase === 'windup') {
          const power = cfg.botPowerLow + (cfg.botPowerHigh - cfg.botPowerLow) * random();
          enqueue([
            ...reach(game.target, 700),
            ...idle(300),
            ...overarmThrow(hand, botThrowOptions(cfg, hand, power)),
          ]);
        } else enqueue(idle(150));
        return;
      }
      switch (game.phase) {
        case 'sign': {
          const choice: PitchKind = game.called;
          const steps: ScriptStep[] =
            choice === 'fastball' ? closeFist(hand, 250) : openFist(hand, 250);
          // The glove hand points at the called spot while the sign is shown.
          const g = botGloveTarget(cfg, hand, game.target, choice);
          steps.push(...gloveReach(gloveSide(hand), g.x, g.y, 700));
          steps.push(...idle(100));
          enqueue(steps);
          return;
        }
        case 'windup': {
          const power = cfg.botPowerLow + (cfg.botPowerHigh - cfg.botPowerLow) * random();
          enqueue(overarmThrow(hand, botThrowOptions(cfg, hand, power)));
          return;
        }
        default:
          enqueue(idle(150));
      }
    },
  };
}
