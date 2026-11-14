import { describe, expect, it } from 'vitest';
import { runScript } from '../../input/testing/runScript';
import type { GameEvent, Side } from '../../input/types';
import type { Script } from '../../tracking/synthetic/script';
import { closeFist, idle, openFist, overarmThrow } from '../../tracking/synthetic/scripts/moves';
import { aimPitch, createAim } from './aim';
import type { PitchKind } from './aim';
import { botThrowOptions } from './bot';
import { pitchingConfig as cfg } from './config';
import { cellAt, cellCentre } from './zone';

type Throw = Extract<GameEvent, { type: 'ThrowReleased' }>;

/** The exact moves the bot plays for one pitch: show the sign, hold still, throw. */
function pitch(
  hand: Side,
  seed: number,
  opts: { power?: number; loftDeg?: number; lateral?: number },
  fist = true,
): Throw[] {
  const script: Script = {
    name: 'pitch-seq',
    steps: [
      ...idle(600),
      ...(fist ? closeFist(hand, 250) : openFist(hand, 250)),
      ...idle(900),
      ...overarmThrow(hand, opts),
      ...idle(400),
    ],
  };
  const run = runScript(script, { seed });
  return run.events.filter((e): e is Throw => e.type === 'ThrowReleased');
}

describe('sign then overarm throw through the real recognizers', () => {
  for (const hand of ['right', 'left'] as const) {
    it(`${hand} hand: exactly one overarm throw over seeds 1 to 5`, () => {
      for (let seed = 1; seed <= 5; seed++) {
        const t = pitch(hand, seed, { power: 0.7, loftDeg: 85 });
        expect(t).toHaveLength(1);
        expect(t[0]!.hand).toBe(hand);
        expect(t[0]!.style).toBe('overarm');
        expect(t[0]!.speed).toBeGreaterThanOrEqual(cfg.minThrowSpeed);
      }
    });
  }
  it('an open hand sign also gives exactly one throw', () => {
    for (let seed = 1; seed <= 5; seed++)
      expect(pitch('right', seed, { power: 0.7 }, false)).toHaveLength(1);
  });
});

describe('measured proxy and lateral orderings (the bot fit)', () => {
  const proxy = (e: Throw): number => e.vy / e.speed;
  it('a higher loftDeg gives a larger vy / speed, and the config range brackets 60 to 110', () => {
    for (const hand of ['right', 'left'] as const) {
      for (let seed = 1; seed <= 5; seed++) {
        const lo = proxy(pitch(hand, seed, { power: 0.7, loftDeg: cfg.botLoftLow })[0]!);
        const hi = proxy(pitch(hand, seed, { power: 0.7, loftDeg: cfg.botLoftHigh })[0]!);
        expect(hi).toBeGreaterThan(lo);
        expect(Math.abs(lo - cfg.proxyLow)).toBeLessThan(0.2);
        expect(Math.abs(hi - cfg.proxyHigh)).toBeLessThan(0.2);
      }
    }
  });
  it('a larger lateral option gives a larger event.lateral', () => {
    for (const hand of ['right', 'left'] as const) {
      for (let seed = 1; seed <= 5; seed++) {
        const a = pitch(hand, seed, { power: 0.7, loftDeg: 85, lateral: -0.3 })[0]!;
        const b = pitch(hand, seed, { power: 0.7, loftDeg: 85, lateral: 0.3 })[0]!;
        expect(b.lateral).toBeGreaterThan(a.lateral + 0.3);
      }
    }
  });
});

describe('the bot mapping lands near the target', () => {
  it('puts most pitches in the lit cell or beside it, for both hands and both pitches', () => {
    let within = 0;
    let total = 0;
    let sumMiss = 0;
    const p = { x: 0, y: 0 };
    for (const hand of ['right', 'left'] as const) {
      for (const kind of ['fastball', 'curve'] as PitchKind[]) {
        for (let cell = 0; cell < 9; cell++) {
          const power = 0.7;
          const t = pitch(
            hand,
            3,
            botThrowOptions(cfg, hand, cell, kind, power),
            kind === 'fastball',
          );
          expect(t).toHaveLength(1);
          const a = aimPitch(cfg, t[0]!, hand, kind, cell, false, createAim(), p);
          cellCentre(cfg, cell, p);
          const miss = Math.hypot(a.x - p.x, a.y - p.y);
          sumMiss += miss;
          total++;
          if (cellAt(cfg, a.x, a.y) >= 0) within++;
        }
      }
    }
    // Not required to be accurate, but a sane fit keeps the bot's scores meaningful.
    expect(within / total).toBeGreaterThan(0.6);
    expect(sumMiss / total).toBeLessThan(0.3);
  });
});
