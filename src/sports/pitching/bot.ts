import type { SportBot } from '../../core/sport';
import type { Side } from '../../input/types';
import type { ScriptStep } from '../../tracking/synthetic/script';
import { closeFist, idle, openFist, overarmThrow } from '../../tracking/synthetic/scripts/moves';
import { sideSign } from './aim';
import type { PitchKind } from './aim';
import type { PitchingConfig } from './config';
import type { GameState } from './game';
import { cellCentre } from './zone';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The `overarmThrow` options that should put the pitch in `cell`: the inverse of the aim mapping. */
export function botThrowOptions(
  cfg: PitchingConfig,
  hand: Side,
  cell: number,
  kind: PitchKind,
  power: number,
): { power: number; loftDeg: number; lateral: number } {
  const s = sideSign(hand);
  const c = cellCentre(cfg, cell, { x: 0, y: 0 });
  // The assist pulls the ball toward the cell, so aim straight at the cell's centre, plus the
  // break a curveball will add back.
  const curve = kind === 'curve';
  const wantY = c.y + (curve ? cfg.curveDrop : 0);
  const wantX = c.x + (curve ? s * cfg.curveSide : 0);
  const frac = clamp01(0.5 + (wantY - cfg.zoneCentreY) / (2 * cfg.heightRange));
  const loftDeg = cfg.botLoftLow + frac * (cfg.botLoftHigh - cfg.botLoftLow);
  const eventLateral = s * cfg.neutralLateral + wantX / cfg.aimGainX;
  const lateral = (eventLateral - s * cfg.botNaturalLateral) / cfg.botLateralPerOption;
  return { power, loftDeg, lateral };
}

/**
 * The closed-loop pitcher. It reads the catcher's call: in `sign` it shows the called pitch (a fist
 * or an open hand) and holds still (in slices, until the sport reports `windup`); in `windup` it
 * throws once at the called cell using the inverse of the aim mapping; in every other phase
 * (including the call itself, while the player would be reading it) it waits. Every wait is sliced, so it cannot deadlock.
 * It is not meant to be accurate: the mapping is fitted on the synthetic arm, with some power noise.
 */
export function createPitchingBot(
  cfg: PitchingConfig,
  game: GameState,
  hand: Side,
  random: () => number,
): SportBot {
  return {
    next(enqueue): void {
      switch (game.phase) {
        case 'sign': {
          const choice: PitchKind = game.called;
          const steps: ScriptStep[] =
            choice === 'fastball' ? closeFist(hand, 250) : openFist(hand, 250);
          steps.push(...idle(250));
          enqueue(steps);
          return;
        }
        case 'windup': {
          const power = cfg.botPowerLow + (cfg.botPowerHigh - cfg.botPowerLow) * random();
          enqueue(overarmThrow(hand, botThrowOptions(cfg, hand, game.target, game.kind, power)));
          return;
        }
        default:
          enqueue(idle(150));
      }
    },
  };
}
