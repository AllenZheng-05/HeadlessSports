// PLACEHOLDER: synthetic motion; replace with real recordings in tests/recordings/
//
// Round 4 review fixes, end to end: no hint while only running (arm pump), a cocking movement
// does not swallow the throw, a brisk arm lift is not a throw, and moderate real-speed throws.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recognizerConfig } from '../../input/recognizers/config';
import { play } from '../../input/recognizers/profileHarness';
import { ofType } from '../../input/testing/collect';
import type { GameEvent } from '../../input/types';
import type { Script } from '../../tracking/synthetic/script';
import { armUp, armUpFast, idle, overarmThrow } from '../../tracking/synthetic/scripts/moves';
import { jogSideOn, turnToStance } from '../../tracking/synthetic/scripts/profile';
import { javelinConfig as cfg } from './config';
import { createGame, isLift, onThrow, refusalWorthSaying, showsRejection } from './game';
import type { GameState, ThrowInput } from './game';
import { applyJavelinRecognizer, maxRequiredThrowSpeed } from './recognizer';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
let restore = (): void => undefined;
beforeEach(() => {
  restore = applyJavelinRecognizer(cfg, recognizerConfig);
});
afterEach(() => {
  restore();
});

function script(...parts: Script['steps'][]): Script {
  return { name: 'rej', steps: parts.flat() };
}

function runState(v: number, position = 8): GameState {
  const s = createGame(3);
  s.phase = 'run';
  s.speed = v;
  s.position = position;
  s.lockoutUntilMs = 0;
  return s;
}

function asInput(e: Extract<GameEvent, { type: 'ThrowReleased' }>): ThrowInput {
  return {
    t: e.t,
    hand: e.hand,
    speed: e.speed,
    vy: e.vy,
    vx: e.vx,
    style: e.style,
    travel: e.travel,
    topY: e.topY,
  };
}

/** Throws the rules take and the refusals (that would be said) of the ones they did not, each tried on its own. */
function judge(events: GameEvent[], v: number, hand: 'left' | 'right' = 'right') {
  let taken = 0;
  const refusals: string[] = [];
  for (const e of ofType(events, 'ThrowReleased')) {
    const s = runState(v);
    if (onThrow(s, cfg, e.t + 80, asInput(e), hand)) taken++;
    else if (s.refusal !== '' && refusalWorthSaying(s, cfg)) refusals.push(s.refusal);
  }
  return { taken, refusals };
}

/** Every note the recognizers left while playing the script, and how many the javelin would show. */
function notes(s: Script, seed: number, hand: 'left' | 'right' = 'right') {
  let seq = 0;
  let all = 0;
  let shown = 0;
  play(s, seed, {
    onFrame: (state) => {
      const r = state.rejected;
      if (r === undefined || r.seq === seq) return;
      seq = r.seq;
      all++;
      if (showsRejection(runState(0), cfg, 1e6, r, hand)) shown++;
    },
  });
  return { all, shown };
}

describe.each(SEEDS)('item 1: running alone says nothing, noise seed %i', (seed) => {
  it('10 s of jogging with arm pump gives no notice', () => {
    for (const pump of [0.45, 0.6]) {
      const s = script(idle(400), jogSideOn({ ms: 10000, pump }));
      expect(notes(s, seed).shown).toBe(0);
      expect(notes(s, seed, 'left').shown).toBe(0);
    }
  });

  it('10 s of a hard sprint pump (wrists up to the shoulders) gives no notice and no throw', () => {
    const sprint = { ms: 10000, pump: 0.45, pumpY: 0.5, stepsPerSecond: 3.5, carryY: -0.55 };
    for (const near of ['left', 'right'] as const) {
      const s = script(idle(400), jogSideOn({ ...sprint, near }));
      expect(notes(s, seed).shown).toBe(0);
      expect(notes(s, seed, 'left').shown).toBe(0);
      const events = play(s, seed).events;
      for (const v of [0, 4, 9]) {
        expect(judge(events, v, 'right').taken).toBe(0);
        expect(judge(events, v, 'left').taken).toBe(0);
      }
      // ...and no refusal hint either while running ("Bring your hand up past your shoulder").
      for (const v of [4, 9]) {
        expect(judge(events, v, 'right').refusals).toEqual([]);
        expect(judge(events, v, 'left').refusals).toEqual([]);
      }
    }
  });
});

describe('item 9: the "hand up" hint is not for a runner', () => {
  it('is said standing nearly still, not while running', () => {
    const slow = runState(0.5);
    slow.refusal = 'low';
    expect(refusalWorthSaying(slow, cfg)).toBe(true);
    const fast = runState(cfg.lowHintMaxRunSpeed + 1);
    fast.refusal = 'low';
    expect(refusalWorthSaying(fast, cfg)).toBe(false);
    fast.refusal = 'slow';
    expect(refusalWorthSaying(fast, cfg)).toBe(true);
  });
});

