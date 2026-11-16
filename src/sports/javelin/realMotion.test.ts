// PLACEHOLDER: synthetic motion; replace with real recordings in tests/recordings/
//
// The whole javelin chain on motion a real person makes: a side-on thrower jogging on the spot,
// with a bobbing and turning torso, a hand released near shoulder height, a wrist that blurs at
// the peak. Synthetic player -> TrackedInput (with the recognizer settings the sport applies) ->
// ThrowReleased -> the rules (`onThrow`). Exactly one throw must be taken, and nothing else
// (arm pump, raising the arm to cock it, the other hand) may be.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recognizerConfig } from '../../input/recognizers/config';
import { play } from '../../input/recognizers/profileHarness';
import { ofType } from '../../input/testing/collect';
import type { GameEvent } from '../../input/types';
import type { Script } from '../../tracking/synthetic/script';
import { armUp, idle, overarmThrow } from '../../tracking/synthetic/scripts/moves';
import { jogSideOn, turnToStance } from '../../tracking/synthetic/scripts/profile';
import { javelinConfig as cfg } from './config';
import { createGame, onThrow } from './game';
import { applyJavelinRecognizer } from './recognizer';

const SEEDS = [1, 2, 3, 4, 5];
let restore = (): void => undefined;

beforeEach(() => {
  // What the sport does on start (see index.ts).
  restore = applyJavelinRecognizer(cfg, recognizerConfig);
});
afterEach(() => {
  restore();
});

function script(...parts: Script['steps'][]): Script {
  return { name: 'real', steps: parts.flat() };
}

/** How many of the events the rules would take as a throw, each tried on its own at run speed `v`. */
function taken(events: GameEvent[], v: number, hand: 'left' | 'right' = 'right'): number {
  let n = 0;
  for (const e of ofType(events, 'ThrowReleased')) {
    const s = createGame(3);
    s.phase = 'run';
    s.speed = v;
    s.position = 8;
    s.lockoutUntilMs = 0;
    const ok = onThrow(
      s,
      cfg,
      e.t + 80,
      {
        t: e.t,
        hand: e.hand,
        speed: e.speed,
        vy: e.vy,
        vx: e.vx,
        style: e.style,
        travel: e.travel,
        topY: e.topY,
      },
      hand,
    );
    if (ok) n++;
  }
  return n;
}

describe.each(SEEDS)('javelin on real-looking motion, noise seed %i', (seed) => {
  it('a side-on throw while jogging is taken exactly once', () => {
    const s = script(idle(400), jogSideOn({ ms: 3400, throwHand: 'right', throwAtMs: 1800 }));
    expect(taken(play(s, seed).events, 5)).toBe(1);
  });

  it('a throw released a little under the shoulder line, and a weaker one, are taken', () => {
    const low = script(
      idle(400),
      jogSideOn({ ms: 3400, throwHand: 'right', throwAtMs: 1800, releaseY: -0.1 }),
    );
    expect(taken(play(low, seed).events, 5)).toBe(1);
    const weak = script(
      idle(400),
      jogSideOn({ ms: 3400, throwHand: 'right', throwAtMs: 1800, power: 0.3 }),
    );
    expect(taken(play(weak, seed).events, 5)).toBe(1);
  });

  it('the left hand, and a dropped frame at the peak', () => {
    const left = script(
      idle(400),
      jogSideOn({ ms: 3400, throwHand: 'left', near: 'left', throwAtMs: 1800 }),
    );
    expect(taken(play(left, seed).events, 5, 'left')).toBe(1);
    const right = script(idle(400), jogSideOn({ ms: 3400, throwHand: 'right', throwAtMs: 1800 }));
    expect(taken(play(right, seed, { drop: [[2830, 2890]] }).events, 5)).toBe(1);
  });

  it('the wrong hand is not taken', () => {
    const s = script(idle(400), jogSideOn({ ms: 3400, throwHand: 'left', near: 'left' }));
    expect(taken(play(s, seed).events, 5, 'right')).toBe(0);
  });

  it('jogging with a hard arm pump, both arms, never throws', () => {
    for (const v of [0, 4, 8]) {
      const s = script(idle(400), jogSideOn({ ms: 4500, pump: 0.6 }));
      const events = play(s, seed).events;
      expect(taken(events, v, 'right')).toBe(0);
      expect(taken(events, v, 'left')).toBe(0);
    }
  });

  it('raising the javelin arm to cock it, side-on or front-on, is not a throw', () => {
    const side = script(idle(400), turnToStance({ near: 'right' }), armUp('right'), idle(900));
    expect(taken(play(side, seed).events, 0)).toBe(0);
    const front = script(idle(400), armUp('right'), idle(900));
    expect(taken(play(front, seed, { calibrate: true }).events, 0)).toBe(0);
  });

  it('a front-on throw is still taken once', () => {
    const s = script(idle(500), overarmThrow('right'));
    expect(taken(play(s, seed, { calibrate: true }).events, 5)).toBe(1);
  });
});