describe('item 1: the rules for a rejection note', () => {
  const note = { kind: 'throw' as const, reason: 'lost', hand: 'right' as const, speed: 6 };
  it('is shown for the throwing arm at a real effort', () => {
    expect(showsRejection(runState(5), cfg, 1e6, note, 'right')).toBe(true);
  });
  it('is not shown for the other arm, a weak movement, a swing or without a hand', () => {
    expect(showsRejection(runState(5), cfg, 1e6, note, 'left')).toBe(false);
    expect(showsRejection(runState(5), cfg, 1e6, { ...note, speed: 3.9 }, 'right')).toBe(false);
    expect(showsRejection(runState(5), cfg, 1e6, { ...note, kind: 'swing' }, 'right')).toBe(false);
    expect(showsRejection(runState(5), cfg, 1e6, { ...note, reason: 'slow' }, 'right')).toBe(false);
    expect(showsRejection(runState(5), cfg, 1e6, { ...note, reason: 'short' }, 'right')).toBe(true);
    expect(showsRejection(runState(5), cfg, 1e6, { ...note, hand: undefined }, 'right')).toBe(
      false,
    );
  });
  it('is not shown over the throw prompt, or while the run has not begun', () => {
    const near = runState(5, cfg.runwayLength - cfg.throwZone + 1);
    expect(showsRejection(near, cfg, 1e6, note, 'right')).toBe(false);
    const early = runState(5);
    early.lockoutUntilMs = 1000;
    expect(showsRejection(early, cfg, 500, note, 'right')).toBe(false);
    const flying = runState(5);
    flying.phase = 'flight';
    expect(showsRejection(flying, cfg, 1e6, note, 'right')).toBe(false);
  });
});

describe.each(SEEDS)('item 2: a cocking movement does not swallow the throw, seed %i', (seed) => {
  // The arm is cocked back (peak about 5.4 sw/s: a release the rules refuse as slow), and the
  // whip (about 12 sw/s) follows within 300 ms.
  const cockThenWhip = script(
    idle(400),
    [
      { dur: 500, to: { rightWristX: 0.3, rightWristY: 0.2 } },
      { dur: 400, label: 'hold' },
      { dur: 115, to: { rightWristX: 0.6, rightWristY: 0.55 }, ease: 'in' as const },
      { dur: 115, to: { rightWristX: 0.9, rightWristY: 0.9 }, ease: 'out' as const },
      { dur: 100, to: { rightWristX: 0.2, rightWristY: 0.3 }, ease: 'in' as const },
      { dur: 100, to: { rightWristX: -0.5, rightWristY: -0.3 }, ease: 'out' as const },
    ],
    idle(700),
  );

  it('the whip is delivered and taken with the javelin settings', () => {
    const { events } = play(cockThenWhip, seed, { calibrate: true });
    const r = ofType(events, 'ThrowReleased').filter((e) => e.speed > 2.5);
    const whip = r.filter((e) => e.speed > 10);
    expect(whip).toHaveLength(1);
    const cock = r.filter((e) => e.t < whip[0].t && e.speed > 5.2 && e.speed < 7.2);
    expect(cock.length).toBeGreaterThanOrEqual(1);
    expect(whip[0].t - cock[cock.length - 1].t).toBeLessThan(300);
    // At run speed 9 the floor is 7.5, above the cock: only the whip is a throw.
    expect(judge(events, 9).taken).toBe(1);
  });

  it('with the shared settings (pitching, bowling) a release over 5 sw/s still hides it', () => {
    restore();
    expect(recognizerConfig.throw.supersedeMaxPeak).toBe(2);
    const { events } = play(cockThenWhip, seed, { calibrate: true });
    expect(ofType(events, 'ThrowReleased').filter((e) => e.speed > 10)).toHaveLength(0);
  });
});

describe('item 2: the cap comes from the rules', () => {
  it('is the required speed at full run speed, in minPeaks', () => {
    expect(recognizerConfig.throw.supersedeMaxPeak * recognizerConfig.throw.minPeak).toBeCloseTo(
      Math.max(5, maxRequiredThrowSpeed(cfg)),
      6,
    );
  });
  it('is put back when the sport ends', () => {
    const before = recognizerConfig.throw.supersedeMaxPeak;
    restore();
    expect(recognizerConfig.throw.supersedeMaxPeak).toBe(2);
    restore = applyJavelinRecognizer(cfg, recognizerConfig);
    expect(recognizerConfig.throw.supersedeMaxPeak).toBe(before);
  });
});

describe.each(SEEDS)('item 3: a brisk arm lift is not a throw, seed %i', (seed) => {
  it('releases like a throw but is refused as a lift (front-on, either hand)', () => {
    for (const hand of ['left', 'right'] as const) {
      const s = script(idle(400), armUpFast(hand), idle(900));
      const { events } = play(s, seed, { calibrate: true });
      const rel = ofType(events, 'ThrowReleased').filter((e) => e.hand === hand);
      // It must be a real release (otherwise the test proves nothing)...
      expect(rel.some((e) => e.speed > 7 && (e.topY ?? -9) >= 0.1)).toBe(true);
      // ...and not a throw at any run speed.
      for (const v of [0, 5, 9]) expect(judge(events, v, hand).taken).toBe(0);
      expect(judge(events, 0, hand).refusals).toContain('up');
    }
  });

  it('side-on too', () => {
    for (const near of ['left', 'right'] as const) {
      const s = script(idle(400), turnToStance({ near }), armUpFast(near), idle(900));
      const { events } = play(s, seed);
      expect(ofType(events, 'ThrowReleased').some((e) => e.speed > 7)).toBe(true);
      for (const v of [0, 5, 9]) expect(judge(events, v, near).taken).toBe(0);
    }
  });

  it('a real overarm throw is still taken: front-on and side-on, either hand', () => {
    for (const hand of ['left', 'right'] as const) {
      const front = script(idle(500), overarmThrow(hand));
      expect(judge(play(front, seed, { calibrate: true }).events, 5, hand).taken).toBe(1);
      const side = script(
        idle(400),
        jogSideOn({ ms: 3400, throwHand: hand, near: hand, throwAtMs: 1800 }),
      );
      expect(judge(play(side, seed).events, 5, hand).taken).toBe(1);
    }
  });
});

describe('item 3: the direction rule', () => {
  const base: ThrowInput = { t: 100, hand: 'right', speed: 9, vy: 0, vx: 0, style: 'overarm' };
  it('mostly up is a lift; forward, down or sideways is not', () => {
    expect(isLift(cfg, { ...base, vx: 1, vy: 9 })).toBe(true);
    expect(isLift(cfg, { ...base, vx: 9, vy: 1 })).toBe(false);
    expect(isLift(cfg, { ...base, vx: -6, vy: -6 })).toBe(false);
    expect(isLift(cfg, { ...base, vx: 0, vy: -9 })).toBe(false);
  });
  it('the ratio is the config constant, and mouse throws (no vx) are never lifts', () => {
    const e = { ...base, vx: 3, vy: 3 * (cfg.maxLiftRatio + 0.2) };
    expect(isLift(cfg, e)).toBe(true);
    expect(isLift({ ...cfg, maxLiftRatio: cfg.maxLiftRatio + 1 }, e)).toBe(false);
    expect(isLift(cfg, { ...base, vx: undefined, vy: 9 })).toBe(false);
  });
  it('onThrow refuses it with the "up" reason and leaves the round running', () => {
    const s = runState(0);
    const lift = { ...base, vx: 0.5, vy: 9, topY: 0.8, travel: 1.5 };
    expect(onThrow(s, cfg, 200, lift, 'right')).toBe(false);
    expect(s.refusal).toBe('up');
    expect(s.phase).toBe('run');
    const fwd = { ...base, vx: 8, vy: -4, topY: 0.8, travel: 1.5 };
    expect(onThrow(s, cfg, 200, fwd, 'right')).toBe(true);
  });
});

describe('item 9: moderate real-speed throws', () => {
  /** Front-on overarm throws at every power; their measured peak speed is what is tested. */
  function throwsByPower(seed: number) {
    const out: { speed: number; events: GameEvent[] }[] = [];
    for (let p = 0.05; p <= 1.001; p += 0.05) {
      const { events } = play(script(idle(500), overarmThrow('right', { power: p })), seed, {
        calibrate: true,
      });
      const r = ofType(events, 'ThrowReleased').filter((e) => e.speed > 3.5);
      if (r.length > 0) out.push({ speed: Math.max(...r.map((e) => e.speed)), events });
    }
    return out;
  }

  it.each([1, 2, 3])('6.5 to 8 sw/s is taken, 4 to 5 refused as slow, seed %i', (seed) => {
    const all = throwsByPower(seed);
    const good = all.filter((x) => x.speed >= 6.5 && x.speed <= 8);
    const weak = all.filter((x) => x.speed >= 4 && x.speed <= 5);
    expect(good.length).toBeGreaterThanOrEqual(1);
    expect(weak.length).toBeGreaterThanOrEqual(1);
    for (const g of good) expect(judge(g.events, 0).taken).toBe(1);
    for (const w of weak) {
      const j = judge(w.events, 0);
      expect(j.taken).toBe(0);
      expect(j.refusals).toContain('slow');
    }
  });
});

describe('item 9: a slow arm raise', () => {
  it('says nothing and throws nothing', () => {
    const { events } = play(script(idle(400), armUp('right'), idle(900)), 1, { calibrate: true });
    expect(judge(events, 0).taken).toBe(0);
  });
});
